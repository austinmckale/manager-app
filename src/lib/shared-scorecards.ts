import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveUploadInvite } from "@/lib/field-intake";
import { SCORECARD_SAVED, SCORECARD_SHARED, scorecardSchema } from "@/lib/campaign-scorecard";

export async function sharedScorecards(token: string) {
  const invite = await resolveUploadInvite(token);
  if (!invite) return null;
  const rows = await prisma.activityLog.findMany({ where: { orgId: invite.orgId, action: SCORECARD_SHARED, metadata: { path: ["inviteId"], equals: invite.id } }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.flatMap((row) => { const meta = z.object({ inviteId: z.string().uuid(), periodStart: z.string(), periodEnd: z.string() }).safeParse(row.metadata); return meta.success && meta.data.inviteId === invite.id ? [{ id: row.id, periodStart: meta.data.periodStart, periodEnd: meta.data.periodEnd }] : []; });
}
export async function readSharedScorecard(token: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const invite = await resolveUploadInvite(token);
  if (!invite) return null;
  const shared = await prisma.activityLog.findFirst({ where: { id, orgId: invite.orgId, action: SCORECARD_SHARED } });
  const meta = z.object({ inviteId: z.string().uuid(), reportId: z.string().uuid() }).safeParse(shared?.metadata);
  if (!meta.success || meta.data.inviteId !== invite.id) return null;
  const record = await prisma.activityLog.findFirst({ where: { id: meta.data.reportId, orgId: invite.orgId, action: SCORECARD_SAVED } });
  const parsed = scorecardSchema.safeParse(record?.metadata);
  return parsed.success ? parsed.data : null;
}

export async function membershipScorecards(scope: { orgId: string; historyInviteIds: string[] }) {
  const allowed = new Set(scope.historyInviteIds);
  if (!allowed.size) return [];
  const rows = await prisma.activityLog.findMany({ where: { orgId: scope.orgId, action: SCORECARD_SHARED }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.flatMap((row) => {
    const meta = z.object({ inviteId: z.string().uuid(), periodStart: z.string(), periodEnd: z.string() }).safeParse(row.metadata);
    return meta.success && allowed.has(meta.data.inviteId) ? [{ id: row.id, periodStart: meta.data.periodStart, periodEnd: meta.data.periodEnd }] : [];
  });
}

export async function readMembershipScorecard(scope: { orgId: string; historyInviteIds: string[] }, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const shared = await prisma.activityLog.findFirst({ where: { id, orgId: scope.orgId, action: SCORECARD_SHARED } });
  const meta = z.object({ inviteId: z.string().uuid(), reportId: z.string().uuid() }).safeParse(shared?.metadata);
  if (!meta.success || !scope.historyInviteIds.includes(meta.data.inviteId)) return null;
  const record = await prisma.activityLog.findFirst({ where: { id: meta.data.reportId, orgId: scope.orgId, action: SCORECARD_SAVED } });
  const parsed = scorecardSchema.safeParse(record?.metadata);
  return parsed.success ? parsed.data : null;
}
