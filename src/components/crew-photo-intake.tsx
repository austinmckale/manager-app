"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { openDB } from "idb";
import { preparePhoto } from "@/lib/client/prepare-photo";
import { CrewInstallHelp } from "@/components/crew-install-help";
import Link from "next/link";
import { CrewVoiceRecorder, type CrewVoiceNote } from "@/components/crew-voice-note";

type Photo = { id: string; fileName: string; dataUrl: string };
type Draft = { submissionId: string; location: string; description: string; stage: "BEFORE" | "DURING" | "AFTER" | ""; photos: Photo[]; voice?: CrewVoiceNote | null };
const emptyDraft = (): Draft => ({ submissionId: crypto.randomUUID(), location: "", description: "", stage: "", photos: [] });
let connection: ReturnType<typeof openDB> | undefined;
const database = () => connection ??= openDB("rhi-crew-photo-drafts", 1, { upgrade(db) { db.createObjectStore("drafts"); } });
async function dataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

export function CrewPhotoIntake({ token, preview = false, packs = [], jobsHref, reportsHref, packBase, draftKey }: { token: string; preview?: boolean; packs?: { id: string; name: string }[]; jobsHref?: string; reportsHref?: string; packBase?: string; draftKey?: string }) {
  const key = draftKey || token.split(".")[0];
  const [draft, setDraft] = useState<Draft>({ submissionId: "", location: "", description: "", stage: "", photos: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const storageAvailable = useRef(true);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void database().then(async (db) => {
      const saved = await db.get("drafts", key) as Draft | undefined;
      if (active) { const next = saved ?? emptyDraft(); draftRef.current = next; setDraft(next); setLoaded(true); }
    }).catch(() => { if (active) { storageAvailable.current = false; const next = emptyDraft(); draftRef.current = next; setDraft(next); setLoaded(true); setError("Device storage is unavailable. Keep your original photos and keep this screen open until sending finishes."); } });
    return () => { active = false; };
  }, [key]);

  async function save(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    if (storageAvailable.current) {
      const write = writes.current.catch(() => undefined).then(async () => { const db = await database(); await db.put("drafts", next, key); });
      writes.current = write;
      await write;
    }
  }
  function edit(field: "location" | "description" | "stage", value: string) {
    const next = { ...draftRef.current, [field]: value } as Draft;
    void save(next).catch(() => setError("Could not save this draft on your device. Keep the screen open and keep your originals."));
  }
  async function add(files: FileList | null) {
    if (!files?.length || busy || !loaded) return;
    if (draftRef.current.photos.length + files.length > 12) { setError("Send up to 12 photos at a time, then add another batch."); return; }
    setBusy(true); setError(""); setSent(0);
    const failed: string[] = [];
    try {
      for (const original of Array.from(files)) {
        try {
          setMessage(`Preparing ${original.name}…`);
          const photo = await preparePhoto(original);
          await save({ ...draftRef.current, photos: [...draftRef.current.photos, { id: crypto.randomUUID(), fileName: photo.name, dataUrl: await dataUrl(photo) }] });
        } catch { failed.push(original.name); }
      }
      setMessage(`${draftRef.current.photos.length} photo${draftRef.current.photos.length === 1 ? "" : "s"} ready to send.`);
      if (failed.length) setError(`Could not prepare: ${failed.join(", ")}. Keep the originals and try another photo or JPG format.`);
    } finally { setBusy(false); }
  }
  async function send() {
    if (busy || recordingVoice || !draft.photos.length) return;
    if (preview) { setError("This is the preview. Use Ryan’s live upload link to send real photos."); return; }
    setBusy(true); setError(""); setSent(0);
    const batch = draftRef.current;
    let successful = 0;
    try {
      if (!navigator.onLine) throw new Error("You’re offline. Your draft stays on this device. Return to this screen and tap Send when you have a connection.");
      if (batch.voice) {
        setMessage("Sending your voice note…");
        const voiceResponse = await fetch("/api/field-intake/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...batch.voice, submissionId: batch.submissionId }), signal: AbortSignal.timeout(45000) });
        const voiceResult = await voiceResponse.json().catch(() => ({}));
        if (!voiceResponse.ok || !voiceResult.ok) throw new Error(voiceResult.error || "Voice note could not be sent. Please retry.");
      }
      for (const photo of batch.photos) {
        setMessage(`Sending photo ${successful + 1} of ${batch.photos.length}…`);
        const response = await fetch("/api/field-intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, id: photo.id, submissionId: batch.submissionId, location: batch.location, description: batch.description, stage: null, fileName: photo.fileName, dataUrl: photo.dataUrl }), signal: AbortSignal.timeout(45000) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "The photo could not be sent. Please retry.");
        successful += 1;
        setSent(successful);
        // Keep stable IDs for unsent photos so retrying cannot duplicate a receipt.
        await save({ ...draftRef.current, photos: draftRef.current.photos.filter((item) => item.id !== photo.id) });
      }
      await save(emptyDraft());
      setMessage(`${successful} photo${successful === 1 ? "" : "s"}${batch.voice ? " and your voice note" : ""} sent. You’re all done.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sending stopped. Please retry the remaining photos.");
      setMessage(successful ? `${successful} photos sent. The remaining photos still need sending.` : "Photos have not been sent yet.");
    } finally { setBusy(false); }
  }
  return <main className="mx-auto min-h-dvh max-w-lg bg-[#faf8f4] px-5 py-7 text-slate-900">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b4411b]">RHI Pros</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Send job photos.</h1>
    <p className="mt-2 text-sm text-slate-600">Add photos and a quick note. We’ll take it from here.</p>
    <CrewInstallHelp />
    {!preview ? <Link href={jobsHref ?? `/send-photos/${encodeURIComponent(token)}/jobs`} className="ml-5 mt-4 inline-block text-sm font-semibold text-[#b4411b] underline underline-offset-4">My uploads</Link> : <Link href="/send-photos/preview/jobs" className="ml-5 mt-4 inline-block text-sm font-semibold text-[#b4411b] underline underline-offset-4">My uploads</Link>}
    <Link href={reportsHref ?? `/send-photos/${encodeURIComponent(token)}/reports`} className="ml-5 mt-4 inline-block text-sm font-semibold text-[#b4411b] underline underline-offset-4">Reports</Link>
    {packs.length ? <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4"><h2 className="font-semibold text-teal-900">Ready to post</h2><div className="mt-3 space-y-2">{packs.map((pack) => <Link key={pack.id} href={`${packBase ?? `/send-photos/${encodeURIComponent(token)}/packs`}/${pack.id}`} className="block rounded-xl bg-white px-3 py-3 text-sm font-semibold text-teal-900 underline">{pack.name} →</Link>)}</div></section> : null}
    {preview ? <p className="mt-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900">Preview only. Your live link will send photos straight to the marketing inbox.</p> : null}
    <div className="mt-6 grid grid-cols-2 gap-3">
      <button disabled={!loaded || busy} onClick={() => fileInput.current?.click()} className="rounded-2xl bg-[#b4411b] px-3 py-5 text-base font-semibold text-white disabled:opacity-50">Choose photos</button>
      <button disabled={!loaded || busy} onClick={() => cameraInput.current?.click()} className="rounded-2xl border-2 border-[#b4411b] bg-white px-3 py-5 text-base font-semibold text-[#b4411b] disabled:opacity-50">Take a photo</button>
      <input aria-label="Choose photos from your phone" ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add(e.target.files).catch(() => setError("Could not prepare the photos. Keep your originals and try again.")); e.currentTarget.value = ""; }} />
      <input aria-label="Take a job photo" ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files).catch(() => setError("Could not prepare this photo. Keep the original and try again.")); e.currentTarget.value = ""; }} />
    </div>
    {draft.photos.length ? <div className="mt-4 grid grid-cols-3 gap-2">{draft.photos.map((photo) => <div key={photo.id} className="relative"><img src={photo.dataUrl} alt="Photo ready to send" className="aspect-square w-full rounded-xl object-cover" /><button aria-label={`Remove ${photo.fileName}`} disabled={busy} onClick={() => void save({ ...draftRef.current, photos: draftRef.current.photos.filter((item) => item.id !== photo.id) }).catch(() => setError("Could not update this draft. Please retry."))} className="absolute right-1 top-1 rounded-full bg-white/95 px-2 py-1 text-xs shadow">✕</button></div>)}</div> : null}
    <CrewVoiceRecorder value={draft.voice} disabled={!loaded || busy} onRecordingChange={setRecordingVoice} onChange={(voice) => void save({ ...draftRef.current, voice }).catch(() => setError("Could not save this recording. Keep this page open and try again."))}>
      <label htmlFor="crew-job-notes" className="mt-4 block text-sm font-medium">Job notes — talk or type <span className="font-normal text-slate-500">(optional)</span></label>
      <p id="crew-job-notes-help" className="mt-1 text-sm text-slate-600">Tap this box, then the microphone on your iPhone’s keyboard. Your words appear here so you can edit them before sending. Stop any voice recording first.</p>
      <textarea id="crew-job-notes" aria-describedby="crew-job-notes-help" disabled={!loaded || busy || recordingVoice} value={draft.description} maxLength={2000} onChange={(e) => edit("description", e.target.value)} placeholder="Example: Finished a pavilion in Reading. Wood ceiling and recessed lights. Fix any names or details here." rows={5} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base disabled:opacity-50" />
      <p className="mt-1 text-xs text-slate-500">Saved with your photos. You can come back and edit before sending.</p>
    </CrewVoiceRecorder>
    <label className="mt-6 block text-sm font-medium">Where is the job? <span className="font-normal text-slate-500">(optional)</span><input disabled={!loaded || busy} value={draft.location} maxLength={150} onChange={(e) => edit("location", e.target.value)} placeholder="Town or a job name you both know" className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base" /></label>
    <button onClick={() => void send()} disabled={!loaded || busy || recordingVoice || !draft.photos.length} className="mt-6 w-full rounded-2xl bg-[#b4411b] px-4 py-4 text-lg font-semibold text-white disabled:opacity-40">{busy ? "Please wait…" : `Send${draft.photos.length ? ` ${draft.photos.length} photo${draft.photos.length === 1 ? "" : "s"}` : " photos"}${draft.voice ? " + voice note" : ""}`}</button>
    <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-teal-800">{message || (loaded ? "Ready when you are." : "Opening your saved draft…")}</p>
    {sent > 0 && !draft.photos.length ? <p className="mt-2 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">Received for review. Nothing is posted publicly from this screen.</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <p className="mt-5 text-xs text-slate-500">Keep this screen open while sending. Unsent drafts are saved on this device when storage is available. Keep your original photos.</p>
  </main>;
}
