"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { StatusBadge } from "@/components/publishing/status-badge";
import { facebookSetupCopy, facebookSubmitBlock, interpretPublishResponse, type FacebookDraft, type FacebookSetup, type PublishBody } from "@/components/publishing/facebook-publish";

type Destination = "INSTAGRAM" | "GOOGLE_BUSINESS";

export function FacebookPublishScreen({
  mode,
  facebook,
  drafts,
  initialDraftId = "",
  fixture,
}: {
  mode: "mock" | "live";
  facebook: FacebookSetup;
  drafts: FacebookDraft[];
  initialDraftId?: string;
  fixture?: PublishBody | null;
}) {
  const starting = drafts.find((item) => item.id === initialDraftId) ?? drafts[0];
  const [draftId, setDraftId] = useState(starting?.id ?? "");
  const draft = drafts.find((item) => item.id === draftId) ?? null;
  const [assetIds, setAssetIds] = useState<string[]>(starting?.photos.map((photo) => photo.id) ?? []);
  const [also, setAlso] = useState<Destination[]>([]);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState(fixture ? interpretPublishResponse(true, fixture) : null);
  const lock = useRef(false);
  const setup = facebookSetupCopy(facebook, mode);
  const selected = draft?.photos.filter((photo) => assetIds.includes(photo.id)) ?? [];
  const blocked = draft
    ? facebookSubmitBlock({ pending, mode, connectionStatus: facebook.status, approval: draft.approval, photoCount: selected.length, caption: draft.caption, postable: draft.postable })
    : "Save a draft on the marketing page first. This screen posts that saved caption; it does not write a new one.";

  function chooseDraft(id: string) {
    const next = drafts.find((item) => item.id === id);
    setDraftId(id);
    setAssetIds(next?.photos.map((photo) => photo.id) ?? []);
    setOutcome(null);
  }

  async function publish() {
    if (!draft || lock.current || facebookSubmitBlock({ pending: false, mode, connectionStatus: facebook.status, approval: draft.approval, photoCount: selected.length, caption: draft.caption, postable: draft.postable })) return;
    lock.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/publishing/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: draft.jobId, draftId: draft.id, assetIds: selected.map((photo) => photo.id), destinations: ["FACEBOOK_PAGE", ...also] }),
      });
      const body = (await response.json().catch(() => null)) as PublishBody | null;
      setOutcome(interpretPublishResponse(response.ok, body));
    } catch {
      setOutcome({ kind: "error", message: "The request did not finish. Check Facebook delivery status before trying again. Do not assume it posted." });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">Facebook</p>
          <h3 className="mt-1 text-xl font-semibold">{setup.account ?? "No Facebook Page selected"}</h3>
        </div>
        <StatusBadge status={facebook.status} label={setup.label} />
      </div>
      <p className="text-sm text-slate-700">{setup.note}</p>
      <p className={mode === "live" ? "rounded-xl bg-teal-50 p-3 text-sm text-teal-900" : "rounded-xl bg-amber-50 p-3 text-sm text-amber-950"}>{setup.modeNote}</p>
      {!drafts.length ? <p className="text-sm text-slate-600">Save a draft on the marketing page first. This screen posts that saved caption; it does not write a new one.</p> : null}
      {draft ? (
        <>
          <label className="block text-sm font-medium">
            Saved draft
            <select disabled={pending} className="mt-1 w-full rounded-xl border border-slate-300 p-2" value={draft.id} onChange={(event) => chooseDraft(event.target.value)}>
              {drafts.map((item) => (
                <option key={item.id} value={item.id}>{item.jobName} · {new Date(item.createdAt).toLocaleString()} · {item.photos.length} photos</option>
              ))}
            </select>
          </label>
          <p className={draft.approval === "approved" ? "rounded-xl bg-teal-50 p-3 text-sm text-teal-900" : "rounded-xl bg-amber-50 p-3 text-sm text-amber-950"}>{draft.approvalDetail}</p>
          <fieldset>
            <legend className="text-sm font-medium">Photos in this draft</legend>
            <div className="mt-2 space-y-2">
              {draft.photos.map((photo) => (
                <label key={photo.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={pending} checked={assetIds.includes(photo.id)} onChange={(event) => setAssetIds(event.target.checked ? [...assetIds, photo.id] : assetIds.filter((id) => id !== photo.id))} />
                  <span>{photo.fileName}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <article aria-label="Facebook post preview" className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-semibold">{setup.account ?? "Facebook Page"}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{draft.caption || "No Facebook caption is saved on this draft."}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {selected.map((photo) => (
                <figure key={photo.id}>
                  {photo.url ? <img src={photo.url} alt={photo.fileName} className="aspect-square w-full rounded-xl object-cover" /> : <div className="flex aspect-square items-center justify-center rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-600">Photo preview unavailable · {photo.fileName}</div>}
                  <figcaption className="mt-1 truncate text-xs text-slate-500">{photo.fileName}</figcaption>
                </figure>
              ))}
            </div>
          </article>
          <fieldset>
            <legend className="text-sm font-medium">Also send this approved draft</legend>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {([["INSTAGRAM", "Instagram"], ["GOOGLE_BUSINESS", "Google Business Profile"]] as const).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2">
                  <input type="checkbox" disabled={pending} checked={also.includes(id)} onChange={(event) => setAlso(event.target.checked ? [...also, id] : also.filter((item) => item !== id))} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" disabled={pending || Boolean(facebookSubmitBlock({ pending: false, mode, connectionStatus: facebook.status, approval: draft.approval, photoCount: selected.length, caption: draft.caption, postable: draft.postable }))} onClick={() => void publish()} className="rounded-xl bg-[#b4411b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Waiting for confirmation…" : mode === "live" ? "Post to Facebook" : "Simulate Facebook post"}
          </button>
        </>
      ) : null}
      {blocked && !pending ? <p role="status" className="text-sm text-slate-700">{blocked}</p> : null}
      {outcome?.kind === "error" ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{outcome.message}</p> : null}
      {outcome?.kind === "simulation" ? <div role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Simulation result</p><p className="mt-1">{outcome.message}</p>{outcome.facebook.simulation ? <p className="mt-3 whitespace-pre-wrap">{outcome.facebook.simulation.text}</p> : null}</div> : null}
      {outcome?.kind === "accepted" ? <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{outcome.message}</p> : null}
      {outcome?.kind === "published" ? <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900"><span className="font-semibold">Published.</span> {outcome.message}</p> : null}
    </section>
  );
}
