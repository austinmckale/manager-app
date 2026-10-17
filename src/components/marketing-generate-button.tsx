"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const actionButton = "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto";

export function MarketingGenerateButton({ submissionId, hasDraft }: { submissionId: string; hasDraft: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = hasDraft ? "Revise with AI" : "Analyse photos & write captions";

  async function queue() {
    setBusy(true);
    setMessage("Queuing this request for the local worker.");
    try {
      const response = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: unknown; status?: unknown; claimed?: unknown } | null;
      if (!response.ok || result?.ok === false) {
        const error = typeof result?.error === "string" && result.error.trim() ? result.error : "Could not queue this submission. Try again.";
        throw new Error(error);
      }
      const claimed = result?.status === "running" || result?.claimed === true;
      const status = typeof result?.status === "string" ? result.status : "";
      setMessage(claimed ? "The local worker has claimed this request." : status === "completed" ? "This submission already finished a local request. It was not queued again." : status === "failed" ? "This local request already stopped. It was not queued again." : status === "held" ? "This request is held for more detail. It was not queued again." : "This request is queued for the local worker.");
      router.refresh();
    } catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        setMessage("The queue request did not confirm. Refresh this submission before trying again.");
      } else {
        const text = error instanceof Error ? error.message : "";
        setMessage(text && text !== "Failed to fetch" ? text : "Could not queue this submission. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-slate-300 bg-white p-4" aria-label={label}>
    <button type="button" disabled={busy} aria-busy={busy} aria-describedby="marketing-generate-note marketing-generate-status" onClick={() => void queue()} className={actionButton}>{busy ? "Queuing…" : label}</button>
    <p id="marketing-generate-note" className="mt-2 text-sm text-slate-800">A click queues this request for the local worker. It does not run in this browser, and automatic processing stays unchanged.</p>
    <p id="marketing-generate-status" role="status" className="mt-2 text-sm font-semibold text-slate-900">{message}</p>
  </section>;
}
