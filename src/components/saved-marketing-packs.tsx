"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { DEMO_PACK_KEY, readDemoPacks, type SavedMarketingPack } from "@/lib/saved-marketing";
import { downloadBlob } from "@/lib/client/marketing-export";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("rhi:demo-pack-saved", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("rhi:demo-pack-saved", callback); };
};
const snapshot = () => { try { return localStorage.getItem(DEMO_PACK_KEY) ?? "[]"; } catch { return "[]"; } };

export function SavedMarketingPacks({ packs, demo }: { packs: SavedMarketingPack[]; demo: boolean }) {
  const localSnapshot = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const localPacks = useMemo(() => { void localSnapshot; return demo ? readDemoPacks() : []; }, [localSnapshot, demo]);
  const entries = demo ? localPacks : packs;
  if (!entries.length) return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center"><h3 className="font-semibold">Save your first marketing pack.</h3><p className="mt-2 text-sm text-slate-500">Choose photos in the review queue, prepare your posts and select Save reusable pack.</p></div>;
  return <div className="grid gap-4 md:grid-cols-2">{entries.map((pack) => <article key={pack.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-xs text-slate-500">{new Date(pack.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}</p>
    <h3 className="mt-2 break-words text-lg font-semibold">{pack.draft.packName || pack.jobName}</h3>
    <p className="mt-1 text-xs text-slate-500">{pack.draft.assetIds.length} photos{pack.draft.publicLocation ? ` · ${pack.draft.publicLocation}` : ""}{pack.draft.service ? ` · ${pack.draft.service}` : ""}</p>
    <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{pack.draft.social || pack.draft.sourceNotes || "Saved captions, ad text and project inputs."}</p>
    <div className="mt-4 flex flex-wrap gap-2"><Link href={demo ? "/marketing/review/example" : `/marketing/review/${pack.id}`} className="rounded-xl bg-teal-700 px-3 py-2 text-sm text-white">Review & approve</Link><Link href={demo ? `/marketing?example=1&demoDraft=${pack.id}` : `/marketing?draftId=${pack.id}`} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Reuse in editor</Link><button className="rounded-xl border border-slate-300 px-3 py-2 text-sm" onClick={() => downloadBlob(new Blob([JSON.stringify(pack.draft, null, 2)], { type: "application/json" }), "rhi-saved-pack.json")}>Download backup</button></div>
  </article>)}</div>;
}
