import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";
import { membershipScorecards } from "@/lib/shared-scorecards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing reports | RHI Photos", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function PortalReportsPage() {
  const user = await clientPortalUser();
  if (!user) redirect("/login");
  const membership = await readClientMembership(user.email);
  if (!membership) notFound();
  const reports = await membershipScorecards(membership);
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><Link href="/portal" className="text-sm text-[#b4411b] underline">← Your photo app</Link><h1 className="mt-5 text-3xl font-semibold">Marketing reports</h1><p className="mt-2 text-sm text-slate-600">Campaign results and next steps shared with you.</p><div className="mt-5 space-y-3">{reports.length ? reports.map((report) => <Link key={report.id} href={`/portal/reports/${report.id}`} className="block rounded-2xl border bg-white p-4 font-semibold">{report.periodStart} – {report.periodEnd} →</Link>) : <p className="rounded-2xl border p-5 text-sm text-slate-600">Your results reports will appear here when they’re shared with you.</p>}</div></main>;
}
