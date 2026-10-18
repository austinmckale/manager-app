"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useState } from "react";
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

type Props = { draftId: string; jobId: string; jobName: string; originalNotes?: string; inputHash: string; initialDraft: MarketingDraft; photos: { id: string; fileName: string; url: string; description: string }[]; audio: { id: string; transcript: string; status: string }[]; review: ContentReview | null; copyFindings?: ReviewFinding[]; approvedAt: string | null; superseded: boolean; replacementDraftId?: string; voicePending: boolean; demo?: boolean };
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
function withholdsPublication(finding: { detail: string; suggestion: string; evidence?: string }) {
  const text = `${finding.detail}\n${finding.suggestion}\n${finding.evidence ?? ""}`;
  return /do not publish/i.test(text) || /\bTEST\b/i.test(text) || /not for publication/i.test(text);
}
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initialDraft);
  const reviewFindings = props.review?.result?.findings ?? [];
  const copyFindings = dirty ? copyChecks(draft) : (props.copyFindings ?? []);
  const realBlocker = (finding: { severity: string; detail: string }) => finding.severity === "blocker" && !cosmeticFinding(finding.detail);
  const blockers = distinctFindings([...reviewFindings.filter(realBlocker), ...copyFindings.filter(realBlocker)]);
  const cosmeticNotes = distinctFindings([...reviewFindings, ...copyFindings].filter((finding) => cosmeticFinding(finding.detail)));
  const gaps = plainGaps(reviewFindings.filter((finding) => !cosmeticFinding(finding.detail)));
  const warnings = reviewFindings.filter((finding) => finding.severity === "warning");
  const visibleWarnings = distinctFindings([...warnings.filter((finding) => !cosmeticFinding(finding.detail)), ...copyFindings.filter((finding) => finding.severity === "warning" && !cosmeticFinding(finding.detail))]);
  const evidenceClear = !!props.review?.evidence && !props.review.evidence.reasons.some((reason) => !cosmeticFinding(reason));
  const passed = props.review?.status === "completed" && props.review.policyVersion === 3 && evidenceClear && props.review.inputHash === props.inputHash && blockers.length === 0;
  const checksFinished = props.review?.status === "completed";
  const checksBusy = props.review?.status === "queued" || props.review?.status === "running";
  const approveDisabled = !passed || dirty || !facts || !permission || busy || props.voicePending || props.superseded || props.demo || (warnings.length > 0 && resolution.trim().length < 10);
  const checkReason = checksFinished ? "These checks already finished for this exact version. Change the notes and save a new version to run them again." : checksBusy ? "Checks are already waiting on the local worker. Use Refresh status." : dirty ? "Save the edited version before running checks." : props.voicePending ? "Waiting for voice transcription before checks." : props.superseded ? "This version was replaced. Open the newer version to run checks." : "";
  useEffect(() => {
    if (props.review?.status !== "queued" && props.review?.status !== "running") return;
    const timer = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(timer);
  }, [props.review?.status, router]);
  function edit<K extends keyof MarketingDraft>(key: K, value: MarketingDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); setSuggestion(null); setFacts(false); setPermission(false); setSaveNote(""); }
  async function act(action: "save" | "check" | "approve") {
    if (props.demo) { setMessage("Preview only. No review was queued and nothing was approved."); return; }
    if (action === "save" && !dirty) { setSaveNote("Change a note or caption first."); return; }
    setBusy(true); setMessage(""); setSaveNote("");
    try {
      const response = await fetch("/api/marketing/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, draftId: props.draftId, inputHash: props.inputHash, ...(action === "save" ? { draft } : {}), ...(action === "approve" ? { factsChecked: facts, photosCleared: permission, resolution } : {}) }) });
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
    <PostPreviews draft={{ social: suggestion?.social ?? draft.social, googleBusiness: suggestion?.googleBusiness ?? draft.googleBusiness, metaPrimary: draft.metaPrimary, metaHeadline: draft.metaHeadline, imageHeadline: draft.imageHeadline, publicLocation: draft.publicLocation, service: draft.service, landingUrl: draft.landingUrl, googleHeadlines: draft.googleHeadlines, googleDescriptions: draft.googleDescriptions }} photos={props.photos} />
    <CaptionRevisionPanel
      draftId={props.draftId}
      inputHash={props.inputHash}
      disabled={busy || props.superseded || Boolean(props.demo)}
      demo={Boolean(props.demo)}
      onPreview={setSuggestion}
      onApply={(social, googleBusiness) => { setDraft((current) => ({ ...current, social, googleBusiness })); setSuggestion(null); setFacts(false); setPermission(false); setSaveNote("Applied the suggestion. Save this version before checks or approval. Nothing is posted."); }}
    />
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Photos</h3><div className="mt-4 grid grid-cols-2 gap-3">{props.photos.map((photo) => <figure key={photo.id}><img src={photo.url} alt={photo.description || "Selected job photo"} className="aspect-square w-full rounded-xl object-cover" /></figure>)}</div>{props.audio.length ? props.audio.map((audio) => <div key={audio.id} className="mt-4"><audio controls className="w-full" src={`/api/marketing/review/media?draftId=${props.draftId}&audioId=${audio.id}`} />{audio.transcript ? <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Transcript</summary><p className="mt-2 whitespace-pre-wrap">{audio.transcript}</p></details> : <p className="mt-2 text-sm text-slate-500">Waiting for local transcription.</p>}</div>) : null}{props.originalNotes ? <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Original notes</summary><p className="mt-2 whitespace-pre-wrap">{props.originalNotes}</p></details> : null}</section>
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Descriptions</h3>
        <label className="mt-4 block text-sm font-medium">Intended post<select className={box} value={draft.postType} disabled={busy || props.superseded} onChange={(event) => edit("postType", event.target.value as MarketingDraft["postType"])}><option value="project">Job / construction update</option><option value="company_life">Company personality / team life</option></select></label>
        {([['sourceNotes', 'Corrected job notes', 6000, 4], ['publicLocation', 'Public town', 100, 1], ['social', 'Facebook / Instagram post', 2200, 6], ['googleBusiness', 'Google Business update', 1500, 5]] as const).map(([key, label, limit, rows]) => <label key={key} className="mt-4 block text-sm font-medium">{label}<textarea className={box} value={draft[key]} maxLength={limit} rows={rows} disabled={busy || props.superseded} onChange={(event) => edit(key, event.target.value)} /><span className="text-xs font-normal text-slate-500">{draft[key].length}/{limit}</span></label>)}
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Ad copy and other fields</summary>
          {([['packName', 'Pack name', 120, 1], ['service', 'Work performed', 100, 1], ['metaPrimary', 'Meta ad draft', 2200, 4], ['metaHeadline', 'Meta headline', 40, 2], ['imageHeadline', 'Graphic headline', 60, 2], ['landingUrl', 'Website destination', 500, 2]] as const).map(([key, label, limit, rows]) => <label key={key} className="mt-4 block text-sm font-medium">{label}<textarea className={box} value={draft[key]} maxLength={limit} rows={rows} disabled={busy || props.superseded} onChange={(event) => edit(key, event.target.value)} /><span className="text-xs font-normal text-slate-500">{draft[key].length}/{limit}</span></label>)}
          {(['googleHeadlines', 'googleDescriptions'] as const).map((key) => <div key={key} className="mt-4"><h4 className="text-sm font-semibold">{key === 'googleHeadlines' ? 'Google ad headlines' : 'Google ad descriptions'}</h4>{draft[key].map((value, index) => <label key={index} className="mt-2 block text-xs">{key === 'googleHeadlines' ? 'Headline' : 'Description'} {index + 1}<textarea className={box} value={value} rows={2} maxLength={key === 'googleHeadlines' ? 30 : 90} disabled={busy || props.superseded} onChange={(event) => edit(key, draft[key].map((text, position) => position === index ? event.target.value : text))} /></label>)}</div>)}
        </details>
        <button type="button" onClick={() => void act("save")} disabled={busy || props.superseded || props.demo} className="mt-4 min-h-[44px] rounded-xl border-2 border-slate-950 bg-teal-900 px-4 py-3 font-semibold text-white disabled:border-slate-800 disabled:bg-slate-200 disabled:text-slate-900 disabled:opacity-100">Save edited version</button>{saveNote ? <p className="mt-2 text-sm font-medium text-slate-950">{saveNote}</p> : null}{dirty ? <p className="mt-2 text-sm text-amber-800">Unsaved edits. Save before checks or approval.</p> : null}
      </section>
    </div>
    <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">Checks</h3><p className="mt-3 font-medium">{props.review?.status === "completed" ? blockers.length ? "Changes required" : "Ready for your judgment" : props.review?.status === "running" ? "Local reviewer is working…" : props.review?.status === "queued" ? "Waiting for your local worker" : props.review?.status === "failed" ? "Review needs retry" : "Not checked yet"}</p>{blockers.length ? <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3"><p className="font-semibold text-red-950">{blockers.some(withholdsPublication) ? "Not publishable" : "Check this before approving"}</p><ul className="mt-2 space-y-3">{blockers.map((finding, index) => <li key={`${finding.detail}-${index}`}><p className="text-sm font-medium text-red-950">{finding.detail}</p>{finding.suggestion ? <p className="mt-1 text-sm text-red-900">What to fix: {finding.suggestion}</p> : null}</li>)}</ul></div> : null}{cosmeticNotes.length ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="font-semibold">Notes from the photo check</p><p className="mt-1 text-sm text-slate-600">These do not stop the post.</p><ul className="mt-2 space-y-2 text-sm">{cosmeticNotes.map((finding, index) => <li key={`note-${finding.detail}-${index}`}>{finding.detail}</li>)}</ul></div> : null}{visibleWarnings.length ? <ul className="mt-3 space-y-2 text-sm text-slate-800">{visibleWarnings.map((finding, index) => <li key={`${finding.detail}-${index}`}><p>{finding.detail}</p>{finding.suggestion ? <p className="mt-1">What to fix: {finding.suggestion}</p> : null}</li>)}</ul> : null}{dirty ? <p className="mt-3 text-sm text-slate-800">Copy fixes are in the editor. This list still describes the last saved version until you save and run checks again.</p> : null}{checkReason ? <p className="mt-3 text-sm text-slate-800">{checkReason}</p> : null}{props.review?.error ? <p className="mt-2 text-sm text-red-700">{props.review.error}</p> : null}{gaps.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-base font-medium text-slate-950">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : props.review?.result && blockers.length === 0 ? <p className="mt-2 text-sm">{props.review.result.summary}</p> : null}<button type="button" onClick={() => { setDraft(repairCheckedCopy(draft)); setFacts(false); setPermission(false); setSaveNote("Ad lines were shortened so they are complete. The Facebook and Google Business text was only cleaned of extra spaces. Photo notes were not rewritten. Save this version, then run checks again."); }} disabled={busy || props.superseded || props.demo} className="mt-4 min-h-11 rounded-xl border-2 border-slate-900 bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:border-slate-300 disabled:text-slate-500">Fix the copy checks</button><button type="button" onClick={() => void act("check")} disabled={Boolean(checkReason) || busy || props.demo} className="mt-4 ml-3 min-h-11 rounded-xl border-2 border-slate-900 bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:border-slate-300 disabled:text-slate-500">{props.review?.status === "failed" ? "Retry local checks" : "Run AI checks"}</button><button type="button" onClick={() => router.refresh()} className="ml-3 min-h-11 text-sm font-semibold text-slate-900 underline">Refresh status</button></section>
    <MarketingChatHandoff draftId={props.draftId} inputHash={props.inputHash} draft={draft} originalNotes={props.originalNotes} photos={props.photos} audio={props.audio} disabled={busy || props.superseded || dirty} onImport={(imported) => { setDraft(imported); setFacts(false); setPermission(false); setSaveNote(""); }} />
    <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4"><h3 className="font-semibold">Approval</h3><p className="mt-2 text-sm text-slate-600">It does not publish, send email, release a client pack or start ads.</p>{props.approvedAt && !props.superseded && !dirty ? <p className="mt-3 font-semibold text-teal-900">Approved {new Date(props.approvedAt).toLocaleString()}</p> : <><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={facts} onChange={(event) => setFacts(event.target.checked)} />I checked the original evidence, corrected the facts and verified the destination link.</label><label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} />I inspected every photo and have permission to use the selected photos publicly.</label><label className="mt-4 block text-sm">How you resolved warnings / approval notes<textarea className={box} rows={3} maxLength={2000} value={resolution} onChange={(event) => setResolution(event.target.value)} /></label><button type="button" onClick={() => void act("approve")} disabled={approveDisabled} className="mt-4 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-40">Approve this version</button></>}
      {props.approvedAt && !props.superseded && !dirty && !props.demo ? <Link href={`/marketing/buffer/send/${props.draftId}`} className="ml-3 mt-4 inline-block rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white">Send to Buffer</Link> : null}
    </section>
    <p role="status" aria-live="polite" className="text-sm font-medium text-teal-900">{message}</p>
  </div>;
}
