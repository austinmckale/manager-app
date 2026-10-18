import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { CHAT_EDIT_TAG, editedFromTag } from "@/lib/content-review";
import { loadContentReview } from "@/lib/content-review-store";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// The browser shrinks the photo before sending, so this stays under Vercel's request limit.
const MAX_BYTES = 4 * 1024 * 1024;
const fieldsSchema = z.object({ draftId: z.string().uuid(), inputHash: z.string().length(64), originalPhotoId: z.string().uuid() });

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ...body, approved: false, published: false }, { status });
}

/**
 * Saves an edited copy of a photo that is on this draft version (for example a ChatGPT touch-up).
 * The original is never changed. The copy is re-encoded without metadata, linked to the photo it
 * replaces, and only becomes part of the draft when the owner saves a new version and reruns checks.
 */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Invalid request origin." }, 403);
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return reply({ error: "Sign in again." }, 401); }
  if (!isDashboardOwnerEmail(auth.email)) return reply({ error: "Owner access required." }, 403);
  if (isDemoMode()) return reply({ error: "Preview only. Nothing was saved." }, 409);

  const form = await request.formData().catch(() => null);
  const fields = fieldsSchema.safeParse({ draftId: form?.get("draftId"), inputHash: form?.get("inputHash"), originalPhotoId: form?.get("originalPhotoId") });
  const file = form?.get("file");
  if (!fields.success || !(file instanceof File)) return reply({ error: "Choose an edited photo and the photo it replaces." }, 400);
  if (file.size === 0 || file.size > MAX_BYTES) return reply({ error: "That photo is too large. Save it as a JPG and try again." }, 413);

  const context = await loadContentReview(auth.orgId, fields.data.draftId);
  if (!context || context.superseded || context.inputHash !== fields.data.inputHash) return reply({ error: "This version changed. Reload the page, then add the edited photo again." }, 409);
  const original = context.assets.find((asset) => asset.id === fields.data.originalPhotoId && context.draft.assetIds.includes(asset.id));
  if (!original) return reply({ error: "That photo is not on this version." }, 404);

  let bytes: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error("not an image");
    // Re-encoding drops GPS and other metadata.
    bytes = await image.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    return reply({ error: "The app could not read that file as a photo. Save it as JPG or PNG and try again." }, 400);
  }

  const id = randomUUID();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
  const storageKey = `${auth.orgId}/${context.jobId}/marketing-edits/${Date.now()}-${id}.jpg`;
  const upload = await supabaseAdmin.storage.from(bucket).upload(storageKey, bytes, { contentType: "image/jpeg", upsert: false });
  if (upload.error) return reply({ error: "The photo could not be stored. Try again." }, 502);

  const fileName = `${original.fileName.replace(/\.[^.]+$/, "").slice(0, 80)}-edited.jpg`;
  try {
    await prisma.$transaction([
      prisma.fileAsset.create({
        data: {
          id, jobId: context.jobId, type: "PHOTO", storageKey, fileName, mimeType: "image/jpeg", fileSize: bytes.byteLength,
          takenAt: original.takenAt, stage: original.stage, area: original.area, description: original.description,
          // The root original keeps the link to Ryan's notes and voice; the tag names the photo it replaces.
          derivedFromAssetId: original.tags.includes(CHAT_EDIT_TAG) && original.derivedFromAssetId ? original.derivedFromAssetId : original.id,
          tags: [CHAT_EDIT_TAG, editedFromTag(original.id)], isPortfolio: false, isClientVisible: false,
        },
      }),
      prisma.activityLog.create({ data: { orgId: auth.orgId, jobId: context.jobId, actorId: auth.userId, action: "marketing.photo.edited", metadata: { draftId: context.draftId, originalPhotoId: original.id, fileAssetId: id } } }),
    ]);
  } catch {
    await supabaseAdmin.storage.from(bucket).remove([storageKey]).catch(() => undefined);
    return reply({ error: "The photo could not be saved. Try again." }, 500);
  }
  return reply({ ok: true, photo: { id, fileName, description: original.description || "", replaces: original.id } });
}
