"use client";
import { useState } from "react";
import type { BufferChannel } from "@/lib/publishing/buffer";

export function BufferChannelSetup({ channels, selectedIds }: { channels: BufferChannel[]; selectedIds: string[] }) {
  const [selected, setSelected] = useState(selectedIds);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/publishing/buffer/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelIds: selected }), signal: AbortSignal.timeout(60000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save channels.");
      setMessage("Channels saved. Nothing was posted. Open an approved draft to choose Send to Buffer.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save channels."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border p-4"><h2 className="font-semibold">Choose your RHI Pros channels</h2><div className="mt-3 space-y-3">{channels.map((channel) => <label key={channel.id} className="flex items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={selected.includes(channel.id)} disabled={busy} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, channel.id] : ids.filter((id) => id !== channel.id))} /><span>{channel.displayName || channel.name} · {channel.service}<span className="mt-1 block text-xs text-slate-500">{channel.organization}{channel.isQueuePaused ? " · Queue paused in Buffer" : ""}</span></span></label>)}</div><button disabled={busy} onClick={() => void save()} className="mt-4 rounded-xl bg-teal-700 px-4 py-3 text-white disabled:opacity-40">Save selected channels</button><p role="status" className="mt-3 text-sm">{message}</p></section>;
}
