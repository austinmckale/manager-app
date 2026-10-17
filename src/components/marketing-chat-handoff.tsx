"use client";
import { useState } from "react";
import { chatBundlePrompt, handoffPublishability, importChatReview } from "@/lib/marketing-handoff";
import type { MarketingDraft } from "@/lib/marketing";

export function MarketingChatHandoff({ draftId, inputHash, draft, originalNotes, photos, audio, onImport, disabled }: { draftId: string; inputHash: string; draft: MarketingDraft; originalNotes?: string; photos: { id: string; fileName: string; url: string; description: string }[]; audio: { id: string; transcript: string; status: string }[]; onImport: (draft: MarketingDraft) => void; disabled: boolean }) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const gate = handoffPublishability(draft, originalNotes || "", photos.map((photo) => photo.description));
  const blockedReason = gate.reasons.join(", ");
  async function download() {
    setBusy(true); setMessage("");
    try {
      const originals = { submittedNotes: originalNotes || "", ownerNotes: draft.sourceNotes, voice: audio, photos: photos.map(({ id, fileName, description }) => ({ id, fileName, description })) };
      const prompt = chatBundlePrompt(draftId, inputHash, draft, originals);
      if (!prompt) { setMessage(blockedReason); return; }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("START-HERE.txt", "Unzip this bundle. Attach ALL photos, review-prompt.txt, and raw-input.json to ChatGPT or Claude. raw-input.json is everything Ryan said and typed. The post text in the prompt is only the short public version. Ask the chat to follow the prompt. Copy its JSON reply into the app’s import box, or save the reply as a .json file and choose it there. This bundle contains private notes and transcripts: check what you share. Importing never approves or posts anything.");
      zip.file("review-prompt.txt", prompt);
      zip.file("raw-input.json", JSON.stringify({ note: "Private source. Keep public posts short. Do not invent facts that are not in this file or the photos.", submittedNotes: originalNotes || "", voice: audio, photos: photos.map(({ id, fileName, description }) => ({ id, fileName, description })) }, null, 2));
      for (const [index, photo] of photos.entries()) {
        const response = await fetch(photo.url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("A private photo link expired. Refresh and export again.");
        zip.file(`photos/${index + 1}-${photo.id}.${photo.fileName.split(".").at(-1)?.replace(/[^a-z0-9]/gi, "") || "jpg"}`, await response.blob());
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const link = document.createElement("a"); link.href = url; link.download = `rhi-chat-review-${draftId}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("Bundle downloaded. Unzip it and attach the photos and review-prompt.txt in your chat app.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not export the review bundle."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-2xl border bg-slate-50 p-4"><summary className="cursor-pointer font-semibold">Review in ChatGPT or Claude instead</summary>
    {gate.blocked ? <p role="status" className="mt-3 text-sm">{blockedReason}</p> : <>
    <p className="mt-3 text-sm">1. Download the bundle. 2. Unzip and attach its photos and prompt to your chat. 3. Paste the returned JSON below. The bundle includes private notes and transcripts for your chosen chat service.</p>
    <button disabled={disabled || busy || !photos.length} onClick={() => void download()} className="mt-3 rounded-xl border bg-white px-4 py-3 disabled:opacity-40">Download ChatGPT / Claude review bundle</button>
    <label className="mt-4 block text-sm font-medium">Paste the returned JSON<textarea value={raw} maxLength={100000} rows={6} onChange={(event) => setRaw(event.target.value)} className="mt-2 w-full rounded-xl border p-3 font-mono text-xs" /></label>
    <label className="mt-2 block text-sm">Or choose the returned JSON file<input type="file" accept=".json,.txt,application/json,text/plain" className="mt-2 block w-full" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 100000) { setMessage("Choose a JSON response under 100 KB."); return; } setRaw(await file.text()); }} /></label>
    <button disabled={disabled || busy || !raw.trim()} onClick={() => { try { onImport(importChatReview(raw, draftId, inputHash, draft, { originalNotes, photoDescriptions: photos.map((photo) => photo.description) })); setMessage("Imported into the editor. Review changes, save a new version and run checks before approval."); } catch (error) { setMessage(error instanceof Error && !error.message.startsWith("[") ? error.message : "The response does not match the required JSON format. Ask your chat to follow the exported prompt."); } }} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-40">Import as unapproved edits</button>
    <p role="status" className="mt-3 text-sm">{message}</p>
    </>}
  </details>;
}
