"use client";

import { useState, useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  const display = window.matchMedia("(display-mode: standalone)");
  display.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => { display.removeEventListener("change", listener); window.removeEventListener("storage", listener); };
}
function wasDismissed() {
  try { return localStorage.getItem("rhi-photos-install-dismissed") === "1"; } catch { return false; }
}
function deviceMode() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (standalone) return "installed";
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : "browser";
}

export function CrewInstallHelp() {
  const mode = useSyncExternalStore(subscribe, deviceMode, () => "browser");
  const [expanded, setExpanded] = useState(false);
  const storedDismissal = useSyncExternalStore(subscribe, wasDismissed, () => true);
  const [dismissed, setDismissed] = useState(false);
  if (mode === "installed") return null;
  const close = () => {
    setDismissed(true); setExpanded(false);
    try { localStorage.setItem("rhi-photos-install-dismissed", "1"); } catch { /* Help still closes when device storage is unavailable. */ }
  };
  if (!expanded && (mode !== "ios" || dismissed || storedDismissal)) return <button type="button" onClick={() => setExpanded(true)} className="mt-4 text-sm font-semibold text-[#b4411b] underline underline-offset-4">Save as app</button>;
  return <section aria-label="Save RHI Photos as an app" className="mt-5 rounded-2xl border border-[#b4411b]/25 bg-white p-4">
    <p className="font-semibold">Keep RHI Photos on your Home Screen</p>
    <p className="mt-1 text-sm text-slate-600">Next time, tap the icon to send photos straight from your phone.</p>
    {expanded ? <>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Open this upload link in <strong>Safari</strong> on your iPhone.</li>
        <li>Tap <strong>Share</strong> (the square with an arrow pointing up). It may be in the More menu.</li>
        <li>Choose <strong>Add to Home Screen</strong>. Scroll down if needed.</li>
        <li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
      </ol>
      <p className="mt-3 text-xs text-slate-500">Keep the name “RHI Photos.” Your iPhone asks you to add it using the Share menu.</p>
      <button type="button" onClick={close} className="mt-3 rounded-xl bg-[#b4411b] px-4 py-2 text-sm font-semibold text-white">Got it</button>
    </> : <div className="mt-3 flex gap-4"><button type="button" onClick={() => setExpanded(true)} className="rounded-xl bg-[#b4411b] px-4 py-2 text-sm font-semibold text-white">Show me how</button><button type="button" onClick={close} className="text-sm text-slate-600">Not now</button></div>}
  </section>;
}
