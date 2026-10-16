import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { scorecardSchema, SCORECARD_SAVED, SCORECARD_SHARED } from "@/lib/campaign-scorecard";
import { resolveUploadInvite, uploadInviteToken } from "@/lib/field-intake";

const requestSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("save"), report: scorecardSchema }), z.object({ action: z.literal("share"), reportId: z.string().uuid(), inviteId: z.string().uuid() })]);
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth(); } catch { return NextResponse.json({ error: "Sign in to manage results." }, { status: 401 }); }
  if (!canManageOrg(auth.role)) return NextResponse.json({ error: "Only an owner or admin can manage results." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Save and share from the connected app." }, { status: 409 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid report." }, { status: 400 });
  try {
    if (parsed.data.action === "save") {
      if (new Date(parsed.data.report.dataAsOf).getTime() > new Date().getTime() + 300000) return NextResponse.json({ error: "Data timestamp cannot be in the future." }, { status: 400 });
      const record = await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, action: SCORECARD_SAVED, metadata: parsed.data.report } });
      revalidatePath("/marketing/performance");
      return NextResponse.json({ ok: true, id: record.id });
    }
    const record = await prisma.activityLog.findFirst({ where: { id: parsed.data.reportId, orgId: auth.orgId, action: SCORECARD_SAVED } });
    if (!record || !scorecardSchema.safeParse(record.metadata).success) return NextResponse.json({ error: "Report unavailable." }, { status: 404 });
    const token = uploadInviteToken(parsed.data.inviteId);
    const invite = await resolveUploadInvite(token);
    if (!invite || invite.orgId !== auth.orgId) return NextResponse.json({ error: "Choose an active upload link from this organization." }, { status: 400 });
    const shared = await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, action: SCORECARD_SHARED, metadata: { inviteId: invite.id, reportId: record.id, periodStart: scorecardSchema.parse(record.metadata).periodStart, periodEnd: scorecardSchema.parse(record.metadata).periodEnd } } });
    revalidatePath("/marketing/performance");
    return NextResponse.json({ ok: true, url: new URL(`/send-photos/${token}/reports/${shared.id}`, request.url).toString(), expiresAt: invite.expiresAt });
  } catch { return NextResponse.json({ error: "Could not save or share this report. Retry from your dashboard." }, { status: 503 }); }
}
