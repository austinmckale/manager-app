"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { loadHeldSubmissions } from "@/lib/marketing-evidence-store";

type Item = Awaited<ReturnType<typeof loadHeldSubmissions>>[number];
function HeldSubmission({ item }: { item: Item }) {
  const router = useRouter();
  const [notes, setNotes] = useState(item.ownerNotes);
  const [postType, setPostType] = useState(item.postType);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function retry() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, ownerNotes: notes, postType }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save context.");
      setMessage(result.queued ? "Context saved. One test of this submission is queued, even if automatic processing is off." : "Context saved. Choose Hybrid or Ollama in the processing settings to retry AI checks."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save context."); }
    finally { setBusy(false); }
  }
  return <article className="rounded-xl border border-amber-200 bg-white p-4">
    <h3 className="font-semibold">Needs context · {item.photos.length} photos</h3>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{item.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">View photos, original notes and voice recording</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{item.photos.map((photo) => <figure key={photo.id}>{photo.url ? <img src={photo.url} alt={photo.notes || photo.name} className="aspect-square w-full rounded-lg object-cover" /> : <p>Preview unavailable. Refresh to renew private links.</p>}<figcaption className="mt-2 whitespace-pre-wrap text-xs">{photo.notes || photo.name}</figcaption></figure>)}</div>
      {item.audio.length ? item.audio.map((audio) => <div key={audio.id} className="mt-3 rounded-lg bg-slate-50 p-3">{audio.url ? <audio controls src={audio.url} className="w-full" /> : null}<p className="mt-2 whitespace-pre-wrap text-sm">{audio.transcript || "No transcript available yet."}</p></div>) : <p className="mt-3 text-sm">No voice recording was attached.</p>}
      {item.evidence ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><h4 className="font-medium">Evidence the AI found</h4>{item.evidence.photos.map((photo) => <p key={photo.assetId} className="mt-2">{photo.relevance}: {photo.observations.join(" ")}</p>)}{item.evidence.notes.facts.map((fact, index) => <p key={index} className="mt-2">{fact.source}: “{fact.quote}”</p>)}</div> : null}
    </details>
    <label className="mt-4 block text-sm font-medium">Intended post<select value={postType} disabled={busy} onChange={(event) => setPostType(event.target.value as typeof postType)} className="mt-2 block w-full rounded-lg border p-3"><option value="project">Job / construction update</option><option value="company_life">Company personality / team life</option></select></label>
    <label className="mt-4 block text-sm font-medium">Add or correct the context<textarea rows={4} value={notes} maxLength={6000} disabled={busy} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-lg border p-3" placeholder="What work was done? How do these photos relate? What should the post communicate?" /></label>
    <p className="mt-2 text-xs text-slate-500">Original photos, notes and recordings stay unchanged. Corrections are saved separately. AI will check the evidence again.</p>
    <button disabled={busy || notes.trim().length < 10} onClick={() => void retry()} className="mt-3 rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : "Save context & retry checks"}</button>
    <p role="status" className="mt-2 text-sm">{message}</p>
  </article>;
}
export function MarketingEvidenceQueue({ items }: { items: Item[] }) {
  return <section className="space-y-3" aria-label="Submissions needing context"><h2 className="font-semibold">Submissions needing context</h2><p className="text-sm text-slate-600">Each photo is checked before writing. Irrelevant images, conflicting notes or unsupported claims hold the submission here.</p>{items.length ? items.map((item) => <HeldSubmission key={item.id} item={item} />) : <p className="rounded-xl border p-4 text-sm">No submissions are held for context.</p>}</section>;
}
