import { createHash } from "node:crypto";
import { marketingDraftSchema, type MarketingDraft } from "@/lib/marketing";
import { PublishRejection, type OrganicDestination, type OwnedAsset } from "@/lib/publishing/types";

export function parseSavedDraft(metadata: unknown) {
  const parsed = marketingDraftSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

export function approvedText(draft: MarketingDraft, destination: OrganicDestination) {
  return destination === "GOOGLE_BUSINESS" ? draft.googleBusiness : draft.social;
}

export function assertAssetSubset(draft: MarketingDraft, assetIds: string[]) {
  const allowed = new Set(draft.assetIds);
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length || assetIds.some((id) => !allowed.has(id))) {
    throw new PublishRejection("Choose photos that are already part of this saved draft.", 400);
  }
}

export function contentHash(destination: OrganicDestination, text: string, assetIds: string[], approvalHash: string) {
  return createHash("sha256")
    .update(JSON.stringify({ destination, text, assetIds: [...assetIds].sort(), approvalHash }))
    .digest("hex");
}

export function idempotencyKey(input: {
  orgId: string;
  draftId: string;
  destination: OrganicDestination;
  assetIds: string[];
  contentHash: string;
  mode: "mock" | "live";
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orgId: input.orgId,
        draftId: input.draftId,
        destination: input.destination,
        assetIds: [...input.assetIds].sort(),
        contentHash: input.contentHash,
        mode: input.mode,
      }),
    )
    .digest("hex");
}

const RASTER = /^image\/(jpeg|png|webp)$/;

export function mediaProblem(destination: OrganicDestination, assets: OwnedAsset[]) {
  if (destination === "INSTAGRAM") {
    if (assets.length > 10) return "Instagram accepts up to 10 photos in one post.";
    if (assets.some((asset) => asset.mimeType !== "image/jpeg")) {
      return "Instagram publishing accepts JPEG photos. Use Facebook or Google Business Profile for PNG or WebP, or export a JPEG first.";
    }
    if (assets.some((asset) => (asset.fileSize ?? 0) > 8 * 1024 * 1024)) {
      return "Instagram publishing accepts JPEG photos up to 8 MB.";
    }
  }
  if (destination === "GOOGLE_BUSINESS") {
    if (assets.length > 1) return "Google Business Profile posts accept one photo. Choose one photo for Google.";
    if (assets.some((asset) => !RASTER.test(asset.mimeType ?? ""))) {
      return "Google Business Profile publishing accepts JPEG, PNG, or WebP photos.";
    }
  }
  if (destination === "FACEBOOK_PAGE") {
    if (assets.length > 10) return "Facebook posts accept up to 10 photos.";
    if (assets.some((asset) => !RASTER.test(asset.mimeType ?? ""))) {
      return "Facebook publishing accepts JPEG, PNG, or WebP photos.";
    }
  }
  return null;
}
