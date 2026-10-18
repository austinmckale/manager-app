"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { bundlePhotoName, chatBundlePrompt, handoffPublishability, handoffReviewable, importChatReview } from "@/lib/marketing-handoff";
import type { MarketingDraft } from "@/lib/marketing";

type HandoffPhoto = { id: string; fileName: string; url: string; description: string };
type EditedChoice = { file: File; preview: string; replaces: string; status: string };

const START_HERE = `How to use this bundle

1. Unzip it.
2. In ChatGPT or Claude, attach every file in photos/, review-prompt.txt and raw-input.json, and say "Follow review-prompt.txt".
   raw-input.json is everything Ryan said and typed. It is private: check what you share.
3. ChatGPT can also return lightly edited photos. Download each one it gives you. Claude cannot edit photos; it only picks and orders them.
4. Back in the app, open "Ask ChatGPT or Claude instead" on this draft:
   - Paste the chat's whole reply (or choose it saved as a file) and press Import. Text around the JSON is fine.
   - Under "Add edited photos", choose the photos you downloaded. Check which original each one replaces, then add them.
5. Save the new version and run checks. Importing never approves or posts anything.`;

/** Uses the photo id or the photo number in the file name, then falls back to the next unused photo. */
function guessOriginal(fileName: string, photos: HandoffPhoto[], taken: Set<string>) {
  const byId = photos.find((photo) => fileName.toLowerCase().includes(photo.id.toLowerCase()));
  if (byId) return byId.id;
  const numbered = /photo-(\d+)/i.exec(fileName) ?? /^(?:edited-)?(\d+)[-_. ]/i.exec(fileName);
  const index = numbered ? Number(numbered[1]) - 1 : -1;
  if (photos[index]) return photos[index].id;
  return photos.find((photo) => !taken.has(photo.id))?.id ?? photos[0]?.id ?? "";
}

/** Shrinks to at most 2400px and re-saves as JPG in the browser, which also drops photo metadata. */
async function shrinkForUpload(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.9));
  if (!blob) throw new Error("This browser could not prepare the photo.");
  return blob;
}

export function MarketingChatHandoff({ draftId, inputHash, draft, originalNotes, photos, audio, onImport, onPhotos, onEditedPhoto, disabled }: { draftId: string; inputHash: string; draft: MarketingDraft; originalNotes?: string; photos: HandoffPhoto[]; audio: { id: string; transcript: string; status: string }[]; onImport: (draft: MarketingDraft) => void; onPhotos?: (photoIds: string[], photoImprovements?: { id: string; note: string }[]) => void; onEditedPhoto?: (replaces: string, photo: HandoffPhoto) => void; disabled: boolean }) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [edited, setEdited] = useState<EditedChoice[]>([]);
  const evidence = [originalNotes || "", ...audio.map((item) => item.transcript)].filter(Boolean).join("\n\n");
  const gate = handoffPublishability(draft, evidence, photos.map((photo) => photo.description));
  const reviewable = handoffReviewable(gate);
  const blockedReason = gate.reasons.join(", ");
  const extension = (fileName: string) => fileName.split(".").at(-1)?.replace(/[^a-z0-9]/gi, "") || "jpg";
  async function download() {
    setBusy(true); setMessage("");
    try {
      const listed = photos.map(({ id, fileName, description }, index) => ({ id, file: bundlePhotoName(index, id, extension(fileName)), description }));
      const originals = { submittedNotes: originalNotes || "", ownerNotes: draft.sourceNotes, voice: audio, photos: listed };
      const prompt = chatBundlePrompt(draftId, inputHash, draft, originals);
      if (!prompt) { setMessage(blockedReason); return; }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("START-HERE.txt", START_HERE);
      zip.file("review-prompt.txt", prompt);
      zip.file("raw-input.json", JSON.stringify({ note: "Private source. Keep public posts short. Do not invent facts that are not in this file or the photos.", submittedNotes: originalNotes || "", voice: audio, photos: listed }, null, 2));
      for (const [index, photo] of photos.entries()) {
        const response = await fetch(`/api/marketing/review/media?draftId=${encodeURIComponent(draftId)}&photoId=${encodeURIComponent(photo.id)}`, { credentials: "same-origin", signal: AbortSignal.timeout(30000) });
        if (!response.ok) { setMessage("Could not attach a photo. Refresh this page and try the download again."); return; }
        zip.file(`photos/${bundlePhotoName(index, photo.id, extension(photo.fileName))}`, await response.blob());
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const link = document.createElement("a"); link.href = url; link.download = `rhi-chat-review-${draftId}.zip`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("Bundle downloaded. Unzip it and follow START-HERE.txt.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not export the review bundle."); }
    finally { setBusy(false); }
  }
  function runImport() {
    try {
      const result = importChatReview(raw, draftId, inputHash, draft, { originalNotes: evidence, photoDescriptions: photos.map((photo) => photo.description) }, photos.map((photo) => photo.id));
      onImport(result.draft);
      onPhotos?.(result.photoIds, result.photoImprovements);
      setImportNotes(result.notes);
      setMessage("Imported into the editor. Review the changes, save a new version and run checks before approval.");
    } catch (error) {
      setImportNotes([]);
      setMessage(error instanceof Error && !error.message.startsWith("[") ? error.message : "The reply could not be read. Paste the chat's whole reply, or ask it to send only its JSON block.");
    }
  }
  function chooseEdited(files: FileList | null) {
    edited.forEach((item) => URL.revokeObjectURL(item.preview));
    const taken = new Set<string>();
    const next = [...(files ?? [])].filter((file) => file.type.startsWith("image/")).slice(0, 24).map((file) => {
      const replaces = guessOriginal(file.name, photos, taken);
      taken.add(replaces);
      return { file, preview: URL.createObjectURL(file), replaces, status: "" };
    });
    setEdited(next);
  }
  async function addEdited() {
    setBusy(true); setMessage("");
    let added = 0;
    const next = [...edited];
    for (const [index, item] of next.entries()) {
      if (item.status === "Added") continue;
      try {
        const form = new FormData();
        form.set("draftId", draftId); form.set("inputHash", inputHash); form.set("originalPhotoId", item.replaces);
        form.set("file", await shrinkForUpload(item.file), "edited.jpg");
        const response = await fetch("/api/marketing/review/edited-photo", { method: "POST", body: form, credentials: "same-origin" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not add this photo.");
        onEditedPhoto?.(item.replaces, { id: result.photo.id, fileName: result.photo.fileName, description: result.photo.description, url: item.preview });
        next[index] = { ...item, status: "Added" };
        added++;
      } catch (error) {
        next[index] = { ...item, status: error instanceof Error ? error.message : "Could not add this photo." };
      }
      setEdited([...next]);
    }
    setBusy(false);
    if (added) setMessage(`Added ${added} edited photo${added === 1 ? "" : "s"} in place of the originals. Save this version, then run checks. The originals are unchanged.`);
  }
  const photoLabel = (photo: HandoffPhoto, index: number) => `Photo ${index + 1}${photo.description ? ` – ${photo.description.slice(0, 40)}` : ""}`;
  return <details className="rounded-2xl border bg-slate-50 p-4"><summary className="cursor-pointer font-semibold">Ask ChatGPT or Claude instead</summary>
    {reviewable ? <>
    {gate.blocked ? <p className="mt-3 text-sm">This draft is held from posting. Asking ChatGPT or Claude does not approve or post.</p> : null}
    <p className="mt-3 text-sm">1. Download the bundle and follow START-HERE.txt. 2. Paste the chat&apos;s reply below. 3. If ChatGPT edited photos, add them below. Nothing is approved or posted. The bundle includes private notes and transcripts for your chosen chat service.</p>
    <button type="button" disabled={disabled || busy || !photos.length} onClick={() => void download()} className="mt-3 rounded-xl border bg-white px-4 py-3 disabled:opacity-40">Download ChatGPT / Claude review bundle</button>
    {disabled ? <p className="mt-2 text-sm">Download is unavailable while a save is running or on a replaced version.</p> : null}
    {photos.length ? null : <p className="mt-2 text-sm">This draft has no photos to attach.</p>}
    <label className="mt-4 block text-sm font-medium">Paste the chat&apos;s reply (the whole reply is fine)<textarea value={raw} maxLength={100000} rows={6} onChange={(event) => setRaw(event.target.value)} className="mt-2 w-full rounded-xl border p-3 font-mono text-xs" /></label>
    <label className="mt-2 block text-sm">Or choose the reply saved as a file<input type="file" accept=".json,.txt,application/json,text/plain" className="mt-2 block w-full" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 100000) { setMessage("Choose a reply under 100 KB."); return; } setRaw(await file.text()); }} /></label>
    <button type="button" disabled={disabled || busy || !raw.trim()} onClick={runImport} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-40">Import as unapproved edits</button>
    {importNotes.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">{importNotes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    <div className="mt-5 border-t pt-4">
      <p className="text-sm font-medium">Add edited photos</p>
      <p className="mt-1 text-sm text-slate-600">Choose the photos ChatGPT gave back. Each one replaces the original you pick; the original stays saved. The AI checks look at the edited photo again.</p>
      <input type="file" accept="image/*" multiple disabled={disabled || busy} onChange={(event) => chooseEdited(event.target.files)} className="mt-2 block w-full text-sm" />
      {edited.length ? <ul className="mt-3 space-y-2">{edited.map((item, index) => <li key={item.preview} className="flex items-center gap-3 rounded-xl border bg-white p-2">
        <img src={item.preview} alt="Edited photo" className="h-16 w-16 rounded-lg object-cover" />
        <label className="flex-1 text-sm">Replaces
          <select value={item.replaces} disabled={busy || item.status === "Added"} onChange={(event) => setEdited((current) => current.map((entry, at) => (at === index ? { ...entry, replaces: event.target.value } : entry)))} className="mt-1 block w-full rounded-lg border p-2 text-sm">
            {photos.map((photo, at) => <option key={photo.id} value={photo.id}>{photoLabel(photo, at)}</option>)}
          </select>
          {item.status ? <span className={`mt-1 block text-xs ${item.status === "Added" ? "text-teal-700" : "text-red-700"}`}>{item.status}</span> : null}
        </label>
      </li>)}</ul> : null}
      {edited.length ? <button type="button" disabled={disabled || busy || edited.every((item) => item.status === "Added")} onClick={() => void addEdited()} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-40">Add edited photos</button> : null}
    </div>
    <p role="status" className="mt-3 text-sm">{message}</p>
    </> : <p role="status" className="mt-3 text-sm">This stays in the app. The notes say not to publish it.</p>}
  </details>;
}
