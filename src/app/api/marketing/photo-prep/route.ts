import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import {
  MILD_CONTRAST_LIMIT,
  MILD_EXPOSURE_LIMIT,
  PHOTO_PREP_MAX_BASE64_CHARS,
  PHOTO_PREP_MAX_BYTES,
  PHOTO_PREP_MAX_PIXELS,
  PhotoPrepError,
  decodePhotoPayload,
  defaultCropPresets,
  planPhotoPrep,
  renderConservativePreview,
  type PhotoPrepResult,
} from "@/lib/photo-prep";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sourceId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/),
  imageBase64: z.string().min(4).max(PHOTO_PREP_MAX_BASE64_CHARS + 80),
  presetId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9:_-]{1,64}$/),
  exposure: z.number().min(-MILD_EXPOSURE_LIMIT).max(MILD_EXPOSURE_LIMIT).optional(),
  contrast: z.number().min(-MILD_CONTRAST_LIMIT).max(MILD_CONTRAST_LIMIT).optional(),
  note: z.string().max(500).optional(),
});

function responseBody(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ...body, approved: false, unblocked: false, published: false }, { status });
}

function limits() {
  return {
    maxBytes: PHOTO_PREP_MAX_BYTES,
    maxPixels: PHOTO_PREP_MAX_PIXELS,
    exposure: MILD_EXPOSURE_LIMIT,
    contrast: MILD_CONTRAST_LIMIT,
    publicMetadataPolicy: "strip" as const,
    gpsExifPolicy: "strip" as const,
  };
}

function publicPlan(plan: PhotoPrepResult) {
  return {
    sourceId: plan.sourceId,
    originalSha256: plan.originalSha256,
    originalByteLength: plan.originalByteLength,
    derivativeId: plan.derivativeId,
    presetId: plan.presetId,
    preset: plan.preset,
    exposure: plan.exposure,
    contrast: plan.contrast,
    operations: plan.operations,
    publicMetadataPolicy: plan.publicMetadataPolicy,
    gpsExifPolicy: plan.gpsExifPolicy,
    metadataStripped: plan.metadataStripped,
    replacesOriginal: plan.replacesOriginal,
    stored: false,
    fileWritten: false,
    note: plan.note,
  };
}

async function ownerGate() {
  try {
    const auth = await requireAuth({ allowFallback: false });
    if (!isDashboardOwnerEmail(auth.email)) return responseBody({ error: "Owner access required." }, 403);
    return null;
  } catch {
    return responseBody({ error: "Sign in again." }, 401);
  }
}

export async function GET(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return responseBody({ error: "Invalid request origin." }, 403);
  }
  const denied = await ownerGate();
  if (denied) return denied;
  return responseBody({ ok: true, presets: defaultCropPresets, limits: limits(), stored: false, fileWritten: false });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return responseBody({ error: "Invalid request origin." }, 403);
  const denied = await ownerGate();
  if (denied) return denied;
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > PHOTO_PREP_MAX_BASE64_CHARS + 8192) {
    return responseBody({ error: `Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes.` }, 413);
  }
  try {
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object") return responseBody({ error: "Check the photo and try again." }, 400);
    const record = raw as Record<string, unknown>;
    if (typeof record.url === "string" || typeof record.imageUrl === "string" || (typeof record.image === "string" && /^https?:\/\//i.test(record.image))) {
      return responseBody({ error: "Remote image URLs are not accepted." }, 400);
    }
    if (typeof record.imageBase64 === "string" && record.imageBase64.length > PHOTO_PREP_MAX_BASE64_CHARS + 80) {
      return responseBody({ error: `Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes.` }, 413);
    }
    const parsed = bodySchema.safeParse({
      sourceId: record.sourceId,
      imageBase64: record.imageBase64,
      presetId: record.presetId,
      exposure: record.exposure,
      contrast: record.contrast,
      note: record.note,
    });
    if (!parsed.success) return responseBody({ error: "Check the photo and try again." }, 400);
    const bytes = decodePhotoPayload(parsed.data.imageBase64);
    const plan = planPhotoPrep({
      sourceId: parsed.data.sourceId,
      bytes,
      presetId: parsed.data.presetId,
      exposure: parsed.data.exposure,
      contrast: parsed.data.contrast,
      note: parsed.data.note,
      approved: record.approved,
      published: record.published,
      unblocked: record.unblocked,
    });
    const demo = isDemoMode();
    const preview = demo ? null : await renderConservativePreview(bytes, plan);
    return responseBody({
      ok: true,
      ...publicPlan(plan),
      previewDataUrl: preview ? `data:image/jpeg;base64,${preview.toString("base64")}` : null,
      demo,
      limits: limits(),
    });
  } catch (error) {
    if (error instanceof PhotoPrepError) return responseBody({ error: error.message }, error.code === "oversize" ? 413 : 400);
    return responseBody({ error: "Photo prep could not finish. The original was not changed." }, 400);
  }
}
