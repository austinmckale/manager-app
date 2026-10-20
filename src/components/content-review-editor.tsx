"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MarketingDraft } from "@/lib/marketing";
import { plainGaps } from "@/lib/marketing-evidence";
import type { ContentReview, ReviewFinding } from "@/lib/content-review";
import { cosmeticFinding } from "@/lib/review-findings";
import { postedCopyChecks } from "@/lib/copy-checks";
import { MarketingChatHandoff } from "@/components/marketing-chat-handoff";
import { PostPreviews } from "@/components/post-previews/post-previews";

type Props = { lockedFields?: string[]; draftId: string; jobId: string; jobName: string; originalNotes?: string; inputHash: string; initialDraft: MarketingDraft; photos: { id: string; fileName: string; url: string; description: string }[]; audio: { id: string; transcript: string; status: string }[]; review: ContentReview | null; copyFindings?: ReviewFinding[]; approvedAt: string | null; superseded: boolean; replacementDraftId?: string; voicePending: boolean; demo?: boolean };
type ReviewPhoto = Props["photos"][number];

// Buffer posts only these two captions. Ad drafts stay in the data but are not shown or checked here.
const POSTED = { social: "Facebook & Instagram", googleBusiness: "Google Business" } as const;
type PostedField = keyof typeof POSTED;
const POSTED_FIELDS = Object.keys(POSTED) as PostedField[];
const LIMITS: Record<PostedField, number> = { social: 2200, googleBusiness: 1500 };
const QUICK_ASKS = ["Make it shorter", "More direct", "Write another option", "Mention the town"];

const box = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base";
const primary = "min-h-11 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const secondary = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-40";

function distinctFindings<T extends { severity: string; detail: string; suggestion: string }>(findings: T[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.severity}|${finding.detail}|${finding.suggestion}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function withholdsPublication(finding: { detail: string; suggestion: string; evidence?: string }) {
  const text = `${finding.detail}\n${finding.suggestion}\n${finding.evidence ?? ""}`;
  return /do not publish/i.test(text) || /\bTEST\b/i.test(text) || /not for publication/i.test(text);
}
function photosForIds(catalog: ReviewPhoto[], ids: string[]) {
  const byId = new Map(catalog.map((photo) => [photo.id, photo]));
  const seen = new Set<string>();
  const next: ReviewPhoto[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const photo = byId.get(id);
    if (!photo) continue;
    seen.add(id);
    next.push(photo);
  }
  return next;
}
function samePhotoIds(current: ReviewPhoto[], next: ReviewPhoto[]) {
  return current.length === next.length && current.every((photo, index) => photo.id === next[index]?.id);
}
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function Step({ number, title, hint, children }: { number: number; title: string; hint?: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-baseline gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-800 text-sm font-semibold text-white">{number}</span><div><h3 className="font-semibold text-slate-900">{title}</h3>{hint ? <p className="text-sm text-slate-600">{hint}</p> : null}</div></div>
    <div className="mt-3">{children}</div>
  </section>;
}

export function ContentReviewEditor(props: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(props.initialDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [facts, setFacts] = useState(false);
  const [permission, setPermission] = useState(false);
  const [resolution, setResolution] = useState("");
  const [photos, setPhotos] = useState(props.photos);
  const [photoNotes, setPhotoNotes] = useState<Record<string, string>>({});
  const [showAllProblems, setShowAllProblems] = useState(false);
  // Captions the owner kept. AI rewrites, "Accept all fixes" and chat imports never change them.
  const [locked, setLocked] = useState<Set<PostedField>>(() => new Set((props.lockedFields ?? []).filter((field): field is PostedField => field in POSTED)));
  const [ask, setAsk] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReady, setAiReady] = useState<{ proposal: Partial<Record<PostedField, string>>; remaining: number | null } | null>(null);
  const [undoDraft, setUndoDraft] = useState<MarketingDraft | null>(null);
  const aiPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const photoList = useRef(props.photos);
  // Saved photos plus edited copies added on this page; a copy joins the draft when it is saved.
  const photoCatalog = useRef(props.photos);

  const photoNumber = (id: string) => { const index = photos.findIndex((photo) => photo.id === id); return index >= 0 ? `Photo ${index + 1}` : "A photo"; };
  const readable = (detail: string) => detail.replace(/Photo ([0-9a-f-]{36}):\s*/gi, (_, id: string) => `${photoNumber(id)}: `).replace(uuid, (id) => photoNumber(id).toLowerCase()).replace(/[ \t]{2,}/g, " ").trim();

  function commitPhotoOrder(ids: string[]) {
    const next = photosForIds(photoCatalog.current, ids);
    if (!next.length || samePhotoIds(photoList.current, next)) return null;
    photoList.current = next;
    setPhotos(next);
    return next.map((photo) => photo.id);
  }
  function resetApproval() { setFacts(false); setPermission(false); }
  function importDraft(imported: MarketingDraft) {
    const assetIds = commitPhotoOrder(imported.assetIds);
    const kept = Object.fromEntries([...locked].map((field) => [field, draft[field]]));
    setDraft(assetIds ? { ...imported, ...kept, assetIds } : { ...imported, ...kept });
    resetApproval();
  }
  function acceptPhotoIds(photoIds: string[], improvements?: { id: string; note: string }[]) {
    setPhotoNotes(Object.fromEntries((improvements ?? []).flatMap((item) => (item.note.trim() ? [[item.id, item.note.trim()]] : []))));
    const assetIds = commitPhotoOrder(photoIds);
    if (!assetIds) return;
    setDraft((current) => ({ ...current, assetIds }));
    resetApproval();
  }
  function addEditedPhoto(replaces: string, photo: ReviewPhoto) {
    photoCatalog.current = [...photoCatalog.current.filter((item) => item.id !== photo.id), photo];
    const current = photoList.current.map((item) => item.id);
    const ids = current.includes(replaces) ? current.map((id) => (id === replaces ? photo.id : id)) : [...current, photo.id];
    const assetIds = commitPhotoOrder(ids);
    if (!assetIds) return;
    setDraft((draftNow) => ({ ...draftNow, assetIds }));
    resetApproval();
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initialDraft);
  const reviewFindings = props.review?.result?.findings ?? [];
  const copyFindings = dirty ? postedCopyChecks(draft) : (props.copyFindings ?? []);
  const realBlocker = (finding: { severity: string; detail: string }) => finding.severity === "blocker" && !cosmeticFinding(finding.detail);
  const blockers = distinctFindings([...reviewFindings.filter(realBlocker), ...copyFindings.filter(realBlocker)]);
  const gaps = plainGaps(reviewFindings.filter((finding) => !cosmeticFinding(finding.detail)));
  const substantiveWarnings = distinctFindings([...reviewFindings, ...copyFindings].filter((finding) => finding.severity === "warning" && !cosmeticFinding(finding.detail)));
  const evidenceClear = !!props.review?.evidence && !props.review.evidence.reasons.some((reason) => !cosmeticFinding(reason));
  const passed = props.review?.status === "completed" && props.review.policyVersion === 3 && evidenceClear && props.review.inputHash === props.inputHash && blockers.length === 0;
  const checksFinished = props.review?.status === "completed";
  const checksBusy = props.review?.status === "queued" || props.review?.status === "running";
  const approved = Boolean(props.approvedAt) && !props.superseded && !dirty;
  const approveDisabled = !passed || dirty || !facts || !permission || busy || props.voicePending || props.superseded || props.demo || (substantiveWarnings.length > 0 && resolution.trim().length < 10);
  const fixes = checksFinished && !props.superseded ? (Object.entries(props.review?.fixes?.copy ?? {}) as [string, unknown][]).filter((entry): entry is [PostedField, string] => entry[0] in POSTED && typeof entry[1] === "string") : [];
  const stage = props.superseded ? "Replaced" : approved ? "Approved" : dirty ? "Unsaved changes" : checksBusy ? "AI is checking" : props.review?.status === "failed" ? "Check failed" : passed ? "Ready to approve" : checksFinished ? "Needs changes" : "Not checked yet";

  useEffect(() => {
    if (!checksBusy) return;
    const timer = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(timer);
  }, [checksBusy, router]);

  function persistLocks(next: Set<PostedField>) {
    if (props.demo || props.superseded) return;
    void fetch("/api/marketing/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "locks", draftId: props.draftId, inputHash: props.inputHash, fields: [...next] }) }).catch(() => undefined);
  }
  function toggleLock(field: PostedField) {
    setLocked((current) => { const next = new Set(current); if (next.has(field)) next.delete(field); else next.add(field); persistLocks(next); return next; });
  }
  function edit<K extends keyof MarketingDraft>(key: K, value: MarketingDraft[K]) {
    // Typing in a caption keeps it, so an AI rewrite never overwrites the owner's own words.
    if (key in POSTED && !locked.has(key as PostedField)) toggleLock(key as PostedField);
    setDraft((current) => ({ ...current, [key]: value }));
    resetApproval();
  }
  function acceptFixes(fields: [PostedField, string][], skipKept = false) {
    const chosen = skipKept ? fields.filter(([field]) => !locked.has(field)) : fields;
    setDraft((current) => ({ ...current, ...Object.fromEntries(chosen) }));
    resetApproval();
    setMessage("Fixes are in the text above. Save and check them when you are ready.");
  }

  // AI rewrite: rewrites the captions that are not kept, follows the note, and fact-checks the result.
  const unlocked = POSTED_FIELDS.filter((field) => !locked.has(field));
  function applyRewrite(proposal: Partial<Record<PostedField, string>>, remaining: number | null) {
    const fields = unlocked.filter((field) => typeof proposal[field] === "string");
    if (!fields.length) { setAiStatus("The AI did not return new text. Try a different note."); return; }
    setUndoDraft(draft);
    setDraft((current) => ({ ...current, ...Object.fromEntries(fields.map((field) => [field, proposal[field]])) }));
    resetApproval(); setAiReady(null);
    setAiStatus(`Rewrote ${fields.map((field) => POSTED[field]).join(" and ")}.${remaining ? ` The AI fact-check still sees ${remaining} problem${remaining === 1 ? "" : "s"}; check before approving.` : ""}`);
  }
  function stopAiPoll() { if (aiPoll.current) { clearInterval(aiPoll.current); aiPoll.current = null; } }
  function watchRewrite(autoApply: boolean) {
    stopAiPoll();
    let sawRunning = !autoApply;
    aiPoll.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/marketing/revise?mode=regenerate&draftId=${encodeURIComponent(props.draftId)}&inputHash=${encodeURIComponent(props.inputHash)}`, { cache: "no-store" });
        const latest = (await response.json())?.regenerate as { status: string; proposal: Partial<Record<PostedField, string>>; remaining: number | null; error: string | null } | null;
        if (!latest) return;
        if (latest.status === "queued" || latest.status === "running") { sawRunning = true; setAiStatus(latest.status === "queued" ? "Waiting for the AI on your PC…" : "The AI is rewriting…"); return; }
        if (!sawRunning) return;
        stopAiPoll(); setAiBusy(false);
        if (latest.status === "ready") applyRewrite(latest.proposal, latest.remaining);
        else setAiStatus(latest.error || "The rewrite did not finish. Try again.");
      } catch { /* keep watching */ }
    }, 3000);
  }
  useEffect(() => {
    if (props.demo || props.superseded) return;
    let cancelled = false;
    void fetch(`/api/marketing/revise?mode=regenerate&draftId=${encodeURIComponent(props.draftId)}&inputHash=${encodeURIComponent(props.inputHash)}`, { cache: "no-store" }).then((response) => response.json()).then((body) => {
      const latest = body?.regenerate;
      if (cancelled || !latest) return;
      if (latest.status === "queued" || latest.status === "running") { setAiBusy(true); setAiStatus("The AI is rewriting…"); watchRewrite(false); }
      else if (latest.status === "ready") setAiReady({ proposal: latest.proposal, remaining: latest.remaining });
    }).catch(() => undefined);
    return () => { cancelled = true; stopAiPoll(); };
    // Restart only when the version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draftId, props.inputHash]);
  async function rewrite() {
    if (props.demo || props.superseded || !unlocked.length) return;
    setAiBusy(true); setAiReady(null); setAiStatus("Sending to the AI on your PC…");
    try {
      const keptValues = Object.fromEntries([...locked].map((field) => [field, draft[field]]));
      const response = await fetch("/api/marketing/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: props.draftId, inputHash: props.inputHash, mode: "regenerate", locked: keptValues, note: ask.trim() }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Could not send the request.");
      setAiStatus("Waiting for the AI on your PC…");
      watchRewrite(true);
    } catch (error) {
      setAiBusy(false);
      setAiStatus(error instanceof Error ? error.message : "Could not send the request.");
    }
  }
  function undoRewrite() {
    if (!undoDraft) return;
    setDraft(undoDraft); setUndoDraft(null);
    setAiStatus("Put back the text from before the rewrite.");
  }

  async function act(action: "save" | "check" | "approve", withCheck = false) {
    if (props.demo) { setMessage("Preview only. Nothing was saved or checked."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, draftId: props.draftId, inputHash: props.inputHash, ...(action === "save" ? { draft, check: withCheck, lockedFields: [...locked] } : {}), ...(action === "approve" ? { factsChecked: facts, photosCleared: permission, resolution } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save. Please retry.");
      if (action === "save") router.push(`/marketing/review/${result.draftId}`);
      else { setMessage(action === "check" ? "The AI check is queued on your PC. You can leave this page." : "Approved. Nothing is posted until you send it to Buffer."); router.refresh(); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete this action.");
    } finally { setBusy(false); }
  }

  const visibleProblems = showAllProblems ? blockers : blockers.slice(0, 3);
  const caption = (field: PostedField) => {
    const on = locked.has(field);
    return <div key={field} className="mt-3 first:mt-0">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`caption-${field}`} className="text-sm font-semibold text-slate-900">{POSTED[field]}</label>
        <button type="button" aria-pressed={on} disabled={props.demo || props.superseded} onClick={() => toggleLock(field)} className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600"}`}>{on ? "✓ Kept" : "Keep"}</button>
      </div>
      <textarea id={`caption-${field}`} className={box} value={draft[field]} maxLength={LIMITS[field]} rows={field === "social" ? 5 : 4} disabled={busy || props.superseded} onChange={(event) => edit(field, event.target.value)} />
      <p className="text-right text-xs text-slate-500">{draft[field].length}/{LIMITS[field]}</p>
    </div>;
  };

  return <div className="mx-auto max-w-3xl space-y-4">
    <header>
      <Link href="/marketing/saved" className="text-sm text-teal-800 underline">← Content</Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-slate-900">{draft.packName || props.jobName || "Post"}</h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${stage === "Approved" || stage === "Ready to approve" ? "bg-teal-100 text-teal-900" : stage === "Needs changes" || stage === "Check failed" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{stage}</span>
      </div>
    </header>
    {props.demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Example only. Saving, checks and approval are off.</p> : null}
    {props.superseded ? <p className="rounded-xl bg-amber-50 p-3 text-sm">This version was replaced. {props.replacementDraftId ? <Link className="font-semibold underline" href={`/marketing/review/${props.replacementDraftId}`}>Open the newer version</Link> : null}</p> : null}

    <Step number={1} title="Photos" hint={photos.length > 1 ? "Photo 1 leads the post." : undefined}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo, index) => <figure key={photo.id} className="relative">
        <img src={photo.url} alt={photo.description || `Photo ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{index + 1}</span>
        {photoNotes[photo.id] ? <figcaption className="mt-1 text-xs text-slate-700">Improve: {photoNotes[photo.id]}</figcaption> : null}
      </figure>)}</div>
    </Step>

    <Step number={2} title="Post text" hint="This is exactly what Buffer posts. Tap Keep on text you like; typing in a box keeps it too.">
      {POSTED_FIELDS.map(caption)}
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-slate-700">Preview the posts</summary>
        <div className="mt-3"><PostPreviews draft={{ social: draft.social, googleBusiness: draft.googleBusiness, metaPrimary: draft.metaPrimary, metaHeadline: draft.metaHeadline, imageHeadline: draft.imageHeadline, publicLocation: draft.publicLocation, service: draft.service, landingUrl: draft.landingUrl, googleHeadlines: draft.googleHeadlines, googleDescriptions: draft.googleDescriptions }} photos={photos} /></div>
      </details>
    </Step>

    {!props.demo ? <Step number={3} title="Improve with AI" hint={unlocked.length ? `Rewrites ${unlocked.map((field) => POSTED[field]).join(" and ")}; kept text stays as it is. The AI checks the result against the photos and notes.` : "Both captions are kept. Tap Keep on one to let the AI rewrite it."}>
      <label htmlFor="ai-ask" className="text-sm font-medium text-slate-900">What should change?</label>
      <textarea id="ai-ask" className={box} rows={2} maxLength={300} value={ask} onChange={(event) => setAsk(event.target.value)} placeholder="For example: remove the dishwasher mention, or make it friendlier" />
      <div className="mt-2 flex flex-wrap gap-2">{QUICK_ASKS.map((quick) => <button key={quick} type="button" onClick={() => setAsk((current) => (current.trim() ? `${current.trim().replace(/[.;,]$/, "")}; ${quick.toLowerCase()}` : quick))} className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700">+ {quick}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void rewrite()} disabled={busy || aiBusy || props.superseded || !unlocked.length} className={primary}>{aiBusy ? "Rewriting…" : "Rewrite with AI"}</button>
        {undoDraft ? <button type="button" onClick={undoRewrite} className="text-sm font-semibold text-slate-900 underline">Undo</button> : null}
        {aiReady && !aiBusy ? <button type="button" onClick={() => applyRewrite(aiReady.proposal, aiReady.remaining)} className="text-sm font-semibold text-teal-900 underline">Use the last rewrite</button> : null}
      </div>
      {aiStatus ? <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-800">{aiStatus}</p> : null}
    </Step> : null}

    <Step number={props.demo ? 3 : 4} title={approved ? "Send it" : "Check and approve"}>
      {props.review?.error ? <p className="mb-2 text-sm text-red-700">{props.review.error}</p> : null}
      {checksBusy && !dirty ? <p className="text-sm text-slate-800">The AI is checking this version on your PC. This page updates by itself. <button type="button" onClick={() => router.refresh()} className="font-semibold underline">Refresh</button></p> : null}

      {checksFinished && !dirty && blockers.length ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="font-semibold text-amber-950">{blockers.some(withholdsPublication) ? "This cannot be posted" : `Fix ${blockers.length === 1 ? "this" : `these ${blockers.length}`} before approving`}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{visibleProblems.map((finding, index) => <li key={`${finding.detail}-${index}`}>{readable(finding.detail)}</li>)}</ul>
        {blockers.length > 3 ? <button type="button" onClick={() => setShowAllProblems((value) => !value)} className="mt-1 text-sm font-semibold text-amber-950 underline">{showAllProblems ? "Show fewer" : `Show all ${blockers.length}`}</button> : null}
        {gaps.length ? <p className="mt-2 text-sm text-amber-950">To add: {gaps.join(" ")}</p> : null}
      </div> : null}

      {fixes.length && !dirty ? <div className="mt-3 rounded-xl border border-teal-300 bg-teal-50 p-3">
        <p className="font-semibold text-teal-950">The AI suggests new text</p>
        <ul className="mt-2 space-y-2">{fixes.map(([field, value]) => <li key={field} className="rounded-lg bg-white p-2 text-sm"><p className="font-medium">{POSTED[field]}{locked.has(field) ? " (kept)" : ""}</p><p className="mt-1 text-slate-900">{value}</p><button type="button" onClick={() => acceptFixes([[field, value]])} disabled={busy || props.demo} className="mt-1 text-sm font-semibold text-teal-800 underline">Use this</button></li>)}</ul>
        {fixes.length > 1 ? <button type="button" onClick={() => acceptFixes(fixes, true)} disabled={busy || props.demo} className={`mt-2 ${primary}`}>Use all{fixes.some(([field]) => locked.has(field)) ? " (not kept text)" : ""}</button> : null}
      </div> : null}

      {dirty ? <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void act("save", true)} disabled={busy || props.superseded || props.demo || props.voicePending} className={primary}>Save and check with AI</button>
        <button type="button" onClick={() => void act("save")} disabled={busy || props.superseded || props.demo} className="text-sm font-semibold text-slate-900 underline">Save without checking</button>
        <p className="w-full text-sm text-amber-800">You have unsaved changes.</p>
      </div> : null}

      {!dirty && !checksBusy && !approved && !passed ? <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void act("check")} disabled={busy || props.superseded || props.demo || props.voicePending || (checksFinished && props.review?.status !== "failed")} className={checksFinished ? secondary : primary}>{props.review?.status === "failed" ? "Try the check again" : checksFinished ? "Already checked — change the text to check again" : "Check with AI"}</button>
        {props.voicePending ? <p className="text-sm text-slate-700">Waiting for the voice note to be transcribed.</p> : null}
      </div> : null}

      {passed && !dirty && !approved ? <div className="space-y-3">
        <p className="text-sm font-semibold text-teal-900">The AI check passed. Your approval is the last step.</p>
        {substantiveWarnings.length ? <div className="text-sm text-slate-800"><p className="font-medium">Worth a look:</p><ul className="list-disc pl-5">{substantiveWarnings.map((finding, index) => <li key={`${finding.detail}-${index}`}>{readable(finding.detail)}</li>)}</ul>
          <label className="mt-2 block font-medium">How you handled these<textarea className={box} rows={2} maxLength={2000} value={resolution} onChange={(event) => setResolution(event.target.value)} /></label></div> : null}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={facts} onChange={(event) => setFacts(event.target.checked)} />The text is true to the job, and the link goes to rhipros.com.</label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={permission} onChange={(event) => setPermission(event.target.checked)} />I looked at every photo and we can use them publicly.</label>
        <button type="button" onClick={() => void act("approve")} disabled={approveDisabled} className={primary}>Approve</button>
      </div> : null}

      {approved ? <div className="space-y-2"><p className="text-sm text-teal-900">Approved {new Date(props.approvedAt as string).toLocaleString()}. Nothing is posted until you send it.</p>{!props.demo ? <Link href={`/marketing/buffer/send/${props.draftId}`} className={`inline-flex items-center ${primary}`}>Send to Buffer →</Link> : null}</div> : null}
      {message ? <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-slate-900">{message}</p> : null}
    </Step>

    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-slate-900">More: what the AI knows, voice notes, ChatGPT or Claude</summary>
      <div className="mt-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">What the AI knows (not posted)</p>
          <label className="mt-2 block text-sm">Kind of post<select className={box} value={draft.postType} disabled={busy || props.superseded} onChange={(event) => edit("postType", event.target.value as MarketingDraft["postType"])}><option value="project">A job</option><option value="company_life">Company personality / team life</option></select></label>
          <label className="mt-2 block text-sm">Job notes<textarea className={box} rows={4} maxLength={6000} value={draft.sourceNotes} disabled={busy || props.superseded} onChange={(event) => edit("sourceNotes", event.target.value)} /></label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">Town<input className={box} maxLength={100} value={draft.publicLocation} disabled={busy || props.superseded} onChange={(event) => edit("publicLocation", event.target.value)} /></label>
            <label className="block text-sm">Work performed<input className={box} maxLength={100} value={draft.service} disabled={busy || props.superseded} onChange={(event) => edit("service", event.target.value)} /></label>
          </div>
          <label className="mt-2 block text-sm">Name in your content list<input className={box} maxLength={120} value={draft.packName} disabled={busy || props.superseded} onChange={(event) => edit("packName", event.target.value)} /></label>
        </div>
        {props.audio.length || props.originalNotes ? <div>
          <p className="text-sm font-semibold text-slate-900">What Ryan sent</p>
          {props.audio.map((audio) => <div key={audio.id} className="mt-2"><audio controls className="w-full" src={`/api/marketing/review/media?draftId=${props.draftId}&audioId=${audio.id}`} />{audio.transcript ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{audio.transcript}</p> : <p className="mt-1 text-sm text-slate-500">Waiting for transcription.</p>}</div>)}
          {props.originalNotes ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{props.originalNotes}</p> : null}
        </div> : null}
        <MarketingChatHandoff draftId={props.draftId} inputHash={props.inputHash} draft={draft} originalNotes={props.originalNotes} photos={props.photos} audio={props.audio} disabled={busy || props.superseded || Boolean(props.demo)} onImport={importDraft} onPhotos={acceptPhotoIds} onEditedPhoto={addEditedPhoto} />
      </div>
    </details>
  </div>;
}
