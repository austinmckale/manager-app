import Link from "next/link";
import { notFound } from "next/navigation";
import { readIntakePack } from "@/lib/intake-delivery";
import { CrewFinishedPack } from "@/components/crew-finished-pack";
import { isDemoMode } from "@/lib/demo";
import { exampleDraft, examplePhotos, exampleJobId } from "@/lib/marketing-example";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your finished pack | RHI Photos", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function FinishedPackPage({ params }: { params: Promise<{ token: string; packId: string }> }) {
  const { token, packId } = await params;
  if (isDemoMode() && token === "preview" && packId === "example") return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros · example</p><h1 className="mt-3 text-3xl font-semibold">{exampleDraft.packName}</h1><p className="mt-2 text-sm text-slate-600">Example of what Ryan receives. Download photos, branded graphics and ready-to-post copy.</p><CrewFinishedPack draft={{ ...exampleDraft, sourceNotes: "", photoNotes: [] }} photos={examplePhotos} jobId={exampleJobId} /><Link href="/send-photos/preview" className="mt-5 inline-block text-sm underline">Back to photo upload</Link></main>;
  const pack = await readIntakePack(token, packId);
  if (!pack) notFound();
  const base = `/send-photos/${encodeURIComponent(token)}/packs/${packId}`;
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros</p><h1 className="mt-3 text-3xl font-semibold">{pack.draft.packName || "Your finished pack"}</h1><p className="mt-2 text-sm text-slate-600">Your copy, job photos and branded graphics are ready. Choose what you want to post.</p><CrewFinishedPack draft={pack.draft} jobId={pack.jobId} photos={pack.photos.map((photo) => ({ id: photo.id, fileName: photo.fileName, url: `${base}/photos/${photo.id}` }))} /><Link href={`/send-photos/${encodeURIComponent(token)}`} className="mt-5 inline-block text-sm text-[#b4411b] underline">Send more job photos</Link></main>;
}
