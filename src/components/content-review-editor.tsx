"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketingDraft } from "@/lib/marketing";
import { plainGaps } from "@/lib/marketing-evidence";
import type { ContentReview, ReviewFinding } from "@/lib/content-review";
import { cosmeticFinding } from "@/lib/review-findings";
import { copyChecks } from "@/lib/copy-checks";
import { repairCheckedCopy } from "@/lib/repair-checked-copy";
import { MarketingChatHandoff } from "@/components/marketing-chat-handoff";
import { CaptionRevisionPanel } from "@/components/caption-revision-panel";
import { PostPreviews } from "@/components/post-previews/post-previews";

type Props = { lockedFields?: string[]; draftId: string; jobId: string; jobName: string; originalNotes?: string; inputHash: string; initialDraft: MarketingDraft; photos: { id: string; fileName: string; url: string; description: string }[]; audio: { id: string; transcript: string; status: string }[]; review: ContentReview | null; copyFindings?: ReviewFinding[]; approvedAt: string | null; superseded: boolean; replacementDraftId?: string; voicePending: boolean; demo?: boolean };
const box = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base";
function distinctFindings<T extends { severity: string; detail: string; suggestion: string }>(findings: T[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.severity}|${finding.detail}|${finding.suggestion}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function plainDetail(detail: string) {
  return detail.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "this photo").replace(/[ \t]{2,}/g, " ").trim();
}
function withholdsPublication(finding: { detail: string; suggestion: string; evidence?: string }) {
  const text = `${finding.detail}\n${finding.suggestion}\n${finding.evidence ?? ""}`;
  return /do not publish/i.test(text) || /\bTEST\b/i.test(text) || /not for publication/i.test(text);
}
type ReviewPhoto = Props["photos"][number];
const FIX_FIELDS = { social: "Facebook / Instagram post", googleBusiness: "Google Business update", metaPrimary: "Meta ad draft", metaHeadline: "Meta headline", imageHeadline: "Graphic headline", googleHeadlines: "Google ad headlines", googleDescriptions: "Google ad descriptions", publicLocation: "Public town", service: "Work performed" } as const;
type FixField = keyof typeof FIX_FIELDS;
const showFix = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join(" · ") : value || "(empty)");
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
const importedPhotoNote = "Imported the text and the selected photo order. Save this version before checks or approval. Nothing is posted.";
export function ContentReviewEditor(props: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(props.initialDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [facts, setFacts] = useState(false);
  const [permission, setPermission] = useState(false);
  const [resolution, setResolution] = useState("");
  const [suggestion, setSuggestion] = useState<{ social: string; googleBusiness: string } | null>(null);
  const [photos, setPhotos] = useState(props.photos);
  const [photoNotes, setPhotoNotes] = useState<Record<string, string>>({});
  // Captions the owner kept. Regenerate, "Accept all fixes" and chat imports never change them.
  const [locked, setLocked] = useState<Set<FixField>>(() => new Set((props.lockedFields ?? []).filter((field): field is FixField => field in FIX_FIELDS)));
  const [regenNote, setRegenNote] = useState("");
  const [regenStatus, setRegenStatus] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenReady, setRegenReady] = useState<{ proposal: Partial<Record<FixField, string | string[]>>; remaining: number | null } | null>(null);
  const undoDraft = useRef<MarketingDraft | null>(null);
  const regenPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const photoList = useRef(props.photos);
  // Saved photos plus edited copies added on this page; a copy joins the draft when it is saved.
  const photoCatalog = useRef(props.photos);
  function commitPhotoOrder(ids: string[]) {
    const next = photosForIds(photoCatalog.current, ids);
    if (!next.length || samePhotoIds(photoList.current, next)) return null;
    photoList.current = next;
    setPhotos(next);
    return next.map((photo) => photo.id);
  }
  function importDraft(imported: MarketingDraft) {
    const assetIds = commitPhotoOrder(imported.assetIds);
    const kept = Object.fromEntries([...locked].map((field) => [field, draft[field]]));
    setDraft(assetIds ? { ...imported, ...kept, assetIds } : { ...imported, ...kept });
    setSuggestion(null);
    setFacts(false);
    setPermission(false);
    setSaveNote(assetIds ? importedPhotoNote : "");
  }
  function acceptPhotoIds(photoIds: string[], improvements?: { id: string; note: string }[]) {
    const notes = Object.fromEntries((improvements ?? []).flatMap((item) => item.note.trim() ? [[item.id, item.note.trim()]] : []));
    setPhotoNotes(notes);
    const assetIds = commitPhotoOrder(photoIds);
    if (!assetIds) return;
    setDraft((current) => ({ ...current, assetIds }));
    setSuggestion(null);
    setFacts(false);
    setPermission(false);
    setSaveNote(importedPhotoNote);
  }
  function addEditedPhoto(replaces: string, photo: ReviewPhoto) {
    photoCatalog.current = [...photoCatalog.current.filter((item) => item.id !== photo.id), photo];
    const current = photoList.current.map((item) => item.id);
    const ids = current.includes(replaces) ? current.map((id) => (id === replaces ? photo.id : id)) : [...current, photo.id];
    const assetIds = commitPhotoOrder(ids);
    if (!assetIds) return;
    setDraft((draftNow) => ({ ...draftNow, assetIds }));
    setFacts(false);
    setPermission(false);
    setSaveNote("Edited photo added in place of the original. Save this version, then run checks. Nothing is posted.");
  }
  const visibleDraft = suggestion ? { ...draft, social: suggestion.social, googleBusiness: suggestion.googleBusiness } : draft;
  const dirty = JSON.stringify(visibleDraft) !== JSON.stringify(props.initialDraft);
  const reviewFindings = props.review?.result?.findings ?? [];
  const copyFindings = dirty ? copyChecks(visibleDraft) : (props.copyFindings ?? []);
  const realBlocker = (finding: { severity: string; detail: string }) => finding.severity === "blocker" && !cosmeticFinding(finding.detail);
  const blockers = distinctFindings([...reviewFindings.filter(realBlocker), ...copyFindings.filter(realBlocker)]);
  const cosmeticNotes = distinctFindings([...reviewFindings, ...copyFindings].filter((finding) => cosmeticFinding(finding.detail)));
  const gaps = plainGaps(reviewFindings.filter((finding) => !cosmeticFinding(finding.detail)));
  const warnings = reviewFindings.filter((finding) => finding.severity === "warning");
  const substantiveWarnings = distinctFindings(warnings.filter((finding) => !cosmeticFinding(finding.detail)));
  const adWarnings = distinctFindings(copyFindings.filter((finding) => finding.severity === "warning" && !cosmeticFinding(finding.detail)));
  const evidenceClear = !!props.review?.evidence && !props.review.evidence.reasons.some((reason) => !cosmeticFinding(reason));
  const passed = props.review?.status === "completed" && props.review.policyVersion === 3 && evidenceClear && props.review.inputHash === props.inputHash && blockers.length === 0;
  const checksFinished = props.review?.status === "completed";
  const checksBusy = props.review?.status === "queued" || props.review?.status === "running";
  const approveDisabled = !passed || dirty || !facts || !permission || busy || props.voicePending || props.superseded || props.demo || (substantiveWarnings.length > 0 && resolution.trim().length < 10);
  useEffect(() => {
    if (props.review?.status !== "queued" && props.review?.status !== "running") return;
    const timer = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(timer);
  }, [props.review?.status, router]);
  function persistLocks(next: Set<FixField>) {
    if (props.demo || props.superseded) return;
    void fetch("/api/marketing/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "locks", draftId: props.draftId, inputHash: props.inputHash, fields: [...next] }) }).catch(() => undefined);
  }
  function toggleLock(field: FixField) {
    setLocked((current) => { const next = new Set(current); if (next.has(field)) next.delete(field); else next.add(field); persistLocks(next); return next; });
  }
  const keep = (field: FixField) => {
    const on = locked.has(field);
    const flip = (event: { preventDefault: () => void }) => { event.preventDefault(); if (!props.demo && !props.superseded) toggleLock(field); };
    return <span role="switch" aria-checked={on} aria-label={`Keep ${FIX_FIELDS[field]}`} tabIndex={0} onClick={flip} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") flip(event); }} className={`ml-2 inline-flex cursor-pointer select-none items-center rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${on ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600"}`}>{on ? "✓ Kept" : "Keep"}</span>;
  };
  function edit<K extends keyof MarketingDraft>(key: K, value: MarketingDraft[K]) {
    if (key in FIX_FIELDS && !locked.has(key as FixField)) toggleLock(key as FixField);
    setDraft((current) => ({ ...current, [key]: value })); setSuggestion(null); setFacts(false); setPermission(false); setSaveNote(""); }
  const checkAllReason = props.superseded ? "This version was replaced. Open the newer version to check it." : props.voicePending ? "Waiting for voice transcription before checks." : dirty ? "" : checksBusy ? "The AI check is waiting on the local worker. Use Refresh status." : checksFinished ? "These captions were already checked. Change something or accept a fix, then check again." : "";
  const fixes = props.review?.status === "completed" && !props.superseded ? Object.entries(props.review.fixes?.copy ?? {}).filter((entry): entry is [FixField, string | string[]] => entry[0] in FIX_FIELDS && entry[1] !== undefined) : [];
  function acceptFixes(fields: [FixField, string | string[]][], skipKept = false) {
    const chosen = skipKept ? fields.filter(([field]) => !locked.has(field)) : fields;
    setDraft((current) => ({ ...current, ...Object.fromEntries(chosen) }));
    setSuggestion(null); setFacts(false); setPermission(false);
    setSaveNote("Fixes are in the editor. Press Check all captions with AI to save and check them. Nothing is posted.");
  }
  const unlockedCount = (Object.keys(FIX_FIELDS) as FixField[]).filter((field) => !locked.has(field)).length;
  function applyRegenerated(proposal: Partial<Record<FixField, string | string[]>>, remaining: number | null) {
    const fields = (Object.keys(proposal) as FixField[]).filter((field) => field in FIX_FIELDS && !locked.has(field) && proposal[field] !== undefined);
    if (!fields.length) { setRegenStatus("The AI did not return new text for the unlocked captions."); return; }
    undoDraft.current = draft;
    setDraft((current) => ({ ...current, ...Object.fromEntries(fields.map((field) => [field, proposal[field]])) }));
    setSuggestion(null); setFacts(false); setPermission(false); setRegenReady(null);
    setRegenStatus(`Rewrote ${fields.length} caption${fields.length === 1 ? "" : "s"} and kept ${locked.size}. ${remaining ? `The AI fact-check still sees ${remaining} problem${remaining === 1 ? "" : "s"}. ` : ""}Check all captions with AI saves and checks them.`);
  }
  function stopRegenPoll() { if (regenPoll.current) { clearInterval(regenPoll.current); regenPoll.current = null; } }
  function watchRegenerate(autoApply: boolean) {
    stopRegenPoll();
    let sawRunning = !autoApply;
    regenPoll.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/marketing/revise?mode=regenerate&draftId=${encodeURIComponent(props.draftId)}&inputHash=${encodeURIComponent(props.inputHash)}`, { cache: "no-store" });
        const body = await response.json();
        const latest = body?.regenerate as { status: string; proposal: Partial<Record<FixField, string | string[]>>; remaining: number | null; error: string | null } | null;
        if (!latest) return;
        if (latest.status === "queued" || latest.status === "running") { sawRunning = true; setRegenStatus("Rewriting the unlocked captions on this PC. Kept captions stay as they are."); return; }
        if (!sawRunning) return;
        stopRegenPoll(); setRegenBusy(false);
        if (latest.status === "ready") applyRegenerated(latest.proposal, latest.remaining);
        else setRegenStatus(latest.error || "The rewrite did not finish. Try again.");
      } catch { /* keep watching */ }
    }, 3000);
  }
  useEffect(() => {
    if (props.demo || props.superseded) return;
    let cancelled = false;
    void fetch(`/api/marketing/revise?mode=regenerate&draftId=${encodeURIComponent(props.draftId)}&inputHash=${encodeURIComponent(props.inputHash)}`, { cache: "no-store" }).then((response) => response.json()).then((body) => {
      const latest = body?.regenerate;
      if (cancelled || !latest) return;
      if (latest.status === "queued" || latest.status === "running") { setRegenBusy(true); setRegenStatus("Rewriting the unlocked captions on this PC."); watchRegenerate(false); }
      else if (latest.status === "ready") setRegenReady({ proposal: latest.proposal, remaining: latest.remaining });
    }).catch(() => undefined);
    return () => { cancelled = true; stopRegenPoll(); };
    // Restart only when the version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draftId, props.inputHash]);
  async function regenerate() {
    if (props.demo || props.superseded || unlockedCount === 0) return;
    setRegenBusy(true); setRegenReady(null); setRegenStatus("Sending the request…");
    try {
      const keptValues = Object.fromEntries([...locked].map((field) => [field, visibleDraft[field]]));
      const response = await fetch("/api/marketing/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: props.draftId, inputHash: props.inputHash, mode: "regenerate", locked: keptValues, note: regenNote }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Could not send the request.");
      setRegenStatus("Rewriting the unlocked captions on this PC. Kept captions stay as they are.");
      watchRegenerate(true);
    } catch (error) {
      setRegenBusy(false);
      setRegenStatus(error instanceof Error ? error.message : "Could not send the request.");
    }
  }
  function undoRegenerate() {
    if (!undoDraft.current) return;
    setDraft(undoDraft.current); undoDraft.current = null;
    setRegenStatus("Put back the captions from before the rewrite.");
  }
  async function checkAll() {
    if (dirty) await act("save", true);
    else await act("check");
  }
  async function act(action: "save" | "check" | "approve", withCheck = false) {
    if (props.demo) { setMessage("Preview only. No review was queued and nothing was approved."); return; }
    if (action === "save" && !dirty) { setSaveNote("Change a note or caption first."); return; }
    setBusy(true); setMessage(""); setSaveNote("");
    try {
      const response = await fetch("/api/marketing/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, draftId: props.draftId, inputHash: props.inputHash, ...(action === "save" ? { draft: visibleDraft, check: withCheck, lockedFields: [...locked] } : {}), ...(action === "approve" ? { factsChecked: facts, photosCleared: permission, resolution } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save. Please retry.");
      if (action === "save") router.push(`/marketing/review/${result.draftId}`);
      else { setMessage(action === "check" ? "Checks queued on your local worker. Keep the PC and Ollama running; you can leave this page." : "This exact draft version is approved. No client delivery, post or ad was sent."); router.refresh(); }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not complete this action.";
      if (action === "save") setSaveNote(text);
      setMessage(text);
    }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <header><Link href="/marketing/saved" className="text-sm text-teal-700 underline">← Drafts</Link><h2 className="mt-3 text-2xl font-semibold">Review & approve</h2><p className="mt-1 text-slate-600">{props.jobName} · {draft.packName || "Untitled pack"}</p></header>
    {props.demo ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Example workflow using website photos. Review findings below are illustrative, not a completed AI review. Saves and approvals are disabled.</p> : null}
    {props.superseded ? <p className="rounded-xl bg-amber-50 p-4">This version was replaced and cannot be approved. {props.replacementDraftId ? <Link className="underline" href={`/marketing/review/${props.replacementDraftId}`}>Open its replacement</Link> : null}</p> : null}
    <PostPreviews draft={{ social: suggestion?.social ?? draft.social, googleBusiness: suggestion?.googleBusiness ?? draft.googleBusiness, metaPrimary: draft.metaPrimary, metaHeadline: draft.metaHeadline, imageHeadline: draft.imageHeadline, publicLocation: draft.publicLocation, service: draft.service, landingUrl: draft.landingUrl, googleHeadlines: draft.googleHeadlines, googleDescriptions: draft.googleDescriptions }} photos={photos} />
    <CaptionRevisionPanel
      draftId={props.draftId}
      inputHash={props.inputHash}
      currentSocial={draft.social}
      currentGoogle={draft.googleBusiness}
      disabled={busy || props.superseded || Boolean(props.demo)}
      demo={Boolean(props.demo)}
      onPreview={setSuggestion}
      onApply={(social, googleBusiness) => { setDraft((current) => ({ ...current, social, googleBusiness })); setSuggestion(null); setFacts(false); setPermission(false); setSaveNote("Applied the suggestion. Save this version before checks or approval. Nothing is posted."); }}
    />
    {!props.demo ? <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Keep the good parts, rewrite the rest</h3><p className="mt-1 text-sm text-slate-600">Tap Keep on the captions you like. Editing a caption keeps it too. Regenerate rewrites only the others, fact-checks them, and never changes a kept caption. Nothing is posted.</p>
      <label className="mt-3 block text-sm font-medium">Note for the rewrite (optional)<input value={regenNote} maxLength={300} onChange={(event) => setRegenNote(event.target.value)} placeholder="For example: shorter, or mention the epoxy floor" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void regenerate()} disabled={busy || regenBusy || props.superseded || unlockedCount === 0} className="min-h-11 rounded-xl bg-teal-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{regenBusy ? "Rewriting…" : unlockedCount === 0 ? "Every caption is kept" : `Regenerate ${unlockedCount} unlocked caption${unlockedCount === 1 ? "" : "s"}`}</button>{undoDraft.current ? <button type="button" onClick={undoRegenerate} className="min-h-11 text-sm font-semibold text-slate-900 underline">Undo the rewrite</button> : null}{regenReady ? <button type="button" onClick={() => applyRegenerated(regenReady.proposal, regenReady.remaining)} className="min-h-11 rounded-xl border-2 border-teal-900 px-4 py-3 text-sm font-semibold text-teal-900">Use the last rewrite</button> : null}</div>
      {regenStatus ? <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-slate-900">{regenStatus}</p> : null}
      {!props.review?.evidence ? <p className="mt-2 text-xs text-slate-500">Regenerate uses what the last AI check saw in the photos. If this draft has never been checked, press Check all captions with AI first.</p> : null}
    </section> : null}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Photos</h3><div className="mt-4 grid grid-cols-2 gap-3">{photos.map((photo) => <figure key={photo.id}><img src={photo.url} alt={photo.description || "Selected job photo"} className="aspect-square w-full rounded-xl object-cover" />{photoNotes[photo.id] ? <figcaption className="mt-1 text-xs text-slate-700">Improve: {photoNotes[photo.id]}</figcaption> : null}</figure>)}</div>{props.audio.length ? props.audio.map((audio) => <div key={audio.id} className="mt-4"><audio controls className="w-full" src={`/api/marketing/review/media?draftId=${props.draftId}&audioId=${audio.id}`} />{audio.transcript ? <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Transcript</summary><p className="mt-2 whitespace-pre-wrap">{audio.transcript}</p></details> : <p className="mt-2 text-sm text-slate-500">Waiting for local transcription.</p>}</div>) : null}{props.originalNotes ? <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Original notes</summary><p className="mt-2 whitespace-pre-wrap">{props.originalNotes}</p></details> : null}</section>
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Descriptions</h3>
        <label className="mt-4 block text-sm font-medium">Intended post<select className={box} value={draft.postType} disabled={busy || props.superseded} onChange={(event) => edit("postType", event.target.value as MarketingDraft["postType"])}><option value="project">Job / construction update</option><option value="company_life">Company personality / team life</option></select></label>
        {([['sourceNotes', 'Corrected job notes', 6000, 4], ['publicLocation', 'Public town', 100, 1]] as const).map(([key, label, limit, rows]) => <label key={key} className="mt-4 block text-sm font-medium">{label}{key in FIX_FIELDS ? keep(key as FixField) : null}<textarea className={box} value={draft[key]} maxLength={limit} rows={rows} disabled={busy || props.superseded} onChange={(event) => edit(key, event.target.value)} /><span className="text-xs font-normal text-slate-500">{draft[key].length}/{limit}</span></label>)}
        <label className="mt-4 block text-sm font-medium">Facebook / Instagram post{keep("social")}<textarea className={box} value={suggestion?.social ?? draft.social} maxLength={2200} rows={6} disabled={busy || props.superseded} onChange={(event) => edit("social", event.target.value)} /><span className="text-xs font-normal text-slate-500">{(suggestion?.social ?? draft.social).length}/2200</span></label>
        <label className="mt-4 block text-sm font-medium">Google Business update{keep("googleBusiness")}<textarea className={box} value={suggestion?.googleBusiness ?? draft.googleBusiness} maxLength={1500} rows={5} disabled={busy || props.superseded} onChange={(event) => edit("googleBusiness", event.target.value)} /><span className="text-xs font-normal text-slate-500">{(suggestion?.googleBusiness ?? draft.googleBusiness).length}/1500</span></label>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Ad copy and other fields</summary>
          {([['packName', 'Pack name', 120, 1], ['service', 'Work performed', 100, 1], ['metaPrimary', 'Meta ad draft', 2200, 4], ['metaHeadline', 'Meta headline', 40, 2], ['imageHeadline', 'Graphic headline', 60, 2], ['landingUrl', 'Website destination', 500, 2]] as const).map(([key, label, limit, rows]) => <label key={key} className="mt-4 block text-sm font-medium">{label}{key in FIX_FIELDS ? keep(key as FixField) : null}<textarea className={box} value={draft[key]} maxLength={limit} rows={rows} disabled={busy || props.superseded} onChange={(event) => edit(key, event.target.value)} /><span className="text-xs font-normal text-slate-500">{draft[key].length}/{limit}</span></label>)}
          {(['googleHeadlines', 'googleDescriptions'] as const).map((key) => <div key={key} className="mt-4"><h4 className="text-sm font-semibold">{key === 'googleHeadlines' ? 'Google ad headlines' : 'Google ad descriptions'}{keep(key)}</h4>{draft[key].map((value, index) => <label key={index} className="mt-2 block text-xs">{key === 'googleHeadlines' ? 'Headline' : 'Description'} {index + 1}<textarea className={box} value={value} rows={2} maxLength={key === 'googleHeadlines' ? 30 : 90} disabled={busy || props.superseded} onChange={(event) => edit(key, draft[key].map((text, position) => position === index ? event.target.value : text))} /></label>)}</div>)}
        </details>
        <button type="button" onClick={() => void act("save")} disabled={busy || props.superseded || props.demo} className="mt-4 min-h-[44px] rounded-xl border-2 border-slate-950 bg-teal-900 px-4 py-3 font-semibold text-white disabled:border-slate-800 disabled:bg-slate-200 disabled:text-slate-900 disabled:opacity-100">Save edited version</button>{saveNote ? <p className="mt-2 text-sm font-medium text-slate-950">{saveNote}</p> : null}{dirty ? <p className="mt-2 text-sm text-amber-800">Unsaved edits. Save before checks or approval.</p> : null}
      </section>
    </div>
    <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Checks</h3><p className="mt-3 font-medium">{props.review?.status === "completed" ? blockers.length ? "Changes required" : "Ready for your judgment" : props.review?.status === "running" ? "Local reviewer is working…" : props.review?.status === "queued" ? "Waiting for your local worker" : props.review?.status === "failed" ? "Review needs retry" : "Not checked yet"}</p>{blockers.length ? <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3"><p className="font-semibold text-red-950">{blockers.some(withholdsPublication) ? "Not publishable" : "Check this before approving"}</p><ul className="mt-2 space-y-3">{blockers.map((finding, index) => <li key={`${finding.detail}-${index}`}><p className="text-sm font-medium text-red-950">{finding.detail}</p>{finding.suggestion ? <p className="mt-1 text-sm text-red-900">What to fix: {finding.suggestion}</p> : null}</li>)}</ul></div> : null}{substantiveWarnings.length ? <ul className="mt-3 space-y-2 text-sm text-slate-800">{substantiveWarnings.map((finding, index) => <li key={`${finding.detail}-${index}`}><p>{plainDetail(finding.detail)}</p>{finding.suggestion ? <p className="mt-1">What to fix: {finding.suggestion}</p> : null}</li>)}</ul> : null}{adWarnings.length ? <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer font-medium">Ad line notes ({adWarnings.length})</summary><ul className="mt-2 space-y-2">{adWarnings.map((finding, index) => <li key={`ad-${finding.detail}-${index}`}>{plainDetail(finding.detail)}</li>)}</ul></details> : null}{cosmeticNotes.length ? <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer font-medium">Photo notes ({cosmeticNotes.length})</summary><p className="mt-1 text-slate-600">These do not stop the post.</p><ul className="mt-2 space-y-2">{cosmeticNotes.map((finding, index) => <li key={`note-${finding.detail}-${index}`}>{plainDetail(finding.detail)}</li>)}</ul></details> : null}{fixes.length && !dirty ? <div className="mt-3 rounded-xl border border-teal-300 bg-teal-50 p-3"><p className="font-semibold text-teal-950">AI suggested fixes for {fixes.length} caption{fixes.length === 1 ? "" : "s"}</p><p className="mt-1 text-sm text-teal-950">{props.review?.fixes?.remaining ? `These fix most of the problems; ${props.review.fixes.remaining} still need your judgment.` : "These passed the AI fact-check."} Accepting puts them in the editor; nothing is posted.</p><ul className="mt-2 space-y-3">{fixes.map(([field, value]) => <li key={field} className="rounded-lg bg-white p-2 text-sm"><p className="font-medium">{FIX_FIELDS[field]}</p><p className="mt-1 text-slate-500 line-through">{showFix(draft[field])}</p><p className="mt-1 text-slate-900">{showFix(value)}</p><button type="button" onClick={() => acceptFixes([[field, value]])} disabled={busy || props.demo} className="mt-2 text-sm font-semibold text-teal-800 underline">Accept</button></li>)}</ul><button type="button" onClick={() => acceptFixes(fixes, true)} disabled={busy || props.demo} className="mt-3 min-h-11 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white">{fixes.some(([field]) => locked.has(field)) ? "Accept all fixes except kept captions" : "Accept all fixes"}</button></div> : null}{dirty ? <p className="mt-3 text-sm text-slate-800">Copy fixes are in the editor. This list still describes the last saved version until you save and run checks again.</p> : null}{checkAllReason ? <p className="mt-3 text-sm text-slate-800">{checkAllReason}</p> : null}{props.review?.error ? <p className="mt-2 text-sm text-red-700">{props.review.error}</p> : null}{gaps.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-base font-medium text-slate-950">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : props.review?.result && blockers.length === 0 ? <p className="mt-2 text-sm">{props.review.result.summary}</p> : null}<button type="button" onClick={() => { setDraft(repairCheckedCopy(visibleDraft)); setSuggestion(null); setFacts(false); setPermission(false); setSaveNote("Ad lines were shortened so they are complete. The Facebook and Google Business text was only cleaned of extra spaces. Photo notes were not rewritten. Save this version, then run checks again."); }} disabled={busy || props.superseded || props.demo} className="mt-4 min-h-11 rounded-xl border-2 border-slate-900 bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:border-slate-300 disabled:text-slate-500">Fix the copy checks</button><button type="button" onClick={() => void checkAll()} disabled={Boolean(checkAllReason) || busy || props.demo} className="mt-4 ml-3 min-h-11 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{props.review?.status === "failed" && !dirty ? "Retry the AI check" : "Check all captions with AI"}</button><button type="button" onClick={() => router.refresh()} className="ml-3 min-h-11 text-sm font-semibold text-slate-900 underline">Refresh status</button></section>
    <MarketingChatHandoff draftId={props.draftId} inputHash={props.inputHash} draft={visibleDraft} originalNotes={props.originalNotes} photos={props.photos} audio={props.audio} disabled={busy || props.superseded || Boolean(props.demo)} onImport={importDraft} onPhotos={acceptPhotoIds} onEditedPhoto={addEditedPhoto} />
    <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4"><h3 className="font-semibold">Approval</h3><p className="mt-2 text-sm text-slate-600">It does not publish, send email, release a client pack or start ads.</p>{props.approvedAt && !props.superseded && !dirty ? <p className="mt-3 font-semibold text-teal-900">Approved {new Date(props.approvedAt).toLocaleString()}</p> : <><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={facts} onChange={(event) => setFacts(event.target.checked)} />I checked the original evidence, corrected the facts and verified the destination link.</label><label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} />I inspected every photo and have permission to use the selected photos publicly.</label><label className="mt-4 block text-sm">How you resolved warnings / approval notes<textarea className={box} rows={3} maxLength={2000} value={resolution} onChange={(event) => setResolution(event.target.value)} /></label><button type="button" onClick={() => void act("approve")} disabled={approveDisabled} className="mt-4 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-40">Approve this version</button></>}
      {props.approvedAt && !props.superseded && !dirty && !props.demo ? <Link href={`/marketing/buffer/send/${props.draftId}`} className="ml-3 mt-4 inline-block rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white">Send to Buffer</Link> : null}
    </section>
    <p role="status" aria-live="polite" className="text-sm font-medium text-teal-900">{message}</p>
  </div>;
}
