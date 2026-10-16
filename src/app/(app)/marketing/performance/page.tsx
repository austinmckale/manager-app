import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { SCORECARD_SAVED, scorecardSchema } from "@/lib/campaign-scorecard";
import { INVITE_CREATED, resolveUploadInvite, uploadInviteToken } from "@/lib/field-intake";
import { CampaignScorecardEditor } from "@/components/campaign-scorecard-editor";

export const dynamic = "force-dynamic";
export default async function PerformancePage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Only the owner and admins can manage campaign results.</p>;
  const demo = isDemoMode();
  const [records, inviteRecords] = demo ? [[], []] : await Promise.all([
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: SCORECARD_SAVED }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: INVITE_CREATED }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const saved = records.flatMap((record) => { const parsed = scorecardSchema.safeParse(record.metadata); return parsed.success ? [{ id: record.id, report: parsed.data, createdAt: record.createdAt.toISOString() }] : []; });
  const invites = (await Promise.all(inviteRecords.map(async (record) => { const valid = await resolveUploadInvite(uploadInviteToken(record.id)); return valid ? { id: record.id, label: `Ryan’s upload link · created ${record.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}` } : null; }))).filter((invite) => invite !== null);
  const now = new Date();
  return <div className="space-y-5"><section className="rounded-2xl bg-teal-900 p-5 text-white"><p className="text-xs uppercase tracking-widest text-teal-200">Campaign performance</p><h1 className="mt-2 text-2xl font-semibold">Show Ryan what the marketing produced.</h1><p className="mt-2 max-w-2xl text-sm text-teal-50">Compare campaign spend with qualified inquiries and booked work. Keep dated snapshots, explain the next steps, and share a report he can read without using your dashboard.</p><Link href="/marketing" className="mt-4 inline-block rounded-xl border border-white/40 px-3 py-2 text-sm">Back to marketing</Link></section><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Live ad-account reporting is not connected.</strong> This scorecard uses figures you enter from exports and lead records. It does not fetch ad spend, send email, change budgets, or publish anything. The email button opens a draft for you to send.</div><CampaignScorecardEditor saved={saved} invites={invites} periodStart={new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10)} periodEnd={now.toISOString().slice(0, 10)} dataAsOf={now.toISOString()} demo={demo} /></div>;
}
