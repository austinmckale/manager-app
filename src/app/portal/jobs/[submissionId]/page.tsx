/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";
import { intakeHistoryForInvites } from "@/lib/intake-history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your job upload | RHI Photos", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function PortalJobPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const user = await clientPortalUser();
  if (!user) redirect("/login");
  const membership = await readClientMembership(user.email);
  if (!membership) notFound();
  const { submissionId } = await params;
  const batch = (await intakeHistoryForInvites(membership)).find((item) => item.id === submissionId);
  if (!batch) notFound();
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><Link href="/portal/jobs" className="text-sm text-[#b4411b] underline">← My uploads</Link><h1 className="mt-5 text-2xl font-semibold">{batch.location || "Your job upload"}</h1><p className="mt-2 text-sm text-slate-500">Received {new Date(batch.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} Eastern</p><div className="mt-5 grid grid-cols-2 gap-2">{batch.photos.map((photo) => <img key={photo.id} src={`/portal/jobs/${batch.id}/media/${photo.id}`} alt="Your uploaded job photo" className="aspect-square w-full rounded-xl object-cover" />)}</div>{batch.note ? <section className="mt-5 rounded-2xl border bg-white p-4"><h2 className="font-semibold">Your note</h2><p className="mt-2 whitespace-pre-wrap text-sm">{batch.note}</p></section> : null}{batch.voiceId ? <section className="mt-5 rounded-2xl border bg-white p-4"><h2 className="font-semibold">Your voice note</h2><audio controls src={`/portal/jobs/${batch.id}/media/${batch.voiceId}`} className="mt-3 w-full" />{batch.transcript ? <p className="mt-3 whitespace-pre-wrap text-sm">{batch.transcript}</p> : <p className="mt-3 text-sm text-slate-500">Received. Your recording is waiting to be turned into notes.</p>}</section> : null}{batch.ready && batch.packId ? <Link href={`/portal/packs/${batch.packId}`} className="mt-5 block rounded-xl bg-[#b4411b] p-4 text-center font-semibold text-white">View prepared content</Link> : <p className="mt-5 rounded-xl bg-teal-50 p-4 text-sm text-teal-900">{batch.packId ? "Content prepared. We’ll let you know when it’s ready for you." : "We have your upload and will take it from here."}</p>}</main>;
}
