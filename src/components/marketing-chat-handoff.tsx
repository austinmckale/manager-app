"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { IMPORT_ZIP_NAME, bundlePhotoName, chatBundlePrompt, handoffPublishability, handoffReviewable, importChatReview } from "@/lib/marketing-handoff";
import type { MarketingDraft } from "@/lib/marketing";

type HandoffPhoto = { id: string; fileName: string; url: string; description: string };
// confirmed: the owner (or a file name that names the photo) says which photo it replaces.
type EditedChoice = { file: File; preview: string; replaces: string; status: string; confirmed: boolean };

const START_HERE = `How to use this bundle

1. Unzip it.
2. Open ChatGPT. Attach every file in photos/, review-prompt.txt and raw-input.json, and say: Follow review-prompt.txt.
   raw-input.json is everything Ryan said and typed. It is private: check what you share.
3. ChatGPT studies the photos, cleans them up, writes the posts and gives you back one ZIP (${IMPORT_ZIP_NAME}). Download it.
   Claude cannot edit photos; it can still write the posts and send the JSON.
4. In the app, open this draft, then More > Ask ChatGPT or Claude, and choose that ZIP. The text and the edited photos come in together.
   If the chat only replied with text, paste the whole reply instead.
5. Check the photos and text, then press Save and check with AI. Importing never approves or posts anything.`;

/**
 * The photo an edited file replaces, from the photo id or photo number in its name. When the name
 * says neither, the next unused photo is only a suggestion (sure: false) for the owner to confirm.
 */
export function guessOriginal(fileName: string, photos: HandoffPhoto[], taken: Set<string>) {
  const byId = photos.find((photo) => fileName.toLowerCase().includes(photo.id.toLowerCase()));
  if (byId) return { id: byId.id, sure: true };
  const numbered = /photo-(\d+)/i.exec(fileName) ?? /^(?:edited-)?(\d+)[-_. ]/i.exec(fileName);
  const index = numbered ? Number(numbered[1]) - 1 : -1;
  if (photos[index]) return { id: photos[index].id, sure: true };
  return { id: photos.find((photo) => !taken.has(photo.id))?.id ?? photos[0]?.id ?? "", sure: false };
}

/** Shrinks to at most 2400px and re-saves as JPG in the browser, which also drops photo metadata. */
async function shrinkForUpload(file: Blob) {
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

const imageType = (name: string) => (/\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg");
const baseName = (path: string) => path.split("/").pop() ?? path;

export function MarketingChatHandoff({ draftId, inputHash, draft, originalNotes, photos, audio, onImport, onPhotos, onEditedPhoto, disabled }: { draftId: string; inputHash: string; draft: MarketingDraft; originalNotes?: string; photos: HandoffPhoto[]; audio: { id: string; transcript: string; status: string }[]; onImport: (draft: MarketingDraft) => void; onPhotos?: (photoIds: string[], photoImprovements?: { id: string; note: string }[]) => void; onEditedPhoto?: (replaces: string, photo: HandoffPhoto) => void; disabled: boolean }) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [importMessage, setImportMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [edited, setEdited] = useState<EditedChoice[]>([]);
  const [photoMessage, setPhotoMessage] = useState("");
  const evidence = [originalNotes || "", ...audio.map((item) => item.transcript)].filter(Boolean).join("\n\n");
  const gate = handoffPublishability(draft, evidence, photos.map((photo) => photo.description));
  const reviewable = handoffReviewable(gate);
  const extension = (fileName: string) => fileName.split(".").at(-1)?.replace(/[^a-z0-9]/gi, "") || "jpg";

  async function download() {
    setBusy(true); setDownloadMessage("");
    try {
      const listed = photos.map(({ id, fileName, description }, index) => ({ id, file: bundlePhotoName(index, id, extension(fileName)), description }));
      const originals = { submittedNotes: originalNotes || "", ownerNotes: draft.sourceNotes, voice: audio, photos: listed };
      const prompt = chatBundlePrompt(draftId, inputHash, draft, originals);
      if (!prompt) { setDownloadMessage(gate.reasons.join(", ")); return; }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("START-HERE.txt", START_HERE);
      zip.file("review-prompt.txt", prompt);
      zip.file("raw-input.json", JSON.stringify({ note: "Private source. Keep public posts short. Do not invent facts that are not in this file or the photos.", submittedNotes: originalNotes || "", voice: audio, photos: listed }, null, 2));
      for (const [index, photo] of photos.entries()) {
        const response = await fetch(`/api/marketing/review/media?draftId=${encodeURIComponent(draftId)}&photoId=${encodeURIComponent(photo.id)}`, { credentials: "same-origin", signal: AbortSignal.timeout(30000) });
        if (!response.ok) { setDownloadMessage("Could not attach a photo. Refresh this page and try again."); return; }
        zip.file(`photos/${bundlePhotoName(index, photo.id, extension(photo.fileName))}`, await response.blob());
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const link = document.createElement("a"); link.href = url; link.download = `rhi-chat-review-${draftId}.zip`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setDownloadMessage("Downloaded. Unzip it and follow START-HERE.txt.");
    } catch (error) { setDownloadMessage(error instanceof Error ? error.message : "Could not make the bundle."); }
    finally { setBusy(false); }
  }

  /** Fills the post text and photo order from the chat's JSON. Returns false when it could not. */
  function importText(text: string) {
    if (!text.trim()) { setImportMessage({ text: "Paste the chat's reply first, or choose its ZIP.", error: true }); return false; }
    try {
      const result = importChatReview(text, draftId, inputHash, draft, { originalNotes: evidence, photoDescriptions: photos.map((photo) => photo.description) }, photos.map((photo) => photo.id));
      onImport(result.draft);
      onPhotos?.(result.photoIds, result.photoImprovements);
      setImportNotes(result.notes);
      setImportMessage({ text: "The text is in the editor above.", error: false });
      return true;
    } catch (error) {
      setImportNotes([]);
      setImportMessage({ text: error instanceof Error && !error.message.startsWith("[") ? error.message : "The reply could not be read. Paste the chat's whole reply, or ask it to send only its JSON block.", error: true });
      return false;
    }
  }

  /** Uploads the confirmed edited photos; each replaces the original it was made from. Returns how many were added. */
  async function uploadEdited(items: EditedChoice[], update: (items: EditedChoice[]) => void) {
    let added = 0;
    const next = [...items];
    for (const [index, item] of next.entries()) {
      if (item.status === "Added" || !item.confirmed) continue;
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
      update([...next]);
    }
    return added;
  }

  /** One step: the ZIP the chat sent back holds import.json and the edited photos. */
  async function importFile(file: File) {
    setBusy(true); setImportMessage(null); setImportNotes([]);
    try {
      if (!/\.zip$/i.test(file.name)) {
        if (file.size > 100000) { setImportMessage({ text: "Choose the ZIP, or a reply file under 100 KB.", error: true }); return; }
        const text = await file.text();
        setRaw(text);
        importText(text);
        return;
      }
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/") && !baseName(entry.name).startsWith("."));
      const json = entries.find((entry) => /(^|\/)import\.json$/i.test(entry.name)) ?? entries.find((entry) => /\.json$/i.test(entry.name) && !/raw-input\.json$/i.test(entry.name));
      const imported = json ? importText(await json.async("string")) : false;
      if (!json) setImportMessage({ text: "That ZIP has no import.json. Ask the chat to follow review-prompt.txt, or paste its reply.", error: true });
      const images = entries.filter((entry) => /\.(jpe?g|png|webp)$/i.test(entry.name));
      const editedImages = images.filter((entry) => /edited/i.test(baseName(entry.name)));
      const taken = new Set<string>();
      const choices: EditedChoice[] = [];
      for (const entry of editedImages.slice(0, 24)) {
        const name = baseName(entry.name);
        const blob = new File([await entry.async("blob")], name, { type: imageType(name) });
        const guess = guessOriginal(name, photos, taken);
        taken.add(guess.id);
        // A name that does not say which photo it is waits for the owner instead of taking a guessed slot.
        choices.push({ file: blob, preview: URL.createObjectURL(blob), replaces: guess.id, confirmed: guess.sure, status: guess.sure ? "" : "Choose the photo it replaces, then press Add these photos." });
      }
      setEdited(choices);
      const added = choices.length ? await uploadEdited(choices, setEdited) : 0;
      const waiting = choices.filter((choice) => !choice.confirmed).length;
      const skipped = images.length - editedImages.length;
      const parts = [imported ? "the text" : "", added ? `${added} edited photo${added === 1 ? "" : "s"}` : ""].filter(Boolean);
      const imports = parts.length ? `Imported ${parts.join(" and ")}. ` : "";
      const choose = waiting ? `${waiting} edited photo${waiting === 1 ? " needs" : "s need"} you to choose which photo ${waiting === 1 ? "it replaces" : "they replace"} below. ` : "";
      setImportMessage({ text: imports || choose ? `${imports}${choose}Check everything above, then press Save and check with AI.${skipped ? ` Skipped ${skipped} photo${skipped === 1 ? "" : "s"} not named "edited".` : ""}` : "Nothing in that ZIP could be imported.", error: (!imports && !choose) || choices.length > added + waiting });
    } catch (error) {
      setImportMessage({ text: error instanceof Error ? error.message : "Could not open that file.", error: true });
    } finally { setBusy(false); }
  }

  function chooseEdited(files: FileList | null) {
    edited.forEach((item) => URL.revokeObjectURL(item.preview));
    const taken = new Set<string>();
    setEdited([...(files ?? [])].filter((file) => file.type.startsWith("image/")).slice(0, 24).map((file) => {
      const guess = guessOriginal(file.name, photos, taken);
      taken.add(guess.id);
      return { file, preview: URL.createObjectURL(file), replaces: guess.id, status: "", confirmed: false };
    }));
    setPhotoMessage("");
  }
  /** Add these photos: the owner has checked each "Replaces" choice. */
  async function addEdited() {
    setBusy(true); setPhotoMessage("");
    const added = await uploadEdited(edited.map((item) => ({ ...item, confirmed: true })), setEdited);
    setBusy(false);
    setPhotoMessage(added ? `Added ${added} edited photo${added === 1 ? "" : "s"} in place of the originals. The originals stay saved.` : "No photos were added.");
  }

  const photoLabel = (photo: HandoffPhoto, index: number) => `Photo ${index + 1}${photo.description ? ` – ${photo.description.slice(0, 40)}` : ""}`;
  const result = importMessage ? <p role="status" className={`mt-2 text-sm font-medium ${importMessage.error ? "text-red-700" : "text-teal-800"}`}>{importMessage.text}</p> : null;
  if (!reviewable) return <div className="rounded-xl border border-slate-200 p-3 text-sm">This stays in the app. The notes say not to publish it.</div>;
  return <div className="rounded-xl border border-slate-200 p-3">
    <p className="text-sm font-semibold text-slate-900">Ask ChatGPT or Claude</p>
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
      <li>Download the bundle and give it to ChatGPT (START-HERE.txt inside explains how).</li>
      <li>ChatGPT studies and cleans up the photos, writes the posts, and gives back one ZIP.</li>
      <li>Choose that ZIP here. The text and edited photos come in together; nothing is posted.</li>
    </ol>
    {gate.blocked ? <p className="mt-2 text-sm text-amber-800">This draft is held from posting. Asking ChatGPT or Claude does not approve or post it.</p> : null}
    <button type="button" disabled={disabled || busy || !photos.length} onClick={() => void download()} className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Download the bundle for ChatGPT</button>
    {downloadMessage ? <p role="status" className="mt-2 text-sm text-slate-700">{downloadMessage}</p> : null}

    <label className="mt-4 block text-sm font-semibold text-slate-900">Choose the ZIP ChatGPT gave back
      <input type="file" accept=".zip,.json,.txt,application/zip,application/json,text/plain" disabled={disabled || busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} className="mt-1 block w-full text-sm font-normal" />
    </label>
    {result}
    {importNotes.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">{importNotes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    {edited.length ? <ul className="mt-2 space-y-2">{edited.map((item, index) => <li key={item.preview} className="flex items-center gap-3 rounded-xl border bg-white p-2">
      <img src={item.preview} alt="Edited photo" className="h-14 w-14 rounded-lg object-cover" />
      <label className="flex-1 text-sm">Replaces
        <select value={item.replaces} disabled={busy || item.status === "Added"} onChange={(event) => setEdited((current) => current.map((entry, at) => (at === index ? { ...entry, replaces: event.target.value } : entry)))} className="mt-1 block w-full rounded-lg border p-2 text-sm">
          {photos.map((photo, at) => <option key={photo.id} value={photo.id}>{photoLabel(photo, at)}</option>)}
        </select>
        {item.status ? <span className={`mt-1 block text-xs ${item.status === "Added" ? "text-teal-700" : "text-red-700"}`}>{item.status}</span> : null}
      </label>
    </li>)}</ul> : null}
    {edited.some((item) => item.status !== "Added") ? <button type="button" disabled={disabled || busy} onClick={() => void addEdited()} className="mt-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Add these photos</button> : null}
    {photoMessage ? <p role="status" className="mt-2 text-sm text-slate-800">{photoMessage}</p> : null}

    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">The chat replied with text, or sent photos separately</summary>
      <label className="mt-2 block font-medium">Paste the chat&apos;s whole reply<textarea value={raw} maxLength={100000} rows={5} onChange={(event) => setRaw(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-mono text-xs" /></label>
      <button type="button" disabled={disabled || busy} onClick={() => importText(raw)} className="mt-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Import the text</button>
      <label className="mt-4 block font-medium">Edited photos downloaded one by one
        <input type="file" accept="image/*" multiple disabled={disabled || busy} onChange={(event) => chooseEdited(event.target.files)} className="mt-1 block w-full font-normal" />
      </label>
      <p className="mt-1 text-slate-600">They show above with the photo each one replaces. Check it, then press Add these photos.</p>
    </details>
  </div>;
}
