import { createHash } from "node:crypto";

/**
 * Conservative photo prep. Original bytes are never modified.
 * A public derivative is a new output linked to the source id and the
 * sha256 of those original bytes. GPS and other metadata are stripped.
 */

export const PHOTO_PREP_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_PREP_MAX_PIXELS = 20_000_000;
export const PHOTO_PREP_PREVIEW_MAX_EDGE = 1600;
export const PHOTO_PREP_MAX_BASE64_CHARS = Math.ceil(PHOTO_PREP_MAX_BYTES / 3) * 4;
export const MILD_EXPOSURE_LIMIT = 0.15;
export const MILD_CONTRAST_LIMIT = 0.12;
export const DEFAULT_EXPOSURE = 0.06;
export const DEFAULT_CONTRAST = 0.05;

export const CONSERVATIVE_OPERATIONS = Object.freeze([
  "exif-orientation",
  "mild-exposure",
  "mild-contrast",
  "preset-crop",
] as const);

const ALLOWED_OPERATIONS = new Set<string>(CONSERVATIVE_OPERATIONS);
const CANNOT_INVENT = "Photo prep only applies EXIF orientation, mild exposure, mild contrast, and a configured crop. It cannot add, remove, or invent content.";
const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i;
const ALLOWED_DATA_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const BLOCKED_REQUEST_FIELDS = ["generate", "generative", "inpaint", "replaceSky", "removeDamage", "fabricateBeforeAfter", "addStructure", "removeStructure", "skyReplacement", "beforeAfter"] as const;

export type CropPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

export const defaultCropPresets: readonly CropPreset[] = Object.freeze([
  Object.freeze({ id: "4:5", label: "4:5", width: 4, height: 5 }),
  Object.freeze({ id: "1:1", label: "1:1", width: 1, height: 1 }),
  Object.freeze({ id: "landscape", label: "Landscape", width: 16, height: 9 }),
]);

export type PhotoPrepErrorCode = "oversize" | "corrupt" | "unsafe" | "url";

export class PhotoPrepError extends Error {
  readonly code: PhotoPrepErrorCode;

  constructor(message: string, code: PhotoPrepErrorCode) {
    super(message);
    this.name = "PhotoPrepError";
    this.code = code;
  }
}

export type PhotoPrepInput = {
  sourceId: string;
  bytes: Buffer | Uint8Array | string;
  presetId?: string;
  exposure?: number;
  contrast?: number;
  operations?: readonly string[];
  presets?: readonly CropPreset[];
  note?: string;
  url?: string;
  imageUrl?: string;
  approved?: unknown;
  published?: unknown;
  unblocked?: unknown;
};

export type SafetyDecision =
  | {
      ok: true;
      sourceId: string;
      originalSha256: string;
      originalByteLength: number;
      preset: CropPreset;
      exposure: number;
      contrast: number;
      operations: readonly string[];
      publicMetadataPolicy: "strip";
      gpsExifPolicy: "strip";
      approved: false;
      unblocked: false;
      published: false;
    }
  | {
      ok: false;
      code: PhotoPrepErrorCode;
      message: string;
      limit?: number;
      approved: false;
      unblocked: false;
      published: false;
    };

export type PhotoPrepResult = {
  sourceId: string;
  originalSha256: string;
  originalByteLength: number;
  derivativeId: string;
  presetId: string;
  preset: CropPreset;
  exposure: number;
  contrast: number;
  operations: readonly string[];
  publicMetadataPolicy: "strip";
  gpsExifPolicy: "strip";
  metadataStripped: true;
  replacesOriginal: false;
  stored: false;
  note: string | null;
  approved: false;
  unblocked: false;
  published: false;
};

type SharpPipeline = {
  metadata: () => Promise<{ width?: number; height?: number; orientation?: number; exif?: Buffer; autoOrient?: { width?: number; height?: number } }>;
  rotate: () => SharpPipeline;
  extract: (box: { left: number; top: number; width: number; height: number }) => SharpPipeline;
  modulate: (options: { brightness: number }) => SharpPipeline;
  linear: (gain: number, offset: number) => SharpPipeline;
  resize: (options: { width: number; height: number; fit: "inside"; withoutEnlargement: boolean }) => SharpPipeline;
  jpeg: (options: { quality: number; mozjpeg: boolean; chromaSubsampling: "4:2:0" }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
};

type SharpFactory = ((
  input: Buffer,
  options?: { failOn?: "error"; limitInputPixels?: number; sequentialRead?: boolean; animated?: boolean },
) => SharpPipeline) & {
  cache?: (value: boolean) => void;
};

export function sha256Bytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodePhotoPayload(payload: string): Buffer {
  if (typeof payload !== "string") throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
  const trimmed = payload.trim();
  if (/^https?:\/\//i.test(trimmed)) throw new PhotoPrepError("Remote image URLs are not accepted.", "url");
  let base64 = trimmed;
  if (trimmed.startsWith("data:")) {
    const dataUrl = DATA_URL_PATTERN.exec(trimmed);
    if (!dataUrl) throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
    const mime = dataUrl[1].toLowerCase();
    if (mime.includes("svg") || !ALLOWED_DATA_TYPES.has(mime)) throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
    base64 = dataUrl[2];
  }
  const compact = base64.replace(/\s/g, "");
  if (compact.length > PHOTO_PREP_MAX_BASE64_CHARS) {
    throw new PhotoPrepError(`Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes.`, "oversize");
  }
  if (compact.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length > PHOTO_PREP_MAX_BYTES) throw new PhotoPrepError(`Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes.`, "oversize");
  return bytes;
}

function rejection(code: PhotoPrepErrorCode, message: string, limit?: number): SafetyDecision {
  return { ok: false, code, message, limit, approved: false, unblocked: false, published: false };
}

function imageMagic(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return true;
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).toLowerCase();
    return brand === "heic" || brand === "heif" || brand === "mif1" || brand === "msf1" || brand === "heix" || brand === "hevc";
  }
  return false;
}

function bytesOf(value: unknown): Buffer | null {
  if (typeof Buffer === "undefined") return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function normalizeMild(value: number | undefined, fallback: number, limit: number, label: string): number | SafetyDecision {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || Math.abs(resolved) > limit) {
    return rejection("unsafe", `${label} must stay within ±${limit}. Photo prep will not apply a stronger change.`, limit);
  }
  return Math.round(resolved * 1000) / 1000;
}

function configuredPresets(presets: readonly CropPreset[] | undefined): CropPreset[] | SafetyDecision {
  const source = presets ?? defaultCropPresets;
  if (source.length === 0 || source.length > 12) return rejection("unsafe", "Configure at least one crop preset.");
  const seen = new Set<string>();
  const normalized: CropPreset[] = [];
  for (const preset of source) {
    if (!preset || typeof preset.id !== "string" || !/^[A-Za-z0-9:_-]{1,64}$/.test(preset.id)) return rejection("unsafe", "A crop preset id must be a short label, not a platform requirement.");
    if (seen.has(preset.id)) return rejection("unsafe", "Crop preset ids must be unique.");
    if (!Number.isFinite(preset.width) || !Number.isFinite(preset.height) || preset.width <= 0 || preset.height <= 0 || preset.width > 100 || preset.height > 100) {
      return rejection("unsafe", "A crop preset needs a positive aspect ratio.");
    }
    seen.add(preset.id);
    const label = typeof preset.label === "string" && preset.label.trim() ? preset.label.trim().slice(0, 80) : preset.id;
    normalized.push({ id: preset.id, label, width: preset.width, height: preset.height });
  }
  return normalized;
}

function derivativeKey(originalSha256: string, preset: CropPreset, exposure: number, contrast: number): string {
  return [
    "photo-prep",
    "1",
    originalSha256,
    preset.id,
    String(preset.width),
    String(preset.height),
    exposure.toFixed(3),
    contrast.toFixed(3),
    CONSERVATIVE_OPERATIONS.join(","),
    "strip",
  ].join("\n");
}

export function derivativeIdFor(originalSha256: string, preset: CropPreset, exposure: number, contrast: number): string {
  return createHash("sha256").update(derivativeKey(originalSha256, preset, exposure, contrast)).digest("hex");
}

/** Pure safety decision. Same original bytes and settings always plan the same derivative id. */
export function assessPhotoPrepSafety(input: PhotoPrepInput): SafetyDecision {
  const record = input as PhotoPrepInput & Record<string, unknown>;
  for (const field of BLOCKED_REQUEST_FIELDS) {
    if (record[field]) return rejection("unsafe", CANNOT_INVENT);
  }
  if ((typeof input.url === "string" && input.url.trim()) || (typeof input.imageUrl === "string" && input.imageUrl.trim())) {
    return rejection("url", "Remote image URLs are not accepted.");
  }
  if (typeof input.sourceId !== "string" || input.sourceId.trim().length === 0 || input.sourceId.trim().length > 128) {
    return rejection("unsafe", "A source id is required.");
  }
  const sourceId = input.sourceId.trim();
  if (/^https?:\/\//i.test(sourceId) || sourceId.includes("..") || sourceId.includes("/") || sourceId.includes("\\")) {
    return rejection("url", "Remote image URLs are not accepted.");
  }
  if (typeof input.bytes === "string" && /^https?:\/\//i.test(input.bytes.trim())) {
    return rejection("url", "Remote image URLs are not accepted.");
  }
  const bytes = bytesOf(input.bytes);
  if (!bytes) return rejection("corrupt", "This photo is corrupt or is not a supported image.");
  if (bytes.length > PHOTO_PREP_MAX_BYTES) {
    return rejection("oversize", `Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes.`, PHOTO_PREP_MAX_BYTES);
  }
  if (bytes.length < 4 || !imageMagic(bytes)) return rejection("corrupt", "This photo is corrupt or is not a supported image.");
  if (input.operations !== undefined) {
    if (!Array.isArray(input.operations) || input.operations.some((operation) => typeof operation !== "string" || !ALLOWED_OPERATIONS.has(operation))) {
      return rejection("unsafe", CANNOT_INVENT);
    }
  }
  const exposure = normalizeMild(input.exposure, DEFAULT_EXPOSURE, MILD_EXPOSURE_LIMIT, "Exposure");
  if (typeof exposure !== "number") return exposure;
  const contrast = normalizeMild(input.contrast, DEFAULT_CONTRAST, MILD_CONTRAST_LIMIT, "Contrast");
  if (typeof contrast !== "number") return contrast;
  const presets = configuredPresets(input.presets);
  if (!Array.isArray(presets)) return presets;
  const presetId = input.presetId ?? presets[0]?.id;
  const preset = presets.find((item) => item.id === presetId);
  if (!preset) return rejection("unsafe", "Unknown crop preset. Choose one of the configured presets.");
  return {
    ok: true,
    sourceId,
    originalSha256: sha256Bytes(bytes),
    originalByteLength: bytes.length,
    preset,
    exposure,
    contrast,
    operations: CONSERVATIVE_OPERATIONS,
    publicMetadataPolicy: "strip",
    gpsExifPolicy: "strip",
    approved: false,
    unblocked: false,
    published: false,
  };
}

export function planPhotoPrep(input: PhotoPrepInput): PhotoPrepResult {
  const decision = assessPhotoPrepSafety(input);
  if (!decision.ok) throw new PhotoPrepError(decision.message, decision.code);
  const note = typeof input.note === "string" && input.note.length <= 500 ? input.note : null;
  return Object.freeze({
    sourceId: decision.sourceId,
    originalSha256: decision.originalSha256,
    originalByteLength: decision.originalByteLength,
    derivativeId: derivativeIdFor(decision.originalSha256, decision.preset, decision.exposure, decision.contrast),
    presetId: decision.preset.id,
    preset: Object.freeze({ ...decision.preset }),
    exposure: decision.exposure,
    contrast: decision.contrast,
    operations: CONSERVATIVE_OPERATIONS,
    publicMetadataPolicy: "strip",
    gpsExifPolicy: "strip",
    metadataStripped: true,
    replacesOriginal: false,
    stored: false,
    note,
    approved: false,
    unblocked: false,
    published: false,
  });
}

export function centerCropBox(width: number, height: number, ratioWidth: number, ratioHeight: number) {
  const target = ratioWidth / ratioHeight;
  let cropWidth = width;
  let cropHeight = height;
  if (width / height > target) cropWidth = Math.max(1, Math.min(width, Math.round(height * target)));
  else cropHeight = Math.max(1, Math.min(height, Math.round(width / target)));
  const left = Math.max(0, Math.floor((width - cropWidth) / 2));
  const top = Math.max(0, Math.floor((height - cropHeight) / 2));
  return {
    left,
    top,
    width: Math.min(cropWidth, width - left),
    height: Math.min(cropHeight, height - top),
  };
}

export function orientedPixelSize(width: number, height: number, orientation: number | undefined) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return { width: 0, height: 0 };
  if ((orientation ?? 1) >= 5 && (orientation ?? 1) <= 8) return { width: Math.round(height), height: Math.round(width) };
  return { width: Math.round(width), height: Math.round(height) };
}

async function loadSharp(): Promise<SharpFactory> {
  try {
    const loaded = await import("sharp");
    const factory = ("default" in loaded && loaded.default ? loaded.default : loaded) as SharpFactory;
    return factory;
  } catch {
    throw new PhotoPrepError("Photo preview is unavailable. The original was not changed.", "unsafe");
  }
}

/** In-memory derivative. Does not write files or modify `bytes`. */
export async function renderConservativePreview(bytes: Buffer, plan: PhotoPrepResult, load: () => Promise<SharpFactory> = loadSharp): Promise<Buffer> {
  if (typeof window !== "undefined") throw new PhotoPrepError("Photo prep runs on the server.", "unsafe");
  const sharp = await load();
  sharp.cache?.(false);
  const options = { failOn: "error" as const, limitInputPixels: PHOTO_PREP_MAX_PIXELS, sequentialRead: true, animated: false as const };
  try {
    const meta = await sharp(bytes, options).metadata();
    const size = meta.autoOrient?.width && meta.autoOrient.height
      ? { width: meta.autoOrient.width, height: meta.autoOrient.height }
      : orientedPixelSize(meta.width ?? 0, meta.height ?? 0, meta.orientation);
    if (size.width < 1 || size.height < 1) throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
    if (size.width * size.height > PHOTO_PREP_MAX_PIXELS) {
      throw new PhotoPrepError(`Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes and ${PHOTO_PREP_MAX_PIXELS} pixels.`, "oversize");
    }
    const crop = centerCropBox(size.width, size.height, plan.preset.width, plan.preset.height);
    const gain = 1 + plan.contrast;
    return await sharp(bytes, options)
      .rotate()
      .extract(crop)
      .modulate({ brightness: 1 + plan.exposure })
      .linear(gain, 128 * (1 - gain))
      .resize({ width: PHOTO_PREP_PREVIEW_MAX_EDGE, height: PHOTO_PREP_PREVIEW_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer();
  } catch (error) {
    if (error instanceof PhotoPrepError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|exceeds|too large/i.test(message)) {
      throw new PhotoPrepError(`Photo is too large. The limit is ${PHOTO_PREP_MAX_BYTES} bytes and ${PHOTO_PREP_MAX_PIXELS} pixels.`, "oversize");
    }
    throw new PhotoPrepError("This photo is corrupt or is not a supported image.", "corrupt");
  }
}
