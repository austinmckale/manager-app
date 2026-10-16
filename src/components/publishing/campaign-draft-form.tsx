"use client";

import { useState } from "react";

type DraftChoice = { id: string; jobId: string; jobName: string };
type CampaignSummary = {
  id: string;
  provider: string;
  status: string;
  contentHash: string;
  missingStep: string | null;
  platformCampaignId: string | null;
  destinationUrl: string;
  serviceArea: string;
  objective: string;
  budgetAmountCents: number;
  scheduleStart: string;
  scheduleEnd: string;
};

function dollarsToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function CampaignDraftForm({ drafts, accounts, initialDraftId = "" }: { drafts: DraftChoice[]; accounts: Array<{ provider: "GOOGLE_ADS" | "META_ADS"; id: string; name: string }>; initialDraftId?: string }) {
  const starting = drafts.find((item) => item.id === initialDraftId) ?? drafts[0];
  const [draftId, setDraftId] = useState(starting?.id ?? "");
  const [provider, setProvider] = useState<"GOOGLE_ADS" | "META_ADS">(accounts[0]?.provider ?? "GOOGLE_ADS");
  const [accountExternalId, setAccountExternalId] = useState(accounts.find((account) => account.provider === provider)?.id ?? "");
  const [destinationUrl, setDestinationUrl] = useState("https://rhipros.com/request-a-quote");
  const [serviceArea, setServiceArea] = useState("");
  const [objective, setObjective] = useState<"WEBSITE_VISITS" | "QUOTE_REQUESTS">("QUOTE_REQUESTS");
  const [budget, setBudget] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [saved, setSaved] = useState<CampaignSummary | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const draft = drafts.find((item) => item.id === draftId) ?? null;
  const matchingAccounts = accounts.filter((account) => account.provider === provider);

  async function saveDraft() {
    if (!draft) return;
    const budgetAmountCents = dollarsToCents(budget);
    if (!budgetAmountCents) {
      setMessage("Enter a budget in dollars, such as 25.00.");
      return;
    }
    setPending(true);
    const response = await fetch("/api/publishing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        provider,
        jobId: draft.jobId,
        sourceDraftId: draft.id,
        accountExternalId,
        destinationUrl,
        serviceArea,
        objective,
        budgetAmountCents,
        currency: "USD",
        scheduleStart: new Date(scheduleStart).toISOString(),
        scheduleEnd: new Date(scheduleEnd).toISOString(),
      }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; campaign?: CampaignSummary } | null;
    setSaved(body?.campaign ?? null);
    setMessage(body?.error ?? "Draft saved. Review it, then approve the exact campaign. Nothing has been created in the ad account.");
    setPending(false);
  }

  async function approve() {
    if (!saved) return;
    setPending(true);
    const response = await fetch("/api/publishing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", campaignId: saved.id, contentHash: saved.contentHash }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; campaign?: CampaignSummary } | null;
    if (body?.campaign) setSaved(body.campaign);
    setMessage(body?.error ?? "Approved. Creating a paused campaign is a separate step and does not start spending.");
    setPending(false);
  }

  async function createPaused() {
    if (!saved) return;
    setPending(true);
    const response = await fetch("/api/publishing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createPaused", campaignId: saved.id }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string; campaign?: CampaignSummary } | null;
    if (body?.campaign) setSaved(body.campaign);
    setMessage(body?.error ?? body?.message ?? body?.campaign?.missingStep ?? "Checked.");
    setPending(false);
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="font-semibold">Paid campaign draft</h3>
      <p className="mt-1 text-sm text-slate-600">Content preparation stays separate from launch. This does not enable a campaign or raise a budget. If access is missing, the export on the marketing page still works.</p>
      {!drafts.length ? <p className="mt-3 text-sm text-slate-600">Save a marketing draft first.</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Saved draft
          <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={draftId} onChange={(event) => setDraftId(event.target.value)}>
            {drafts.map((item) => <option key={item.id} value={item.id}>{item.jobName}</option>)}
          </select>
        </label>
        <label className="text-sm">Ad platform
          <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={provider} onChange={(event) => {
            const next = event.target.value as "GOOGLE_ADS" | "META_ADS";
            setProvider(next);
            setAccountExternalId(accounts.find((account) => account.provider === next)?.id ?? "");
          }}>
            <option value="GOOGLE_ADS">Google Ads</option>
            <option value="META_ADS">Meta Ads</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">Account
          {matchingAccounts.length ? (
            <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={accountExternalId} onChange={(event) => setAccountExternalId(event.target.value)}>
              {matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          ) : (
            <input className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={accountExternalId} onChange={(event) => setAccountExternalId(event.target.value)} placeholder={provider === "META_ADS" ? "act_123" : "10-digit customer ID"} />
          )}
        </label>
        <label className="text-sm sm:col-span-2">Destination URL
          <input className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
        </label>
        <label className="text-sm">Service area
          <input className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} placeholder="North Atlanta" />
        </label>
        <label className="text-sm">Objective
          <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={objective} onChange={(event) => setObjective(event.target.value as "WEBSITE_VISITS" | "QUOTE_REQUESTS")}>
            <option value="QUOTE_REQUESTS">Quote requests</option>
            <option value="WEBSITE_VISITS">Website visits</option>
          </select>
        </label>
        <label className="text-sm">Budget (USD)
          <input className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="25.00" />
        </label>
        <label className="text-sm">Schedule start
          <input type="datetime-local" className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
        </label>
        <label className="text-sm">Schedule end
          <input type="datetime-local" className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={pending || !draft} onClick={saveDraft} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Save campaign draft</button>
        <button type="button" disabled={pending || !saved} onClick={approve} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Approve exact campaign</button>
        <button type="button" disabled={pending || saved?.status !== "APPROVED"} onClick={createPaused} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Create paused campaign</button>
      </div>
      {saved ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium">{saved.status}</p>
          <p>{saved.objective} · {saved.serviceArea} · ${(saved.budgetAmountCents / 100).toFixed(2)} · {saved.destinationUrl}</p>
          <p>{saved.scheduleStart} to {saved.scheduleEnd}</p>
          {saved.missingStep ? <p className="mt-1">{saved.missingStep}</p> : null}
          {saved.platformCampaignId ? <p className="mt-1">Platform id: {saved.platformCampaignId}</p> : null}
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
