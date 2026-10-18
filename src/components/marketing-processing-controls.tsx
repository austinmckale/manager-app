"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessingSettings } from "@/lib/marketing-processing";

type Heartbeat = { checkedAt: string; state: string; mode: string; apiKeyReady: boolean; model: string } | null;
export function MarketingProcessingControls({ settings, heartbeat, callsToday }: { settings: ProcessingSettings; heartbeat: Heartbeat; callsToday: number }) {
  const router = useRouter();
  const [mode, setMode] = useState(settings.mode);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [limit, setLimit] = useState(settings.dailyCallLimit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = mode !== settings.mode || enabled !== settings.enabled || limit !== settings.dailyCallLimit;
  const checkedAt = heartbeat ? Date.parse(heartbeat.checkedAt) : Number.NaN;
  const checkedInRecently = Number.isFinite(checkedAt) && Date.now() - checkedAt <= 5 * 60 * 1000;
  useEffect(() => { const timer = setInterval(() => router.refresh(), 15000); return () => clearInterval(timer); }, [router]);
  async function act(action: "save" | "test") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/processing/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "save" ? { mode, enabled, dailyCallLimit: limit } : {}) }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update processing.");
      setMessage(action === "test" ? "One test cycle requested. The worker will try one pending submission (including test uploads), then return to your automatic setting. If there is no pending upload, it checks a saved draft." : "Settings saved. The worker reads them on its next cycle. A model request already in progress may finish."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update processing."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border bg-white p-5" aria-label="AI processing controls">
    <h2 className="text-lg font-semibold">You control when AI runs</h2>
    <p className="mt-2 text-sm">Automatic processing: <strong>{settings.enabled && settings.mode !== "manual" ? "On" : "Off"}</strong>. {settings.testRequestedAt ? "One test cycle is waiting." : ""}</p>
    <p className="mt-2 text-sm">Worker: {heartbeat ? `${heartbeat.state} · ${heartbeat.model} · last seen ${new Date(heartbeat.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern` : "This version has not checked in yet. The Windows worker must be installed and running."}</p>
    {heartbeat ? <p className="mt-2 text-sm">{checkedInRecently ? "Local AI checked in within the last 5 minutes. This is the last stored check-in, not live GPU use." : "Last worker check-in was over 5 minutes ago—local AI may be off or this PC may be asleep. This page only shows the last stored check-in, not live GPU use. Use the desktop RHI AI shortcut on the worker PC to confirm."}</p> : null}
    <label className="mt-4 block text-sm font-medium">How to prepare drafts<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={busy} className="mt-2 w-full rounded-xl border p-3"><option value="hybrid">Hybrid: local voice + paid OpenAI photos and copy</option><option value="local">Local: Ollama + local voice</option><option value="manual">Manual: export to ChatGPT or Claude</option></select></label>
    <p className="mt-2 text-sm text-slate-600">{mode === "hybrid" ? "Selected photos and notes go to OpenAI for analysis, writing and review. Voice transcription stays on this PC. This uses API billing, not your chat subscription." : mode === "local" ? "Photos, voice and AI drafting run on this PC. Quality and speed depend on the installed model and hardware." : "Download a review bundle from a draft, attach its photos and prompt in your chat app, then import the returned JSON as an unapproved draft."}</p>
    {mode === "hybrid" ? <><p className="mt-2 text-sm">API key on worker: <strong>{heartbeat?.apiKeyReady ? "Detected; run a test to verify it" : "Not verified. Add OPENAI_API_KEY to the worker’s private environment file."}</strong></p><label className="mt-3 block text-sm">Maximum API calls per UTC day<input type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(Number(event.target.value))} className="ml-3 w-24 rounded-lg border p-2" /></label><p className="mt-2 text-xs text-slate-500">{callsToday} calls reserved today. A pack uses several calls, including one per photo. This limits requests, not dollars; also set a budget in your API account.</p></> : null}
    <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={enabled && mode !== "manual"} disabled={busy || mode === "manual"} onChange={(event) => setEnabled(event.target.checked)} /><span>Process new uploads automatically while this PC and its worker are running. Drafts still require owner approval.</span></label>
    <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy || !Number.isInteger(limit) || limit < 1 || limit > 500} onClick={() => void act("save")} className="rounded-xl bg-teal-700 px-4 py-3 font-medium text-white disabled:opacity-40">Save processing settings</button><button disabled={busy || dirty || !!settings.testRequestedAt} onClick={() => void act("test")} className="rounded-xl border px-4 py-3 disabled:opacity-40">{mode === "manual" ? "Run local checks on a saved draft" : "Run one test cycle"}</button></div>
    {dirty ? <p className="mt-2 text-xs">Save your choices before testing.</p> : null}<p role="status" className="mt-3 text-sm">{message}</p>
  </section>;
}
