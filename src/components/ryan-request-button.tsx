"use client";

import { useState } from "react";

export const RYAN_EMAIL = "rhisolutions316@gmail.com";
export const RYAN_REQUEST_SUBJECT = "Photos from your recent jobs";

export function ryanRequestText() {
  return [
    "Hey Ryan,",
    "Can you add photos from your recent jobs? Go to app.rhipros.com and sign in with Google. Add the photos, a short note, and a quick voice note about what the job was.",
    "Thanks!",
  ].join("\n\n");
}

/** Opens the owner's own mail app addressed to Ryan. The app itself sends nothing. */
export function ryanRequestMailto() {
  return `mailto:${RYAN_EMAIL}?subject=${encodeURIComponent(RYAN_REQUEST_SUBJECT)}&body=${encodeURIComponent(ryanRequestText())}`;
}

export function RyanRequestButton({ demo }: { demo?: boolean }) {
  const [status, setStatus] = useState("");

  if (demo) return null;
  return <div className="mt-3 rounded-xl border border-dashed border-slate-400 bg-slate-100 p-3">
    <p className="text-sm font-semibold text-slate-900">Ask Ryan for recent job photos</p>
    <p className="mt-1 text-sm text-slate-700">Opens your email to {RYAN_EMAIL} with this note filled in. You press send; nothing is sent from here.</p>
    <div className="mt-3 select-text whitespace-pre-wrap break-words rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900">{ryanRequestText()}</div>
    <a href={ryanRequestMailto()} onClick={() => setStatus("Your email app should open with the note ready to send.")} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Email this note to Ryan</a>
    {status ? <p role="status" className="mt-2 text-sm font-medium text-slate-900">{status}</p> : null}
  </div>;
}
