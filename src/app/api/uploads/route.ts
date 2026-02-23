import { Buffer } from "node:buffer";
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
  };

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, mode: "demo" });
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

  const created = await prisma.fileAsset.create({
    data: {
      jobId: body.jobId,
      expenseId: body.expenseId || null,
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
      isPortfolio: Boolean(body.isPortfolio),
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

  return NextResponse.json({ ok: true, id: created.id });
}
