import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { loadContentReview } from "@/lib/content-review-store";
import { REVIEW_APPROVAL, REVIEW_REQUEST, REVIEW_SUPERSEDED, canApproveContent, copyChecks } from "@/lib/content-review";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), draftId: z.string().uuid(), inputHash: z.string().length(64) }),
  z.object({ action: z.literal("save"), draftId: z.string().uuid(), inputHash: z.string().length(64), draft: marketingDraftSchema }),
  z.object({ action: z.literal("approve"), draftId: z.string().uuid(), inputHash: z.string().length(64), factsChecked: z.literal(true), photosCleared: z.literal(true), resolution: z.string().trim().max(2000) }),
]);
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
      const base = { orgId: auth.orgId, actorId: auth.userId, jobId: context.jobId };
      if (body.action === "save") {
        if (JSON.stringify(body.draft.assetIds) !== JSON.stringify(context.draft.assetIds)) throw new Error("Photo selection cannot change in this editor.");
        const version = await tx.activityLog.create({ data: { ...base, action: DRAFT_SAVED_ACTION, metadata: { ...body.draft, photoNotes: context.draft.photoNotes, parentDraftId: context.draftId } } });
        await tx.activityLog.create({ data: { ...base, action: REVIEW_SUPERSEDED, metadata: { draftId: context.draftId, replacementDraftId: version.id } } });
        return { draftId: version.id };
      }
      if (context.voicePending) throw new Error("Wait for the original voice recording to finish transcription.");
      if (body.action === "check") {
        if (context.review?.status === "completed") return { alreadyChecked: true };
        if (context.review?.status === "running" && Date.now() - new Date(context.review.startedAt || "").getTime() < 20 * 60000) return { queued: true };
        const metadata = { draftId: context.draftId, inputHash: context.inputHash, status: "queued", requestedAt: new Date().toISOString() };
        await tx.activityLog.upsert({ where: { id: context.reviewId }, create: { ...base, id: context.reviewId, action: REVIEW_REQUEST, metadata }, update: { metadata } });
        return { queued: true };
      }
      if (!canApproveContent(context.inputHash, context.review, context.superseded, context.voicePending) || copyChecks(context.draft).some((finding) => finding.severity === "blocker")) throw new Error("A completed review with no blocking findings is required.");
      if (context.review?.result?.findings.some((finding) => finding.severity === "warning") && body.resolution.length < 10) throw new Error("Explain how you checked the warnings before approving.");
      if (!context.approvedAt) await tx.activityLog.create({ data: { ...base, action: REVIEW_APPROVAL, metadata: { draftId: context.draftId, inputHash: context.inputHash, reviewId: context.reviewId, factsChecked: true, photosCleared: true, resolution: body.resolution } } });
      return { approved: true };
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : "The version changed or could not be saved. Reload and retry.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
