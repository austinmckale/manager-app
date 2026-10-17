import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { INVITE_CREATED, INVITE_REVOKED, uploadInviteToken } from "@/lib/field-intake";
import { IntakeLinkManager } from "@/components/intake-link-manager";
import { CLIENT_PORTAL_ACCESS, CLIENT_PORTAL_REVOKED } from "@/lib/client-portal-policy";

export default async function IntakeLinksPage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Only the owner and admins can manage photo upload links.</p>;
  const demo = isDemoMode();
  const [invites, revoked, memberships, portalRevoked] = demo ? [[], [], [], []] as const : await Promise.all([
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: INVITE_CREATED }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: INVITE_REVOKED }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: CLIENT_PORTAL_ACCESS }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: CLIENT_PORTAL_REVOKED }, select: { metadata: true }, take: 50 }),
  ]);
  const revokedPortalIds = new Set(portalRevoked.map((record) => (record.metadata as { membershipId?: string } | null)?.membershipId));
  const portalActive = memberships.some((record) => !revokedPortalIds.has(record.id));
  const revokedIds = new Set(revoked.map((record) => (record.metadata as { inviteId?: string } | null)?.inviteId));
  const links = invites.flatMap((record) => {
    const metadata = record.metadata as { expiresAt?: string } | null;
    if (!metadata?.expiresAt || new Date(metadata.expiresAt).getTime() <= new Date().getTime()) return [];
    return [{ id: record.id, path: `/send-photos/${uploadInviteToken(record.id)}`, expiresAt: metadata.expiresAt, revoked: revokedIds.has(record.id) }];
  });
  return <div className="space-y-5"><div><p className="text-xs uppercase tracking-widest text-[#b4411b]">Crew photos</p><h2 className="mt-2 text-2xl font-semibold">Give Ryan one simple link.</h2><p className="mt-2 max-w-xl text-sm text-slate-600">He can also open app.rhipros.com and continue with Google. That account keeps his upload history after a shared link expires. Disabling a link does not remove the account.</p></div><IntakeLinkManager demo={demo} links={links} portalActive={portalActive} /><p className="text-xs text-slate-500">Links last 30 days and allow up to 300 photos. Anyone with the link can submit photos, but cannot browse jobs, view your inbox or publish content. You can disable a link at any time.</p><Link href="/marketing" className="inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm">Open your review queue</Link></div>;
}
