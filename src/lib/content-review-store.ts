import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { PHOTO_RECEIVED } from "@/lib/field-intake";
import { REVIEW_APPROVAL, REVIEW_REQUEST, REVIEW_SUPERSEDED, contentHash, contentReviewId, reviewRecordSchema } from "@/lib/content-review";

type Database = Prisma.TransactionClient | PrismaClient;
export async function loadContentReview(orgId: string, draftId: string, db: Database = prisma) {
  const saved = await db.activityLog.findFirst({ where: { id: draftId, orgId, action: DRAFT_SAVED_ACTION }, include: { job: { select: { jobName: true } } } });
  const parsed = marketingDraftSchema.safeParse(saved?.metadata);
  if (!saved?.jobId || !parsed.success) return null;
  const draft = parsed.data;
  const assets = await db.fileAsset.findMany({ where: { id: { in: draft.assetIds }, type: "PHOTO", jobId: saved.jobId, job: { orgId } }, orderBy: { id: "asc" } });
  if (assets.length !== new Set(draft.assetIds).size) return null;
  const pairs = new Map<string, { inviteId: string; submissionId: string }>();
  for (const asset of assets) {
    const inviteId = asset.tags.find((tag) => tag.startsWith("intake:"))?.slice(7);
    const submissionId = asset.tags.find((tag) => tag.startsWith("submission:"))?.slice(11);
    if (inviteId && submissionId) pairs.set(`${inviteId}:${submissionId}`, { inviteId, submissionId });
  }
  const audio = [] as { id: string; storageKey: string; mimeType: string; transcript: string; status: string; submissionId: string }[];
  const receiptNotes = new Set<string>();
  for (const pair of pairs.values()) {
    const rows = await db.activityLog.findMany({ where: { orgId, action: { in: [AUDIO_RECEIVED, PHOTO_RECEIVED] }, AND: [{ metadata: { path: ["inviteId"], equals: pair.inviteId } }, { metadata: { path: ["submissionId"], equals: pair.submissionId } }] }, orderBy: { id: "asc" }, take: 100 });
    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>;
      if (row.action === PHOTO_RECEIVED) {
        receiptNotes.add([typeof meta.location === "string" ? meta.location : "", typeof meta.description === "string" ? meta.description : ""].filter(Boolean).join("\n"));
        continue;
      }
      if (typeof meta.storageKey === "string" && meta.storageKey.startsWith(`${orgId}/`) && typeof meta.mimeType === "string") audio.push({ id: row.id, storageKey: meta.storageKey, mimeType: meta.mimeType, transcript: typeof meta.transcript === "string" ? meta.transcript : "", status: String(meta.status), submissionId: pair.submissionId });
    }
  }
  const originals = { receiptNotes: [...receiptNotes].sort(), photos: assets.map((asset) => ({ id: asset.id, description: asset.description || "", stage: asset.stage, updatedAt: asset.updatedAt.toISOString() })), audio: audio.map(({ id, transcript, status }) => ({ id, transcript, status })) };
  const inputHash = contentHash({ draft, originals });
  const reviewId = contentReviewId(draftId, inputHash);
  const [reviewRow, approval, superseded] = await Promise.all([
    db.activityLog.findFirst({ where: { id: reviewId, orgId, action: REVIEW_REQUEST } }),
    db.activityLog.findFirst({ where: { orgId, action: REVIEW_APPROVAL, AND: [{ metadata: { path: ["draftId"], equals: draftId } }, { metadata: { path: ["inputHash"], equals: inputHash } }] }, orderBy: { createdAt: "desc" } }),
    db.activityLog.findFirst({ where: { orgId, action: REVIEW_SUPERSEDED, metadata: { path: ["draftId"], equals: draftId } }, orderBy: { createdAt: "desc" } }),
  ]);
  const review = reviewRecordSchema.safeParse(reviewRow?.metadata);
  return { draftId, jobId: saved.jobId, jobName: saved.job?.jobName || "Project", createdAt: saved.createdAt.toISOString(), draft, assets, audio, originals, inputHash, reviewId, review: review.success ? review.data : null, approvedAt: approval?.createdAt.toISOString() || null, superseded: !!superseded, replacementDraftId: superseded ? (superseded.metadata as { replacementDraftId?: string }).replacementDraftId : undefined, voicePending: audio.some((item) => item.status !== "transcribed") };
}
