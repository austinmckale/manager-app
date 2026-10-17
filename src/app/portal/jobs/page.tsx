import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";
import { intakeHistoryForInvites } from "@/lib/intake-history";
import { portalSubmissionStatus } from "@/lib/portal-submission";

export const dynamic = "force-dynamic";
export const metadata = { title: "My uploads | RHI Photos", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function PortalUploadsPage() {
  const user = await clientPortalUser();
  if (!user) redirect("/login");
  const membership = await readClientMembership(user.email);
  if (!membership) notFound();
  const batches = await intakeHistoryForInvites(membership);
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros</p><h1 className="mt-3 text-3xl font-semibold">My uploads</h1><p className="mt-2 text-sm text-slate-600">Your job photos, voice notes and progress stay with your account.</p><Link href="/portal" className="mt-5 inline-block rounded-xl bg-[#b4411b] px-4 py-3 font-semibold text-white">+ Add job photos</Link><div className="mt-5 space-y-3">{batches.length ? batches.map((batch) => <Link key={batch.id} href={`/portal/jobs/${batch.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">{batch.location || `Job upload · ${new Date(batch.createdAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}`}</h2><p className="mt-2 text-sm text-slate-600">{batch.photos.length} photos{batch.voiceId ? " · voice note" : ""}</p><p className="mt-2 text-xs font-semibold text-[#b4411b]">{portalSubmissionStatus(batch)}</p></Link>) : <p className="rounded-2xl border p-5 text-sm text-slate-600">Your uploads will appear here after you tap Send.</p>}</div></main>;
}
