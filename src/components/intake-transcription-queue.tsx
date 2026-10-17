"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function IntakeTranscriptionQueue({ items }: { items: { id: string; receivedAt: string; failed: boolean; attempts: number }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function retry(audioId: string) {
    setBusy(audioId); setMessage("");
    try {
      const response = await fetch("/api/marketing/processing/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioId }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not retry. Refresh and try again.");
      setMessage("Queued for another attempt when the local worker is available."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not retry. Refresh and try again."); }
    finally { setBusy(null); }
  }
  return <section className="rounded-2xl border bg-white p-4"><h2 className="font-semibold">Voice processing</h2><p className="mt-2 text-sm text-slate-600">Recordings retry up to three times. Failed recordings stay saved and can be retried here. Other submissions continue processing.</p>{items.length ? <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className="rounded-xl border p-3 text-sm"><p>{item.failed ? "Needs attention" : "Waiting for local transcription"} · {new Date(item.receivedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern</p><p className="mt-1 text-slate-500">Attempts: {item.attempts}{item.failed ? ". Check the recording and local Python runtime before retrying." : ". Your PC must be awake with the worker running."}</p>{item.failed ? <button disabled={busy !== null} onClick={() => void retry(item.id)} className="mt-2 rounded-lg border px-3 py-2 font-medium disabled:opacity-50">{busy === item.id ? "Queuing…" : "Retry transcription"}</button> : null}</li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No recordings are waiting in this view.</p>}<p role="status" className="mt-3 text-sm">{message}</p></section>;
}
