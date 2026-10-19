"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Item = { slug: string; title: string; location: string; service: string; description: string; coverUrl: string; photoCount: number; draftId: string | null; status: "new" | "draft" | "approved" };

const STATUS = { new: "Not posted yet", draft: "Pack ready to review", approved: "Approved" } as const;

async function makePack(slug: string) {
  const response = await fetch("/api/marketing/past-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.draftId) throw new Error(body?.error || "Could not make the pack.");
  return body.draftId as string;
}

export function PastJobsList({ items, demo }: { items: Item[]; demo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const remaining = items.filter((item) => item.status === "new");

  async function makeOne(item: Item) {
    setBusy(item.slug); setMessage("");
    try {
      const draftId = await makePack(item.slug);
      router.push(`/marketing/review/${draftId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make the pack.");
      setBusy(null);
    }
  }

  async function makeAll() {
    setBusy("all"); setMessage("");
    let made = 0;
    for (const item of remaining) {
      setMessage(`Making ${made + 1} of ${remaining.length}: ${item.title}…`);
      try { await makePack(item.slug); made++; } catch (error) { setMessage(`${item.title}: ${error instanceof Error ? error.message : "could not make the pack"}. ${made} made.`); setBusy(null); router.refresh(); return; }
    }
    setBusy(null);
    setMessage(`Made ${made} packs. The AI checks run one at a time on this PC; each one shows suggested fixes on its review page when it finishes.`);
    router.refresh();
  }

  return <div className="space-y-4">
    {remaining.length > 1 ? <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void makeAll()} disabled={demo || busy !== null} className="min-h-11 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Make packs for all {remaining.length}</button>
      <p className="text-sm text-slate-600">Each pack gets an AI check on this PC, a few minutes each.</p>
    </div> : null}
    {message ? <p role="status" aria-live="polite" className="text-sm font-medium text-slate-900">{message}</p> : null}
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => <li key={item.slug} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <img src={item.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
        <div className="p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.service} · {item.location}</p>
          <h3 className="mt-1 font-semibold text-slate-900">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description}</p>
          <p className="mt-2 text-xs text-slate-500">{item.photoCount} photo{item.photoCount === 1 ? "" : "s"} · {STATUS[item.status]}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.draftId ? <Link href={`/marketing/review/${item.draftId}`} className="inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white">Open the pack</Link>
              : <button type="button" onClick={() => void makeOne(item)} disabled={demo || busy !== null} className="min-h-11 rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy === item.slug ? "Making the pack…" : "Make a post from this"}</button>}
            <a href={`https://www.rhipros.com/projects/${item.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-slate-700 underline">On the website</a>
          </div>
        </div>
      </li>)}
    </ul>
  </div>;
}
