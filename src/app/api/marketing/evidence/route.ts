import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { GENERATION_ACTION, generationRecordSchema, postTypeSchema } from "@/lib/marketing-evidence";
import { PROCESSING_SETTINGS, processingId, processingSettingsSchema } from "@/lib/marketing-processing";

const schema = z.object({ id: z.string().uuid(), ownerNotes: z.string().trim().min(10).max(6000), postType: postTypeSchema });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing was queued." }, { status: 409 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Add at least 10 characters of job context and choose a post type." }, { status: 400 });
  try {
    const queued = await prisma.$transaction(async (tx) => {
      const row = await tx.activityLog.findFirst({ where: { id: body.data.id, orgId: auth.orgId, action: GENERATION_ACTION } });
      const state = generationRecordSchema.safeParse(row?.metadata);
      if (!row || !state.success || state.data.status !== "held") return false;
      const previous = { ...state.data };
      delete previous.evidence; delete previous.issues; delete previous.checkedFields;
      const result = await tx.activityLog.updateMany({ where: { id: row.id, orgId: auth.orgId, metadata: { equals: row.metadata! } }, data: { metadata: { ...previous, ownerNotes: body.data.ownerNotes, postType: body.data.postType, status: "queued", attempts: 0, runningAt: null, nextRetryAt: null, error: null } } });
      if (result.count !== 1) return false;
      await tx.activityLog.create({ data: { orgId: auth.orgId, jobId: row.jobId, actorId: auth.userId, action: "marketing.evidence.corrected", metadata: { generationId: row.id, previous: JSON.parse(JSON.stringify(state.data)), ownerNotes: body.data.ownerNotes, postType: body.data.postType } } });
      const settingsId = processingId(auth.orgId, "settings");
      const settingsRow = await tx.activityLog.findFirst({ where: { id: settingsId, orgId: auth.orgId, action: PROCESSING_SETTINGS } });
      const settings = processingSettingsSchema.parse(settingsRow?.metadata || {});
      if (settings.mode !== "manual") {
        const metadata = { ...settings, testRequestedAt: new Date().toISOString(), testDraftId: null, testSubmissionId: state.data.submissionId };
        await tx.activityLog.upsert({ where: { id: settingsId }, create: { id: settingsId, orgId: auth.orgId, action: PROCESSING_SETTINGS, metadata }, update: { metadata } });
      }
      return { queued: settings.mode !== "manual" };
    }, { isolationLevel: "Serializable", timeout: 20000 });
    return queued ? NextResponse.json({ ok: true, queued: queued.queued }) : NextResponse.json({ error: "This submission changed or is already queued. Refresh before continuing." }, { status: 409 });
  } catch { return NextResponse.json({ error: "Could not save context. Refresh and try again." }, { status: 503 }); }
}
