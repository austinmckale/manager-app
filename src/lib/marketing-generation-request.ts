import { z } from "zod";
import { ARCHIVED_PHOTO_TAG } from "./marketing";

export const ownerGenerationBodySchema = z.object({ submissionId: z.string().uuid() }).strict();

export class OwnerGenerationError extends Error {
  readonly status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "OwnerGenerationError";
    this.status = status;
  }
}

const receiptSchema = z.object({
  inviteId: z.string().uuid(),
  submissionId: z.string().uuid(),
  fileAssetId: z.string().uuid(),
});

export type OwnerReceipt = { orgId: string; jobId?: string | null; action?: string; metadata: unknown };
export type OwnerAsset = { id: string; tags: string[]; job?: { orgId: string } | null };

export function ownerInviteFromReceipts(orgId: string, submissionId: string, receipts: OwnerReceipt[]) {
  const parsed = receipts.flatMap((row) => {
    if (row.orgId !== orgId || (row.action && row.action !== "field.photo.received")) return [];
    const receipt = receiptSchema.safeParse(row.metadata);
    if (!receipt.success || receipt.data.submissionId !== submissionId) return [];
    return [{ ...receipt.data, jobId: row.jobId ?? null }];
  });
  if (!parsed.length) throw new OwnerGenerationError(404, "That submission is not available.");
  const inviteId = parsed[0].inviteId;
  const jobIds = [...new Set(parsed.map((receipt) => receipt.jobId).filter((jobId): jobId is string => Boolean(jobId)))];
  if (parsed.some((receipt) => receipt.inviteId !== inviteId) || jobIds.length > 1) throw new OwnerGenerationError(404, "That submission is not available.");
  return { inviteId, jobId: jobIds[0] ?? null, fileAssetIds: [...new Set(parsed.map((receipt) => receipt.fileAssetId))] };
}

export function ownerAssetIds(orgId: string, inviteId: string, submissionId: string, fileAssetIds: string[], assets: OwnerAsset[]) {
  const assetIds = assets.flatMap((asset) => asset.job?.orgId === orgId && asset.tags.includes(`intake:${inviteId}`) && asset.tags.includes(`submission:${submissionId}`) && !asset.tags.includes(ARCHIVED_PHOTO_TAG) ? [asset.id] : []);
  if (!assetIds.length || assetIds.length > 24 || new Set(assetIds).size !== assetIds.length || fileAssetIds.some((id) => !assetIds.includes(id))) throw new OwnerGenerationError(409, "A selected photo is outside this submission.");
  return assetIds;
}
