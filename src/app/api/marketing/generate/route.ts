import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { PHOTO_RECEIVED } from "@/lib/field-intake";
import { ARCHIVED_PHOTO_TAG } from "@/lib/marketing";
import { ownerAssetIds, ownerGenerationBodySchema, ownerInviteFromReceipts, OwnerGenerationError } from "@/lib/marketing-generation-request";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { queueOwnerGenerationJob } from "../../../../../scripts/local-generation-queue";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing was queued." }, { status: 409 });
  const body = ownerGenerationBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose one saved submission." }, { status: 400 });
  try {
    const receipts = await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: PHOTO_RECEIVED, metadata: { path: ["submissionId"], equals: body.data.submissionId } }, orderBy: { createdAt: "asc" }, take: 30, select: { orgId: true, jobId: true, action: true, metadata: true } });
    const invite = ownerInviteFromReceipts(auth.orgId, body.data.submissionId, receipts);
    const assets = await prisma.fileAsset.findMany({ where: { tags: { hasEvery: [`intake:${invite.inviteId}`, `submission:${body.data.submissionId}`] }, job: { orgId: auth.orgId }, NOT: { tags: { has: ARCHIVED_PHOTO_TAG } } }, orderBy: { createdAt: "asc" }, take: 25, select: { id: true, tags: true, job: { select: { orgId: true } } } });
    const assetIds = ownerAssetIds(auth.orgId, invite.inviteId, body.data.submissionId, invite.fileAssetIds, assets);
    const queued = await queueOwnerGenerationJob(prisma, auth.orgId, invite.jobId, invite.inviteId, body.data.submissionId, assetIds, auth.userId);
    return NextResponse.json({ ok: true, id: queued.id, submissionId: queued.job.submissionId, inviteId: queued.job.inviteId, status: queued.job.status, attempts: queued.job.attempts, engine: queued.job.engine ?? null, source: queued.job.source ?? null, deduped: queued.deduped, approved: queued.approved });
  } catch (error) {
    if (error instanceof OwnerGenerationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not queue generation. The submission is still saved." }, { status: 503 });
  }
}
