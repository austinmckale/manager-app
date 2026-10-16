"use client";

import { useState } from "react";

type DraftChoice = { id: string; jobId: string; jobName: string; assetIds: string[]; createdAt: string };
type Destination = "FACEBOOK_PAGE" | "INSTAGRAM" | "GOOGLE_BUSINESS";
type PublishResult = { destination: string; status: string; error: string | null; deduped: boolean; mock: boolean; attemptCount: number };

const DESTINATIONS: Array<{ id: Destination; label: string }> = [
  { id: "FACEBOOK_PAGE", label: "Facebook Page" },
  { id: "INSTAGRAM", label: "Instagram" },
  { id: "GOOGLE_BUSINESS", label: "Google Business Profile" },
];

export function PublishForm({ drafts, initialDraftId = "" }: { drafts: DraftChoice[]; initialDraftId?: string }) {
  const starting = drafts.find((item) => item.id === initialDraftId) ?? drafts[0];
  const [draftId, setDraftId] = useState(starting?.id ?? "");
  const draft = drafts.find((item) => item.id === draftId) ?? null;
  const [assetIds, setAssetIds] = useState<string[]>(starting?.assetIds ?? []);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<PublishResult[]>([]);
  const [pending, setPending] = useState(false);

  function chooseDraft(id: string) {
    const next = drafts.find((item) => item.id === id);
    setDraftId(id);
    setAssetIds(next?.assetIds ?? []);
    setResults([]);
  }

  async function publish() {
    if (!draft) return;
    setPending(true);
    setMessage("");
    const response = await fetch("/api/publishing/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: draft.jobId, draftId: draft.id, assetIds, destinations }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; mode?: string; results?: PublishResult[] } | null;
    setResults(body?.results ?? []);
    setMessage(body?.error ?? (body?.mode === "mock" ? "Mock result. Nothing was posted to Facebook, Instagram, or Google." : "Each destination is listed separately."));
    setPending(false);
  }

  if (!drafts.length) {
    return <p className="text-sm text-slate-600">Save a draft on the marketing page first. This page posts that saved copy; it does not accept a new caption.</p>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="font-semibold">Post a saved draft</h3>
      <p className="mt-1 text-sm text-slate-600">The server uses the saved caption and the photos already on the draft. A success on one destination does not hide a failure on another.</p>
      <label className="mt-3 block text-sm">
        Saved draft
        <select className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={draftId} onChange={(event) => chooseDraft(event.target.value)}>
          {drafts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.jobName} · {new Date(item.createdAt).toLocaleString()} · {item.assetIds.length} photos
            </option>
          ))}
        </select>
      </label>
      <fieldset className="mt-3">
        <legend className="text-sm">Photos</legend>
        <div className="mt-2 space-y-1">
          {draft?.assetIds.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assetIds.includes(id)}
                onChange={(event) => setAssetIds(event.target.checked ? [...assetIds, id] : assetIds.filter((assetId) => assetId !== id))}
              />
              <span className="truncate">{id}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="text-sm">Destinations</legend>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {DESTINATIONS.map((destination) => (
            <label key={destination.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={destinations.includes(destination.id)}
                onChange={(event) =>
                  setDestinations(event.target.checked ? [...destinations, destination.id] : destinations.filter((item) => item !== destination.id))
                }
              />
              {destination.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" disabled={pending || !assetIds.length || !destinations.length} onClick={publish} className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Publishing" : "Publish now"}
      </button>
      {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
      {results.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {results.map((result) => (
            <li key={result.destination} className="rounded-xl bg-slate-50 p-3">
              <span className="font-medium">{result.destination}</span> · {result.status}
              {result.deduped ? " · already sent" : ""}
              {result.mock ? " · mock, not sent" : ""}
              {result.error ? ` · ${result.error}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
