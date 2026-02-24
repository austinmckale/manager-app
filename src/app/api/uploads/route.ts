import { Buffer } from "node:buffer";
import { ExpenseCategory } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";

function dataUrlToBuffer(dataUrl: string) {
  const [meta, data] = dataUrl.split(",");
  if (!meta || !data) throw new Error("Invalid data URL");
  return Buffer.from(data, "base64");
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
    select: { id: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const ext = body.fileName.split(".").pop() || "jpg";
  const storageKey = `${auth.orgId}/${body.jobId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const payload = dataUrlToBuffer(body.dataUrl);

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
  const upload = await supabaseAdmin.storage.from(bucket).upload(storageKey, payload, {
    contentType: body.mimeType,
    upsert: false,
  });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
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
      mimeType: body.mimeType,
      fileSize: payload.byteLength,
      takenAt: new Date(),
      stage: body.stage,
      area: body.area,
      tags: body.tags ?? [],
      description: body.description || null,
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
      },
    },
  });

  if (created.isPortfolio) {
    const { onPortfolioPublish } = await import("@/lib/portfolio-publish");
    onPortfolioPublish(created.id, storageKey).catch(() => {});
  }

  return NextResponse.json({ ok: true, id: created.id });
}
