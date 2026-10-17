import { createHash } from "node:crypto";
import { assessPublishability, publicationBlock } from "@/lib/publishability";

// Optional branding only. A job photo with no physical company logo is not a
// quality finding and is not a publish block. This plans a derivative id. It
// does not read, write, or invent image bytes, and it never approves or publishes.

export const LOGO_PROCESSING_ORDER = ["original", "enhance", "crop", "logo"] as const;

export const DEFAULT_LOGO_PLACEMENT = Object.freeze({
  position: "bottom-right" as const,
  size: 0.12,
  opacity: 0.9,
  padding: 0.04,
});

export const UPLOAD_LOGO_PROMPT = "Upload a logo file to brand this photo.";
export const MANUAL_PLACEMENT_PROMPT = "Corner contrast is unknown. Choose a corner and a light or dark logo. No new mark is guessed.";

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type LogoVariant = "light" | "dark";
export type CornerContrast = "light" | "dark" | "unknown";
export type CropBox = { x: number; y: number; width: number; height: number };

export type LogoPlacement = {
  position: LogoPosition;
  size: number;
  opacity: number;
  padding: number;
  variant: LogoVariant;
  manual: boolean;
};

export type LogoOverlayRequest = {
  sourceHash: string;
  unbrandedDerivativeId: string;
  croppedDerivativeId?: string | null;
  originalDerivativeId?: string | null;
  enhancedDerivativeId?: string | null;
  brandingEnabled: boolean;
  logoAssetId?: string | null;
  crop?: CropBox | null;
  position?: LogoPosition | null;
  size?: number | null;
  opacity?: number | null;
  variant?: LogoVariant | null;
  contrast?: CornerContrast | null;
  notes?: string | readonly string[] | null;
};

export type BrandedDerivative = {
  id: string;
  sourceHash: string;
  appliedToDerivativeId: string;
  logoAssetId: string;
  processingOrder: typeof LOGO_PROCESSING_ORDER;
  placement: LogoPlacement;
  overwritesOriginal: false;
  approved: false;
  published: false;
};

export type LogoStageName = (typeof LOGO_PROCESSING_ORDER)[number];

export type LogoOverlayResult = {
  findings: readonly [];
  processingOrder: typeof LOGO_PROCESSING_ORDER;
  stages: readonly { stage: LogoStageName; derivativeId: string | null }[];
  selectedAssetId: string;
  brandedDerivativeId: string | null;
  branded: BrandedDerivative | null;
  sourceHash: string;
  appliedToDerivativeId: string | null;
  overwritesOriginal: false;
  approved: false;
  published: false;
  canPublish: boolean;
  prompt: string | null;
  status: "unbranded" | "needs_logo" | "needs_manual_placement" | "branded_preview";
  logoBytes: null;
};

const POSITIONS: readonly LogoPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const NO_FINDINGS = Object.freeze([]) as readonly [];

function text(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function notesOf(notes: LogoOverlayRequest["notes"]) {
  if (typeof notes === "string") return [notes];
  if (Array.isArray(notes)) return notes.filter((note): note is string => typeof note === "string");
  return [];
}

function publicationAllowed(notes: LogoOverlayRequest["notes"]) {
  const list = notesOf(notes);
  if (assessPublishability({ notes: list }).blocked) return false;
  return publicationBlock({ notes: list.join("\n"), voice: "", owner: "" }) === null;
}

function cropOf(crop: CropBox | null | undefined): CropBox | null {
  if (!crop) return null;
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function fraction(value: number | null | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped * 10000) / 10000;
}

function positionOf(value: LogoPosition | null | undefined): LogoPosition {
  return value && POSITIONS.includes(value) ? value : DEFAULT_LOGO_PLACEMENT.position;
}

function resolveVariant(contrast: CornerContrast | null | undefined, variant: LogoVariant | null | undefined) {
  if (variant === "light" || variant === "dark") {
    return { variant, manual: contrast !== "light" && contrast !== "dark" };
  }
  if (contrast === "dark") return { variant: "light" as const, manual: false };
  if (contrast === "light") return { variant: "dark" as const, manual: false };
  return { variant: null, manual: true };
}

function brandedId(sourceHash: string, croppedDerivativeId: string, crop: CropBox | null, logoAssetId: string, placement: LogoPlacement) {
  const digest = createHash("sha256").update(JSON.stringify({
    kind: "rhi-logo-overlay-v1",
    sourceHash,
    crop,
    croppedDerivativeId,
    logoAssetId,
    position: placement.position,
    size: placement.size,
    opacity: placement.opacity,
    padding: placement.padding,
    variant: placement.variant,
  })).digest("hex");
  const id = `branded-${digest.slice(0, 32)}`;
  if (id === croppedDerivativeId) return `${id}-mark`;
  return id;
}

function stages(originalDerivativeId: string | null, enhancedDerivativeId: string | null, croppedDerivativeId: string, logoDerivativeId: string | null) {
  return Object.freeze([
    Object.freeze({ stage: "original" as const, derivativeId: originalDerivativeId }),
    Object.freeze({ stage: "enhance" as const, derivativeId: enhancedDerivativeId }),
    Object.freeze({ stage: "crop" as const, derivativeId: croppedDerivativeId }),
    Object.freeze({ stage: "logo" as const, derivativeId: logoDerivativeId }),
  ]);
}

function finish(result: LogoOverlayResult): LogoOverlayResult {
  if (result.branded) {
    Object.freeze(result.branded.placement);
    Object.freeze(result.branded);
  }
  return Object.freeze(result);
}

export function planLogoOverlay(request: LogoOverlayRequest): LogoOverlayResult {
  const sourceHash = request.sourceHash ?? "";
  const unbrandedDerivativeId = text(request.unbrandedDerivativeId);
  const croppedDerivativeId = text(request.croppedDerivativeId) || unbrandedDerivativeId;
  const originalDerivativeId = text(request.originalDerivativeId) || null;
  const enhancedDerivativeId = text(request.enhancedDerivativeId) || null;
  const canPublish = publicationAllowed(request.notes);
  const shared = {
    findings: NO_FINDINGS,
    processingOrder: LOGO_PROCESSING_ORDER,
    sourceHash,
    overwritesOriginal: false as const,
    approved: false as const,
    published: false as const,
    canPublish,
    logoBytes: null as null,
  };

  if (!request.brandingEnabled) {
    return finish({
      ...shared,
      stages: stages(originalDerivativeId, enhancedDerivativeId, croppedDerivativeId, null),
      selectedAssetId: unbrandedDerivativeId,
      brandedDerivativeId: null,
      branded: null,
      appliedToDerivativeId: null,
      prompt: null,
      status: "unbranded",
    });
  }

  const logoAssetId = text(request.logoAssetId);
  if (!logoAssetId) {
    return finish({
      ...shared,
      stages: stages(originalDerivativeId, enhancedDerivativeId, croppedDerivativeId, null),
      selectedAssetId: unbrandedDerivativeId,
      brandedDerivativeId: null,
      branded: null,
      appliedToDerivativeId: null,
      prompt: UPLOAD_LOGO_PROMPT,
      status: "needs_logo",
    });
  }

  const resolved = resolveVariant(request.contrast, request.variant);
  if (!resolved.variant) {
    return finish({
      ...shared,
      stages: stages(originalDerivativeId, enhancedDerivativeId, croppedDerivativeId, null),
      selectedAssetId: unbrandedDerivativeId,
      brandedDerivativeId: null,
      branded: null,
      appliedToDerivativeId: null,
      prompt: MANUAL_PLACEMENT_PROMPT,
      status: "needs_manual_placement",
    });
  }

  const placement: LogoPlacement = {
    position: positionOf(request.position),
    size: fraction(request.size, DEFAULT_LOGO_PLACEMENT.size, 0.08, 0.3),
    opacity: fraction(request.opacity, DEFAULT_LOGO_PLACEMENT.opacity, 0.2, 1),
    padding: DEFAULT_LOGO_PLACEMENT.padding,
    variant: resolved.variant,
    manual: resolved.manual,
  };
  const crop = cropOf(request.crop);
  let id = brandedId(sourceHash, croppedDerivativeId, crop, logoAssetId, placement);
  if (originalDerivativeId && id === originalDerivativeId) id = `${id}-mark`;
  const branded: BrandedDerivative = {
    id,
    sourceHash,
    appliedToDerivativeId: croppedDerivativeId,
    logoAssetId,
    processingOrder: LOGO_PROCESSING_ORDER,
    placement,
    overwritesOriginal: false,
    approved: false,
    published: false,
  };
  return finish({
    ...shared,
    stages: stages(originalDerivativeId, enhancedDerivativeId, croppedDerivativeId, id),
    selectedAssetId: id,
    brandedDerivativeId: id,
    branded,
    appliedToDerivativeId: croppedDerivativeId,
    prompt: null,
    status: "branded_preview",
  });
}
