import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { loadContentReview } from "@/lib/content-review-store";
import { CHAT_EDIT_TAG, REVIEW_APPROVAL, REVIEW_REQUEST, REVIEW_SUPERSEDED, allowedPhotoSelection, canApproveContent, copyChecks, editedFromTag, needsResolutionNote } from "@/lib/content-review";
import { PROCESSING_SETTINGS, processingId, processingSettingsSchema } from "@/lib/marketing-processing";
import { draftPublishability } from "@/lib/publishability";
import { CAPTION_FIELDS, CAPTION_LOCKS_ACTION, captionFieldSchema, captionLocksId } from "@/lib/caption-revision";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), draftId: z.string().uuid(), inputHash: z.string().length(64) }),
  // check: true saves the version and queues the AI check of every caption on it, in one step.
  z.object({ action: z.literal("save"), draftId: z.string().uuid(), inputHash: z.string().length(64), draft: marketingDraftSchema, check: z.boolean().optional(), lockedFields: z.array(captionFieldSchema).max(CAPTION_FIELDS.length).optional() }),
  // Which captions the owner kept. Stored beside the version, so keeping a caption never changes the version or its checks.
  z.object({ action: z.literal("locks"), draftId: z.string().uuid(), inputHash: z.string().length(64), fields: z.array(captionFieldSchema).max(CAPTION_FIELDS.length) }),
  z.object({ action: z.literal("approve"), draftId: z.string().uuid(), inputHash: z.string().length(64), factsChecked: z.literal(true), photosCleared: z.literal(true), resolution: z.string().trim().max(2000) }),
]);
async function saveLocks(tx: Prisma.TransactionClient, base: { orgId: string; actorId: string; jobId: string }, draftId: string, fields: string[]) {
  const id = captionLocksId(base.orgId, draftId);
  const metadata = { draftId, fields: [...new Set(fields)] };
  await tx.activityLog.upsert({ where: { id }, create: { ...base, id, action: CAPTION_LOCKS_ACTION, metadata }, update: { metadata } });
}
async function queueCheck(tx: Prisma.TransactionClient, base: { orgId: string; actorId: string; jobId: string }, target: { draftId: string; inputHash: string; reviewId: string }) {
  const metadata = { draftId: target.draftId, inputHash: target.inputHash, status: "queued", requestedAt: new Date().toISOString() };
  await tx.activityLog.upsert({ where: { id: target.reviewId }, create: { ...base, id: target.reviewId, action: REVIEW_REQUEST, metadata }, update: { metadata } });
  const settingsId = processingId(base.orgId, "settings");
  const setting = await tx.activityLog.findFirst({ where: { id: settingsId, orgId: base.orgId, action: PROCESSING_SETTINGS } });
  const settings = processingSettingsSchema.parse(setting?.metadata || {});
  const requested = { ...settings, testRequestedAt: new Date().toISOString(), testDraftId: target.draftId, testSubmissionId: null };
  await tx.activityLog.upsert({ where: { id: settingsId }, create: { ...base, id: settingsId, action: PROCESSING_SETTINGS, metadata: requested }, update: { metadata: requested } });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing is approved or queued." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the fields and required confirmations." }, { status: 400 });
  const body = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const context = await loadContentReview(auth.orgId, body.draftId, tx);
      if (!context || context.inputHash !== body.inputHash || context.superseded) throw new Error("This version changed or was replaced. Reload before continuing.");
      if (body.action === "locks") {
        await saveLocks(tx, { orgId: auth.orgId, actorId: auth.userId, jobId: context.jobId }, context.draftId, body.fields);
        return { locked: body.fields.length };
      }
      const publishability = draftPublishability(context.draft, context.originals, context.assets);
      const incoming = body.action === "save" ? draftPublishability(body.draft) : { blocked: false, reasons: [] as string[] };
      if (publishability.blocked || incoming.blocked) throw new Error(`This submission cannot be saved, checked, approved, queued, or posted. ${(publishability.blocked ? publishability : incoming).reasons.join(", ")}.`);
      const base = { orgId: auth.orgId, actorId: auth.userId, jobId: context.jobId };
      if (body.action === "save") {
        const added = body.draft.assetIds.filter((id) => !context.draft.assetIds.includes(id));
        const edits = added.length ? await tx.fileAsset.findMany({ where: { id: { in: added }, jobId: context.jobId, type: "PHOTO", job: { orgId: auth.orgId }, AND: [{ tags: { has: CHAT_EDIT_TAG } }, { tags: { hasSome: context.draft.assetIds.map(editedFromTag) } }] }, select: { id: true } }) : [];
        if (!allowedPhotoSelection(body.draft.assetIds, [...context.draft.assetIds, ...edits.map((edit) => edit.id)])) throw new Error("Photo selection cannot add photos that are not already on this version.");
        const version = await tx.activityLog.create({ data: { ...base, action: DRAFT_SAVED_ACTION, metadata: { ...body.draft, photoNotes: context.draft.photoNotes, parentDraftId: context.draftId } } });
        await tx.activityLog.create({ data: { ...base, action: REVIEW_SUPERSEDED, metadata: { draftId: context.draftId, replacementDraftId: version.id } } });
        if (body.lockedFields) await saveLocks(tx, base, version.id, body.lockedFields);
        if (body.check) {
          const saved = await loadContentReview(auth.orgId, version.id, tx);
          if (saved && !saved.voicePending) {
            await queueCheck(tx, base, saved);
            return { draftId: version.id, queued: true };
          }
        }
        return { draftId: version.id };
      }
      if (context.voicePending) throw new Error("Wait for the original voice recording to finish transcription.");
      if (body.action === "check") {
        if (context.review?.status === "completed" && context.review.policyVersion === 3) return { alreadyChecked: true };
        if (context.review?.status === "running" && Date.now() - new Date(context.review.startedAt || "").getTime() < 20 * 60000) return { queued: true };
        await queueCheck(tx, base, context);
        return { queued: true };
      }
      if (!canApproveContent(context.inputHash, context.review, context.superseded, context.voicePending) || copyChecks(context.draft).some((finding) => finding.severity === "blocker")) throw new Error("A completed review with no blocking findings is required.");
      if (needsResolutionNote(context.review?.result?.findings ?? []) && body.resolution.length < 10) throw new Error("Explain how you checked the warnings before approving.");
      if (!context.approvedAt) await tx.activityLog.create({ data: { ...base, action: REVIEW_APPROVAL, metadata: { draftId: context.draftId, inputHash: context.inputHash, reviewId: context.reviewId, factsChecked: true, photosCleared: true, resolution: body.resolution } } });
      return { approved: true };
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : "The version changed or could not be saved. Reload and retry.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
