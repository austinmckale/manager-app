"use client";

import { useState } from "react";

export function ryanRequestText(uploadPath: string) {
  const upload = uploadPath ? new URL(uploadPath, "https://app.rhipros.com").toString() : "";
  return ["Hey Ryan — can you send photos from recent jobs in RHI Pros?", "Open https://app.rhipros.com and continue with Google. Add the photos, a short note, and a voice note about what the job was.", upload ? `Or use this private upload link: ${upload}` : ""].filter(Boolean).join("\n\n");
}

export function RyanRequestButton({ uploadPath, demo }: { uploadPath: string; demo?: boolean }) {
  const [message, setMessage] = useState("");
  async function copyRequest() {
    const text = ryanRequestText(uploadPath);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Request copied. Paste it into a text to Ryan. The app did not send it.");
    } catch {
      setMessage(text);
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
      setMessage("Share sheet opened. The app did not send the message.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMessage("Request not shared. You can copy it instead.");
    }
  }
  if (demo) return null;
  return <div className="mt-3">
    <div className="flex flex-col gap-2 sm:flex-row">
      <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => void copyRequest()}>Copy request</button>
      <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => void shareRequest()}>Share request</button>
    </div>
    <p className="mt-2 text-sm text-slate-700">Asks Ryan for photos from recent jobs. Nothing is texted or emailed from here.</p>
    {message ? <p role="status" className="mt-2 text-sm text-teal-950">{message}</p> : null}
  </div>;
}
