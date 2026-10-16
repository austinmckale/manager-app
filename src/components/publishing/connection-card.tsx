"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/publishing/status-badge";

type Candidate = { id: string; name: string };
type ConnectionCardModel = {
  provider: string;
  label: string;
  status: string;
  statusLabel: string;
  note: string;
  externalAccountName: string | null;
  candidates: Candidate[];
};

export function ConnectionCard({ connection }: { connection: ConnectionCardModel }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function disconnect() {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/publishing/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: connection.provider }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; note?: string } | null;
    setMessage(body?.error ?? body?.note ?? "Disconnected.");
    setPending(false);
    if (response.ok) window.location.reload();
  }

  async function selectAccount(externalAccountId: string) {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/publishing/select-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: connection.provider, externalAccountId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; note?: string } | null;
    setMessage(body?.error ?? body?.note ?? "Account saved.");
    setPending(false);
    if (response.ok) window.location.reload();
  }

  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{connection.label}</h3>
          <p className="mt-1 text-sm text-slate-600">{connection.externalAccountName ?? "No account selected"}</p>
        </div>
        <StatusBadge status={connection.status} label={connection.statusLabel} />
      </div>
      <p className="mt-3 text-sm text-slate-600">{connection.note}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`/api/publishing/connect?provider=${connection.provider}`} className="rounded-xl bg-teal-700 px-3 py-2 text-sm font-medium text-white">
          {connection.status === "CONNECTED" ? "Reconnect" : "Connect"}
        </a>
        {connection.status !== "MISSING_CONFIGURATION" ? (
          <button type="button" disabled={pending} onClick={disconnect} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            Disconnect
          </button>
        ) : null}
      </div>
      {connection.candidates.length > 1 ? (
        <label className="mt-3 block text-sm">
          Choose account
          <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" defaultValue="" onChange={(event) => event.target.value && selectAccount(event.target.value)}>
            <option value="">Select</option>
            {connection.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </article>
  );
}
