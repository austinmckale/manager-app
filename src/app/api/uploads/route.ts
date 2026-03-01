import { Buffer } from "node:buffer";
import { ExpenseCategory } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { combineDescriptions, extractJoistDocumentFromFileName, extractJoistDocumentFromText, type JoistDocumentExtract } from "@/lib/joist-document";
import { extractPdfText } from "@/lib/pdf-parse-server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";

function dataUrlToBuffer(dataUrl: string) {
  const [meta, data] = dataUrl.split(",");
  if (!meta || !data) throw new Error("Invalid data URL");
  return Buffer.from(data, "base64");
}

function parseMoneyText(value: string | null | undefined) {
  if (!value) return 0;
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeFileExtension(fileName: string) {
  const raw = fileName.split(".").pop() ?? "";
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned || "jpg";
}

function inferMimeType(fileName: string, mimeType?: string | null) {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  if (normalized) return normalized;

  const ext = sanitizeFileExtension(fileName);
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };
  return mimeByExt[ext] ?? "application/octet-stream";
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  const body = (await request.json()) as {
    id: string;
    jobId: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    fileType: "PHOTO" | "VIDEO" | "DOCUMENT" | "RECEIPT";
    stage?: "BEFORE" | "DURING" | "AFTER";
    area?: string;
    tags?: string[];
    description?: string;
    isPortfolio?: boolean;
    isClientVisible?: boolean;
    expenseId?: string;
    expenseVendor?: string;
    expenseAmount?: number;
    expenseCategory?: "MATERIALS" | "SUBCONTRACTOR" | "PERMIT" | "EQUIPMENT" | "MISC";
    expenseDate?: string;
    expenseNotes?: string;
  };

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, mode: "demo" });
  }

  const job = await prisma.job.findFirst({
    where: { id: body.jobId, orgId: auth.orgId },
    select: { id: true, address: true, jobName: true, customerId: true, customer: { select: { name: true } } },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const ext = sanitizeFileExtension(body.fileName);
  const normalizedMimeType = inferMimeType(body.fileName, body.mimeType);
  const storageKey = `${auth.orgId}/${body.jobId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const payload = dataUrlToBuffer(body.dataUrl);
  let joistExtract: JoistDocumentExtract | null = null;

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
  const upload = await supabaseAdmin.storage.from(bucket).upload(storageKey, payload, {
    contentType: normalizedMimeType,
    upsert: false,
  });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const isPdfDocument =
    body.fileType === "DOCUMENT" &&
    (body.fileName.toLowerCase().endsWith(".pdf") || body.mimeType.toLowerCase().includes("pdf"));

  if (body.fileType === "DOCUMENT") {
    if (isPdfDocument) {
      try {
        const extractedText = await extractPdfText(payload);
        joistExtract = extractJoistDocumentFromText(extractedText);
      } catch (error) {
        joistExtract = extractJoistDocumentFromFileName(
          body.fileName,
          error instanceof Error ? error.message : "PDF parse failed",
        );
      }
    } else if (body.fileName.toLowerCase().includes("joist")) {
      joistExtract = extractJoistDocumentFromFileName(body.fileName, "Non-PDF document fallback");
    }
  }

  const description = combineDescriptions(body.description, joistExtract?.summary);
  if (joistExtract) {
    const contractTotal = parseMoneyText(joistExtract.totalText);
    const nextAddress = joistExtract.address.trim();
    const nextCustomerName = joistExtract.customerName.trim();
    const shouldFillPendingAddress = nextAddress.length > 0 && /^address pending$/i.test(job.address.trim());
    const shouldRefreshAutoName = /^joist\s/i.test(job.jobName.trim()) || /^imported job$/i.test(job.jobName.trim());
    const candidateJobName =
      (nextAddress || job.address) && (nextCustomerName || job.customer.name)
        ? `${nextAddress || job.address} - ${nextCustomerName || job.customer.name}`.slice(0, 191)
        : "";

    await prisma.$transaction(async (tx) => {
      if (contractTotal > 0 || shouldFillPendingAddress || (shouldRefreshAutoName && candidateJobName)) {
        await tx.job.update({
          where: { id: job.id },
          data: {
            estimatedTotalBudget: contractTotal > 0 ? contractTotal : undefined,
            address: shouldFillPendingAddress ? nextAddress : undefined,
            jobName: shouldRefreshAutoName && candidateJobName ? candidateJobName : undefined,
          },
        });
      }

      if (nextCustomerName && /^imported lead$/i.test(job.customer.name.trim())) {
        await tx.customer.update({
          where: { id: job.customerId },
          data: { name: nextCustomerName },
        });
      }
    });
  }

  let linkedExpenseId = body.expenseId || null;
  const numericAmount = Number(body.expenseAmount);
  const normalizedVendor = body.expenseVendor?.trim() || "";
  const shouldCreateExpense =
    body.fileType === "RECEIPT" &&
    !linkedExpenseId &&
    Boolean(normalizedVendor) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0;

  if (body.fileType === "RECEIPT" && !linkedExpenseId && !shouldCreateExpense) {
    return NextResponse.json(
      { error: "Receipt capture requires vendor and amount, or an existing expense link." },
      { status: 400 },
    );
  }
  if (shouldCreateExpense) {
    const expenseCategory = Object.values(ExpenseCategory).includes(body.expenseCategory as ExpenseCategory)
      ? (body.expenseCategory as ExpenseCategory)
      : ExpenseCategory.MISC;

    const expense = await prisma.expense.create({
      data: {
        jobId: body.jobId,
        vendor: normalizedVendor,
        amount: numericAmount,
        category: expenseCategory,
        date: body.expenseDate ? new Date(body.expenseDate) : new Date(),
        notes: body.expenseNotes?.trim() || body.description?.trim() || null,
      },
    });

    linkedExpenseId = expense.id;

    await prisma.activityLog.create({
      data: {
        orgId: auth.orgId,
        jobId: body.jobId,
        actorId: auth.userId,
        action: "expense.created",
        metadata: {
          expenseId: expense.id,
          source: "receipt_capture",
        },
      },
    });
  }

  const created = await prisma.fileAsset.create({
    data: {
      jobId: body.jobId,
      expenseId: linkedExpenseId,
      type: body.fileType,
      storageKey,
      fileName: body.fileName,
      mimeType: normalizedMimeType,
      fileSize: payload.byteLength,
      takenAt: new Date(),
      stage: body.stage,
      area: body.area,
      tags: body.tags ?? [],
      description: description || null,
      isPortfolio: body.fileType === "PHOTO" ? Boolean(body.isPortfolio) : false,
      isClientVisible: Boolean(body.isClientVisible),
    },
  });

  await prisma.activityLog.create({
    data: {
      orgId: auth.orgId,
      jobId: body.jobId,
      actorId: auth.userId,
      action: "file.uploaded",
      metadata: {
        fileAssetId: created.id,
        type: created.type,
        joistExtract: joistExtract
          ? {
              documentType: joistExtract.documentType,
              documentNumber: joistExtract.documentNumber,
              customerName: joistExtract.customerName || null,
              address: joistExtract.address || null,
              scopeSummary: joistExtract.scopeSummary || null,
              total: joistExtract.totalText || null,
              date: joistExtract.dateText || null,
              parseSource: joistExtract.parseSource,
              parseError: joistExtract.parseError ?? null,
            }
          : null,
      },
    },
  });

  if (created.isPortfolio) {
    const { onPortfolioPublish } = await import("@/lib/portfolio-publish");
    onPortfolioPublish(created.id, storageKey).catch(() => {});
  }

  return NextResponse.json({ ok: true, id: created.id });
}
