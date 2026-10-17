import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CLIENT_PORTAL_ACCESS, CLIENT_PORTAL_REVOKED, isClientPortalEmail } from "@/lib/client-portal-policy";
import { INVITE_CREATED, resolveUploadInvite, uploadInviteToken } from "@/lib/field-intake";
import { canManageOrg } from "@/lib/permissions";
import type { AuthContext } from "@/lib/auth";
import { z } from "zod";

const accessSchema = z.object({
  emails: z.array(z.string().email()),
  inviteId: z.string().uuid(),
  historyInviteIds: z.array(z.string().uuid()).optional(),
  activeInviteId: z.string().uuid().optional(),
});

export type ClientMembership = {
  id: string;
  orgId: string;
  jobId: string;
  actorId: string | null;
  emails: string[];
  inviteId: string;
  historyInviteIds: string[];
  activeInviteId: string;
};

export const clientPortalUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email || !data.user.email_confirmed_at || !isClientPortalEmail(data.user.email)) return null;
  return { email: data.user.email.trim().toLowerCase(), userId: data.user.id };
});

async function ownedInviteIds(orgId: string, jobId: string, inviteIds: string[]) {
  const ids = [...new Set(inviteIds)];
  if (!ids.length) return [];
  const rows = await prisma.activityLog.findMany({
    where: { id: { in: ids }, orgId, jobId, action: INVITE_CREATED },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  return ids.filter((id) => found.has(id));
}

export async function readClientMembership(email: string): Promise<ClientMembership | null> {
  const normalized = email.trim().toLowerCase();
  if (!isClientPortalEmail(normalized)) return null;
  const rows = await prisma.activityLog.findMany({
    where: { action: CLIENT_PORTAL_ACCESS, metadata: { path: ["emails"], array_contains: [normalized] } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  for (const row of rows) {
    const parsed = accessSchema.safeParse(row.metadata);
    if (!parsed.success || !row.jobId) continue;
    const emails = parsed.data.emails.map((item) => item.toLowerCase());
    if (!emails.includes(normalized)) continue;
    const revoked = await prisma.activityLog.findFirst({
      where: { orgId: row.orgId, action: CLIENT_PORTAL_REVOKED, metadata: { path: ["membershipId"], equals: row.id } },
      select: { id: true },
    });
    if (revoked) continue;
    const job = await prisma.job.findFirst({ where: { id: row.jobId, orgId: row.orgId }, select: { id: true } });
    if (!job) continue;
    const requested = [parsed.data.inviteId, ...(parsed.data.historyInviteIds ?? []), parsed.data.activeInviteId ?? parsed.data.inviteId];
    const historyInviteIds = await ownedInviteIds(row.orgId, job.id, requested);
    if (!historyInviteIds.includes(parsed.data.inviteId)) continue;
    return {
      id: row.id,
      orgId: row.orgId,
      jobId: job.id,
      actorId: row.actorId,
      emails,
      inviteId: parsed.data.inviteId,
      historyInviteIds,
      activeInviteId: historyInviteIds.includes(parsed.data.activeInviteId ?? "") ? parsed.data.activeInviteId! : parsed.data.inviteId,
    };
  }
  return null;
}

export async function ensurePortalUpload(membership: ClientMembership) {
  const candidates = [membership.activeInviteId, ...membership.historyInviteIds];
  for (const id of candidates) {
    const invite = await resolveUploadInvite(uploadInviteToken(id));
    if (invite && invite.orgId === membership.orgId && invite.jobId === membership.jobId) {
      return { token: uploadInviteToken(id), invite, historyInviteIds: membership.historyInviteIds };
    }
  }
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const created = await prisma.activityLog.create({
    data: {
      orgId: membership.orgId,
      actorId: membership.actorId,
      jobId: membership.jobId,
      action: INVITE_CREATED,
      metadata: { label: "Ryan’s photo upload", expiresAt },
    },
  });
  const current = await prisma.activityLog.findUnique({ where: { id: membership.id } });
  const parsed = accessSchema.safeParse(current?.metadata);
  const historyInviteIds = [...new Set([...(parsed.success ? [parsed.data.inviteId, ...(parsed.data.historyInviteIds ?? [])] : membership.historyInviteIds), created.id])];
  await prisma.activityLog.update({
    where: { id: membership.id },
    data: {
      metadata: {
        emails: parsed.success ? parsed.data.emails : membership.emails,
        inviteId: parsed.success ? parsed.data.inviteId : membership.inviteId,
        historyInviteIds,
        activeInviteId: created.id,
      },
    },
  });
  return { token: uploadInviteToken(created.id), invite: { id: created.id, orgId: membership.orgId, jobId: membership.jobId, expiresAt }, historyInviteIds };
}

export async function revokeClientPortal(auth: AuthContext) {
  if (!canManageOrg(auth.role)) throw new Error("Only an owner or admin can revoke portal access.");
  const rows = await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: CLIENT_PORTAL_ACCESS }, orderBy: { createdAt: "desc" }, take: 20 });
  let revoked = 0;
  for (const row of rows) {
    if (!accessSchema.safeParse(row.metadata).success) continue;
    const existing = await prisma.activityLog.findFirst({
      where: { orgId: auth.orgId, action: CLIENT_PORTAL_REVOKED, metadata: { path: ["membershipId"], equals: row.id } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, action: CLIENT_PORTAL_REVOKED, metadata: { membershipId: row.id } } });
    revoked += 1;
  }
  return revoked;
}
