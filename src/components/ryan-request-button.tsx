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
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Paste it into your own text. This app did not send it.");
    } catch {
      setStatus("Could not copy automatically. Select the message above and copy it. This app did not send it.");
    }
  }

  async function shareRequest() {
    const text = ryanRequestText(uploadPath);
    if (!navigator.share) {
      await copyRequest();
      return;
    }
    try {
      await navigator.share({ text });
      setStatus("Share sheet opened. The app did not send the message.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("Request not shared. You can copy it instead.");
    }
  }

  if (demo) return null;
  const preview = ryanRequestText(uploadPath);
  return <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-sm font-semibold text-slate-900">Ask Ryan for recent job photos</p>
    <p className="mt-1 text-sm text-slate-700">You send this yourself. Nothing is texted or emailed from here.</p>
    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">{preview}</div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => void copyRequest()}>Copy message for Ryan</button>
      {canShare ? <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-700 underline underline-offset-2" onClick={() => void shareRequest()}>Share from this phone</button> : null}
    </div>
    {status ? <p role="status" className="mt-2 text-sm font-medium text-teal-950">{status}</p> : null}
  </div>;
}
