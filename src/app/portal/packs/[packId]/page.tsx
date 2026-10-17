import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";
import { readMembershipPack } from "@/lib/intake-delivery";
import { CrewFinishedPack } from "@/components/crew-finished-pack";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your finished pack | RHI Photos", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function PortalPackPage({ params }: { params: Promise<{ packId: string }> }) {
  const user = await clientPortalUser();
  if (!user) redirect("/login");
  const membership = await readClientMembership(user.email);
  if (!membership) notFound();
  const { packId } = await params;
  const pack = await readMembershipPack(membership, packId);
  if (!pack) notFound();
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros</p><h1 className="mt-3 text-3xl font-semibold">{pack.draft.packName || "Your finished pack"}</h1><p className="mt-2 text-sm text-slate-600">Your copy, job photos and branded graphics are ready. Choose what you want to post.</p><CrewFinishedPack draft={pack.draft} jobId={pack.jobId} photos={pack.photos.map((photo) => ({ id: photo.id, fileName: photo.fileName, url: `/portal/packs/${packId}/photos/${photo.id}` }))} /><Link href="/portal" className="mt-5 inline-block text-sm text-[#b4411b] underline">Send more job photos</Link></main>;
}
