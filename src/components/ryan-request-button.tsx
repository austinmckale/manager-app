"use client";

import { useEffect, useState } from "react";

export function ryanRequestText(uploadPath: string) {
  const upload = uploadPath ? new URL(uploadPath, "https://app.rhipros.com").toString() : "";
  return ["Hey Ryan — can you send photos from recent jobs in RHI Pros?", "Open https://app.rhipros.com and continue with Google. Add the photos, a short note, and a voice note about what the job was.", upload ? `Or use this private upload link: ${upload}` : ""].filter(Boolean).join("\n\n");
}

export function RyanRequestButton({ uploadPath, demo }: { uploadPath: string; demo?: boolean }) {
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  async function copyRequest() {
    const text = ryanRequestText(uploadPath);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Paste it into a text to Ryan. This app did not send it.");
    } catch {
      setStatus("Could not copy. Select the note above and copy it. This app did not send it.");
    }
  }

  async function shareRequest() {
    const share = navigator.share?.bind(navigator);
    if (!share) {
      setStatus("The share sheet is not on this computer. Select the note above and copy it. This app did not send it.");
      return;
    }
    try {
      await share({ text: ryanRequestText(uploadPath) });
      setStatus("Share sheet opened. This app did not send it.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("The share sheet did not open. Select the note above and copy it. This app did not send it.");
    }
  }

  if (demo) return null;
  const preview = ryanRequestText(uploadPath);
  return <div className="mt-3 rounded-xl border border-dashed border-slate-400 bg-slate-100 p-3">
    <p className="text-sm font-semibold text-slate-900">Ask Ryan for recent job photos</p>
    <p className="mt-1 text-sm text-slate-700">You send this yourself. Nothing is texted or emailed from here.</p>
    <p id="ryan-note-label" className="mt-3 text-sm font-semibold text-slate-900">Note to paste into your own text</p>
    <div aria-labelledby="ryan-note-label" className="mt-1 select-text whitespace-pre-wrap break-words rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900">{preview}</div>
    <button type="button" className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => void copyRequest()}>Copy this note to text Ryan</button>
    {canShare ? <button type="button" className="mt-2 block bg-transparent p-0 text-left text-sm text-slate-600 underline decoration-slate-400 underline-offset-2" onClick={() => void shareRequest()}>Open share sheet</button> : null}
    {status ? <p role="status" className="mt-2 text-sm font-medium text-slate-900">{status}</p> : null}
  </div>;
}
