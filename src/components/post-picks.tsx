"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PickStatus } from "@/lib/post-picks";
import { bufferSelections, type PickChannel } from "@/lib/post-picks-rules";

export type PickCard = {
  draftId: string; inputHash: string; source: "past" | "new"; title: string; createdAt: string;
  social: string; googleBusiness: string; assetIds: string[]; photos: { id: string; url: string; description: string }[]; photoCount: number;
  status: PickStatus; notes: string[]; lastSentAt: string | null;
};

const STATUS: Record<PickStatus, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-teal-50 text-teal-900" },
  look: { label: "Ready, worth a look", tone: "bg-amber-50 text-amber-900" },
  approved: { label: "Approved, not sent", tone: "bg-teal-50 text-teal-900" },
  preparing: { label: "Your PC is writing it", tone: "bg-slate-100 text-slate-800" },
  checking: { label: "Your PC is checking it", tone: "bg-slate-100 text-slate-800" },
  unchecked: { label: "Not checked yet", tone: "bg-slate-100 text-slate-800" },
  failed: { label: "Check did not finish", tone: "bg-red-50 text-red-900" },
  blocked: { label: "Needs changes", tone: "bg-red-50 text-red-900" },
};
const readyStatuses: PickStatus[] = ["ready", "look", "approved"];
const busyStatuses: PickStatus[] = ["preparing", "checking"];
const primary = "inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const secondary = "inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-40";

async function post(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(125000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "That did not work. Try again.");
  return data;
}

const deliveryWords: Record<string, string> = { draft: "private draft in Buffer", queued: "in the Buffer queue", published: "published", sending: "being published", preparing: "still preparing", unknown: "not confirmed, check Buffer", rejected: "not sent", failed: "failed, check Buffer", needs_approval: "waiting for approval in Buffer" };

function PostIt({ card, channels, demo, onDone }: { card: PickCard; channels: PickChannel[]; demo: boolean; onDone: (text: string) => void }) {
  const [facts, setFacts] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"draft" | "queue">("draft");
  const [queueOk, setQueueOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selections = bufferSelections(channels, card.assetIds);
  const needsNote = card.status === "look";
  const approved = card.status === "approved";
  const ready = (approved || (facts && photos && (!needsNote || note.trim().length >= 10))) && selections.length > 0 && (mode === "draft" || queueOk);
  const where = selections.map((selection) => { const channel = channels.find((item) => item.id === selection.channelId)!; return `${channel.name} (${channel.service === "googlebusiness" ? "photo 1" : `${selection.assetIds.length} photo${selection.assetIds.length === 1 ? "" : "s"}`})`; }).join(" and ");

  async function send() {
    setBusy(true); setError("");
    try {
      if (!approved) await post("/api/marketing/review", { action: "approve", draftId: card.draftId, inputHash: card.inputHash, factsChecked: true, photosCleared: true, resolution: note.trim() });
      const result = await post("/api/publishing/buffer/deliveries", { action: "send", draftId: card.draftId, inputHash: card.inputHash, mode, queueConfirmed: mode === "queue" && queueOk, selections });
      const records = Array.isArray(result?.records) ? result.records as { channelName: string; status: string }[] : [];
      onDone(records.length ? `Sent: ${records.map((record) => `${record.channelName}, ${deliveryWords[record.status] ?? record.status}`).join("; ")}.` : "Approved. Buffer did not confirm the posts; check the delivery history on the Buffer page before sending again.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
      setBusy(false);
    }
  }

  return <div className="mt-3 space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-3">
    {approved ? <p className="text-sm text-slate-800">You already approved this version.</p> : <>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={facts} onChange={(event) => setFacts(event.target.checked)} className="mt-1" />The text is true to the job.</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={photos} onChange={(event) => setPhotos(event.target.checked)} className="mt-1" />I looked at the photos and we can use them publicly.</label>
      {needsNote ? <label className="block text-sm font-medium">How you checked what the AI flagged
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} placeholder="For example: checked the photos, the counters are quartz" className="mt-1 w-full rounded-xl border p-2 text-sm font-normal" />
      </label> : null}
    </>}
    <fieldset className="space-y-1 text-sm">
      <legend className="font-medium">Send as</legend>
      <label className="flex gap-2"><input type="radio" name={`mode-${card.draftId}`} checked={mode === "draft"} onChange={() => setMode("draft")} className="mt-1" />A private Buffer draft. You set the time in Buffer.</label>
      <label className="flex gap-2"><input type="radio" name={`mode-${card.draftId}`} checked={mode === "queue"} onChange={() => setMode("queue")} className="mt-1" />Add to the Buffer queue. Buffer posts it at the next open slot.</label>
      {mode === "queue" ? <label className="ml-6 flex gap-2"><input type="checkbox" checked={queueOk} onChange={(event) => setQueueOk(event.target.checked)} className="mt-1" />Buffer may publish it on my queue schedule.</label> : null}
    </fieldset>
    <p className="text-sm text-slate-700">{selections.length ? `Goes to ${where}.` : "No Facebook or Google Business channel is saved. Choose them on the Buffer page first."}</p>
    {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
    <button type="button" onClick={() => void send()} disabled={demo || busy || !ready} className={primary}>{busy ? "Sending…" : approved ? "Send to Buffer" : "Approve and send to Buffer"}</button>
  </div>;
}

function Card({ card, channels, demo, onChanged }: { card: PickCard; channels: PickChannel[]; demo: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = STATUS[card.status];
  const canPost = readyStatuses.includes(card.status);

  async function skip() {
    setBusy(true); setError("");
    try { await post("/api/marketing/picks", { action: "skip", draftId: card.draftId }); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not skip it."); setBusy(false); }
  }

  return <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex gap-1 overflow-hidden">
      {card.photos.slice(0, 3).map((photo, index) => <div key={photo.id} className="relative min-w-0 flex-1">
        <img src={photo.url} alt={photo.description || `Photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        {index === 2 && card.photoCount > 3 ? <span className="absolute bottom-1 right-1 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">+{card.photoCount - 3}</span> : null}
      </div>)}
    </div>
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.source === "past" ? "Past job" : "New job"}</span>
      </div>
      <h3 className="font-semibold text-slate-900">{card.title}</h3>
      <div>
        <p className="text-xs font-semibold text-slate-500">Facebook & Instagram</p>
        <p className={`whitespace-pre-wrap text-sm text-slate-900 ${full ? "" : "line-clamp-4"}`}>{card.social}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500">Google Business</p>
        <p className={`whitespace-pre-wrap text-sm text-slate-900 ${full ? "" : "line-clamp-2"}`}>{card.googleBusiness}</p>
      </div>
      <button type="button" onClick={() => setFull(!full)} className="text-sm text-teal-900 underline">{full ? "Show less" : "Show all the text"}</button>
      {card.notes.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{card.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {card.lastSentAt ? <p className="text-xs text-slate-500">Last sent to Buffer {new Date(card.lastSentAt).toLocaleDateString()}.</p> : null}
      {done ? <p role="status" className="text-sm font-medium text-teal-900">{done}</p> : <>
        <div className="flex flex-wrap gap-2 pt-1">
          {canPost ? <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={primary}>{open ? "Cancel" : "Post it"}</button> : null}
          <Link href={`/marketing/review/${demo ? "example" : card.draftId}`} className={secondary}>{canPost || busyStatuses.includes(card.status) ? "Edit" : "Fix it"}</Link>
          {!busyStatuses.includes(card.status) ? <button type="button" onClick={() => void skip()} disabled={demo || busy} className={secondary}>Skip for 30 days</button> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        {open && canPost ? <PostIt card={card} channels={channels} demo={demo} onDone={(text) => { setDone(text); setOpen(false); setTimeout(onChanged, 4000); }} /> : null}
      </>}
    </div>
  </li>;
}

export function PostPicks({ cards, channels, channelError, unmadePastJobs, demo }: { cards: PickCard[]; channels: PickChannel[]; channelError: string; unmadePastJobs: number; demo: boolean }) {
  const router = useRouter();
  const [filling, setFilling] = useState(false);
  const [message, setMessage] = useState("");
  const ready = cards.filter((card) => readyStatuses.includes(card.status));
  const working = cards.filter((card) => busyStatuses.includes(card.status));
  const stuck = cards.filter((card) => !readyStatuses.includes(card.status) && !busyStatuses.includes(card.status));

  // While this PC is writing or checking posts, look for finished ones every 30 seconds.
  useEffect(() => {
    if (!working.length) return;
    const timer = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(timer);
  }, [working.length, router]);

  async function fill() {
    setFilling(true); setMessage("Making packs from the website's past jobs…");
    let made = 0;
    let queued = 0;
    try {
      for (let round = 0; round < 12; round++) {
        const result = await post("/api/marketing/picks", { action: "fill" });
        made += result.made ?? 0;
        queued += result.queued ?? 0;
        if (!result.remaining) break;
        setMessage(`Made ${made} pack${made === 1 ? "" : "s"} so far…`);
      }
      setMessage(made || queued ? `Made ${made} new pack${made === 1 ? "" : "s"} and lined up ${queued} post${queued === 1 ? "" : "s"} for your PC to write and check, a few minutes each. They appear under Ready when done.` : "Nothing new to prepare. Every past job already has a post here, was changed by you, or went to Buffer in the last 90 days.");
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Could not fill the picks.");
    }
    setFilling(false);
    router.refresh();
  }

  const list = (items: PickCard[]) => <ul className="grid gap-3 md:grid-cols-2">{items.map((card) => <Card key={card.draftId} card={card} channels={channels} demo={demo} onChanged={() => router.refresh()} />)}</ul>;

  return <div className="space-y-5">
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <button type="button" onClick={() => void fill()} disabled={demo || filling} className={primary}>{filling ? "Filling…" : "Fill my picks"}</button>
      <p className="min-w-0 flex-1 text-sm text-slate-700">{unmadePastJobs ? `Makes posts from the ${unmadePastJobs} past job${unmadePastJobs === 1 ? "" : "s"} not here yet and has` : "Has"} your PC rewrite and check every past-job post nobody has changed. Nothing is approved or posted.</p>
      {message ? <p role="status" aria-live="polite" className="w-full text-sm font-medium text-slate-900">{message}</p> : null}
    </section>
    {channelError ? <p role="alert" className="text-sm text-red-700">{channelError}</p> : null}
    <section className="space-y-2">
      <h3 className="text-lg font-semibold">Ready to post ({ready.length})</h3>
      {ready.length ? list(ready) : <p className="text-sm text-slate-600">None yet. {working.length ? "Your PC is preparing some below." : "Press Fill my picks, or wait for Ryan's next upload."}</p>}
    </section>
    {working.length ? <section className="space-y-2">
      <h3 className="text-lg font-semibold">Being prepared on your PC ({working.length})</h3>
      <p className="text-sm text-slate-600">One at a time, a few minutes each. This page checks for finished ones every 30 seconds. Your PC and local AI need to be on.</p>
      {list(working)}
    </section> : null}
    {stuck.length ? <details className="rounded-2xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer font-semibold">Needs your attention ({stuck.length})</summary>
      <div className="mt-3">{list(stuck)}</div>
    </details> : null}
  </div>;
}
