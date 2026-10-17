"use client";
/* Private signed photo links are rendered directly, without the public image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { readDemoPacks, saveDemoPack } from "@/lib/saved-marketing";
import { ARCHIVED_PHOTO_TAG, canPublishPhoto, marketingDraftSchema, prepareMarketingDraft, type MarketingDraft } from "@/lib/marketing";
import { campaignUrl, downloadBlob, exportMarketingPack } from "@/lib/client/marketing-export";

type Photo = { id: string; fileName: string; url: string; description: string; stage: "BEFORE" | "DURING" | "AFTER" | null; area: string | null; tags: string[]; mimeType: string | null; published: boolean; updatedAt: string };
type Props = { jobId: string; jobName: string; unsorted: boolean; photos: Photo[]; jobs: { id: string; jobName: string }[]; initialDraft?: MarketingDraft; demo?: boolean; demoDraftId?: string; savedPackId?: string; batchLabel?: string; submittedNote?: string };

async function mutate(body: object) {
  const response = await fetch("/api/marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Sign in again, then retry. Your text is still on this screen.");
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error([result.error || "The action did not complete.", result.completed ? `${result.completed} photos completed.` : "", result.warning].filter(Boolean).join(" "));
  return result;
}

function PhotoDetails({ photo, onSaved }: { photo: Photo; onSaved: () => void }) {
  const [description, setDescription] = useState(photo.description);
  const [stage, setStage] = useState(photo.stage ?? "DURING");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="mt-2 text-xs"><summary className="cursor-pointer py-1 font-semibold text-teal-900">Edit note & stage</summary>
    <label className="mt-2 block text-slate-900">Photo description<textarea value={description} maxLength={3000} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900" rows={3} disabled={photo.published} /></label>
    <label className="mt-2 block text-slate-900">Stage<select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900" disabled={photo.published}><option value="BEFORE">Before</option><option value="DURING">In progress</option><option value="AFTER">Finished work</option></select></label>
    {photo.published ? <p className="mt-1 text-slate-700">Remove from the website before editing.</p> : <button type="button" disabled={busy} className="mt-2 min-h-11 rounded-lg border-2 border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:border-slate-300 disabled:text-slate-600" onClick={async () => { setBusy(true); try { await mutate({ action: "updatePhoto", assetIds: [photo.id], description, stage }); setMessage("Saved."); onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); } }}>Save photo details</button>}
    <p role="status" className="mt-1 text-slate-900">{message}</p>
  </details>;
}

export function MarketingJobReview({ jobId, jobName, unsorted, photos, jobs, initialDraft, demo = false, demoDraftId, savedPackId, batchLabel, submittedNote = "" }: Props) {
  const router = useRouter();
  const usableDraft = initialDraft;
  const [selected, setSelected] = useState<string[]>(usableDraft?.assetIds.filter((id) => photos.some((photo) => photo.id === id)) ?? []);
  const [draft, setDraft] = useState<MarketingDraft>(usableDraft ?? prepareMarketingDraft({ assetIds: [], notes: [] }));
  const [editorOpen, setEditorOpen] = useState(Boolean(usableDraft));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [publicUse, setPublicUse] = useState(false);
  const [targetJob, setTargetJob] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState(savedPackId ?? "");
  useEffect(() => {
    if (!demo || !demoDraftId) return;
    void Promise.resolve().then(() => {
      const stored = readDemoPacks().find((pack) => pack.id === demoDraftId && pack.jobId === jobId);
      if (!stored) { setMessage("This preview pack is unavailable on this device. The website example is shown instead."); return; }
      setDraft(stored.draft);
      setSelected(stored.draft.assetIds.filter((id) => photos.some((photo) => photo.id === id)));
      setEditorOpen(true);
      setSavedId(stored.id);
      setDirty(false);
    });
  }, [demo, demoDraftId, jobId, photos]);
  useEffect(() => {
    if (!dirty || !editorOpen) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const warnOnLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (anchor && anchor.target !== "_blank" && anchor.href !== window.location.href && !confirm("Your drafts have unsaved changes. Leave this page?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnOnLink, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", warnOnLink, true); };
  }, [dirty, editorOpen]);
  const chosen = photos.filter((photo) => selected.includes(photo.id));
  const activeIds = chosen.map((photo) => photo.id);
  const ready = chosen.length > 0;
  const button = "inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-600";
  const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-700";
  const validDraft = () => {
    const parsed = marketingDraftSchema.safeParse({ ...draft, assetIds: activeIds });
    if (!parsed.success) throw new Error("Select photos and check the text lengths and https website link.");
    return parsed.data;
  };
  async function run(action: () => Promise<string>, refresh = true) {
    setBusy(true); setMessage("");
    try { setMessage(await action()); } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); if (refresh) router.refresh(); }
  }
  function edit<K extends keyof MarketingDraft>(key: K, value: MarketingDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); setDirty(true); }
  const field = (label: string, key: "social" | "googleBusiness" | "metaPrimary" | "metaHeadline" | "imageHeadline" | "landingUrl" | "packName" | "sourceNotes" | "publicLocation" | "service", max: number, rows = 3) => <label className="block text-sm font-medium text-slate-900">{label}<textarea value={draft[key]} maxLength={max} onChange={(e) => edit(key, e.target.value)} rows={rows} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900" /><span className="block text-right text-xs text-slate-700">{draft[key].length}/{max}</span></label>;
  function fillTemplate() {
    if (!editorOpen || !dirty || confirm("Replace the current text with new starting drafts from your saved inputs?")) {
      setDraft(prepareMarketingDraft({ assetIds: activeIds, notes: editorOpen && draft.sourceNotes ? [draft.sourceNotes] : chosen.map((photo) => photo.description), area: draft.service || chosen[0]?.area, location: draft.publicLocation, packName: draft.packName || jobName, photoNotes: chosen.map((photo) => ({ assetId: photo.id, description: photo.description, area: photo.area, stage: photo.stage })) }));
      setEditorOpen(true);
      setDirty(true);
    }
  }

  return <section id="submission-editor" className="rounded-2xl border border-slate-300 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-lg font-semibold text-slate-900">{batchLabel ?? (unsorted ? "Unsorted photos" : jobName)}</h3><p className="mt-1 text-sm text-slate-800">{chosen.length} selected. Choose the photos for this caption.</p></div><button type="button" className={button} disabled={busy} onClick={() => { setSelected(chosen.length === photos.length ? [] : photos.map((photo) => photo.id)); setDirty(true); }}>{chosen.length === photos.length ? "Clear selection" : "Select all"}</button></div>
    {submittedNote ? <p id="submission-notes" className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{submittedNote}</p> : <p id="submission-notes" className="mt-3 text-sm text-slate-800">No note or transcript is saved with these photos.</p>}
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo) => <article key={photo.id} className={`min-w-0 rounded-xl border p-2 ${selected.includes(photo.id) ? "border-teal-800 bg-teal-50" : "border-slate-300"}`}>
        <label className="block cursor-pointer"><span className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-900"><input type="checkbox" checked={selected.includes(photo.id)} disabled={busy} onChange={() => { setSelected((ids) => ids.includes(photo.id) ? ids.filter((id) => id !== photo.id) : [...ids, photo.id]); setDirty(true); }} /><span>{photo.published ? "On the website" : photo.tags.includes(ARCHIVED_PHOTO_TAG) ? "Archived" : "Not on the website"}</span></span>
          {photo.url && /^image\/(jpeg|png|webp|gif|avif)$/.test(photo.mimeType ?? "") ? <img src={photo.url} alt={photo.description || "Job photo"} className="aspect-square w-full rounded-lg object-cover" /> : <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-2 text-center text-xs text-slate-800">{photo.url ? "Preview unavailable. Convert to JPG before website use." : "Photo link unavailable. Refresh to retry."}</div>}
        </label>
        <p className="mt-2 truncate text-xs text-slate-800" title={photo.fileName}>{photo.fileName}</p><p className="text-xs text-slate-800">{photo.stage === "AFTER" ? "Finished work" : photo.stage === "BEFORE" ? "Before" : photo.stage === "DURING" ? "In progress" : "Stage needs review"}{photo.tags.includes("analysis:local-ai") ? " · AI suggestion" : ""}</p>
        <PhotoDetails key={photo.updatedAt} photo={photo} onSaved={() => router.refresh()} />
      </article>)}
    </div>
    {editorOpen ? <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">
      <div><h4 className="font-semibold text-slate-900">Facebook and Google Business</h4><p className="mt-1 text-sm text-slate-800">Saving a caption does not approve it or publish it. A photo on the website is not a social post.</p></div>
      {draft.assetIds.some((id) => !photos.some((photo) => photo.id === id)) ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Some original photos are unavailable in this view or have moved. Your saved text remains available. Select the available photos for a new pack, or download the text backup.</p> : null}
      <div className="grid gap-4 md:grid-cols-2">{field("Facebook / Instagram caption", "social", 2200)}{field("Google Business Profile update", "googleBusiness", 1500)}</div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready || busy} className={primary} onClick={() => run(async () => {
          const current = validDraft();
          if (demo) {
            const id = crypto.randomUUID();
            saveDemoPack({ id, jobId, jobName, createdAt: new Date().toISOString(), draft: current });
            setSavedId(id);
          } else {
            const result = await mutate({ action: "saveDraft", jobId, draft: current });
            setSavedId(result.draftId ?? "");
          }
          setDirty(false);
          return demo ? "Reusable pack saved in this browser on this device. Open Content to reuse it." : "Reusable pack saved. Original inputs and this version are kept in Content.";
        }, false)}>{savedId ? "Save new version" : "Save reusable pack"}</button>
        {savedId && !demo ? <Link href={`/marketing/review/${savedId}`} className={button}>Review & approve this version</Link> : null}
      </div>
      <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Project inputs</summary><div className="mt-3 space-y-3">{field("Pack name (for your library)", "packName", 120, 1)}<div className="grid gap-3 md:grid-cols-2">{field("Public town or region", "publicLocation", 100, 1)}{field("Service or type of work", "service", 100, 1)}</div>{field("Original job notes / dictated description", "sourceNotes", 6000, 4)}<p className="text-sm text-slate-800">These inputs and the original photo notes are saved with your pack. Use a town or region here; leave customer addresses out of public copy.</p></div></details>
      <details className="rounded-xl border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Ad drafts</summary><div className="mt-3 space-y-3">{field("Website link for these posts and ads", "landingUrl", 500, 1)}{field("Facebook / Instagram ad text", "metaPrimary", 2200)}{field("Facebook / Instagram ad headline", "metaHeadline", 40, 2)}{field("Headline on exported graphics", "imageHeadline", 60, 2)}<div className="grid gap-3 md:grid-cols-2"><div className="space-y-2">{draft.googleHeadlines.map((headline, index) => <label key={index} className="block text-xs font-medium text-slate-900">Headline {index + 1} · {headline.length}/30<input value={headline} maxLength={30} onChange={(e) => edit("googleHeadlines", draft.googleHeadlines.map((value, i) => i === index ? e.target.value : value))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900" /></label>)}</div><div className="space-y-2">{draft.googleDescriptions.map((description, index) => <label key={index} className="block text-xs font-medium text-slate-900">Description {index + 1} · {description.length}/90<textarea value={description} maxLength={90} onChange={(e) => edit("googleDescriptions", draft.googleDescriptions.map((value, i) => i === index ? e.target.value : value))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900" rows={2} /></label>)}</div></div></div></details>
      <details className="rounded-xl border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Export and copy</summary><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!ready || busy || chosen.some((photo) => !photo.url)} className={button} onClick={() => run(async () => { await exportMarketingPack(validDraft(), chosen, jobId); return "Marketing pack downloaded: posts, ads, tracked links, photos and graphics where supported."; }, false)}>Download marketing pack</button><button type="button" disabled={busy} className={button} onClick={() => run(async () => { downloadBlob(new Blob([JSON.stringify(ready ? validDraft() : draft, null, 2)], { type: "application/json" }), "rhi-drafts.json"); return "Draft backup downloaded."; }, false)}>Download text backup</button><Link href="/marketing/saved" className={button}>Open content library</Link></div><div className="mt-3 flex flex-wrap gap-2">{([ ["Copy Facebook / Instagram", "social", "facebook"], ["Copy Google Business Profile", "googleBusiness", "google_business_profile"], ["Copy Meta ad", "metaPrimary", "meta_ads"] ] as const).map(([label, key, source]) => <button type="button" key={key} disabled={busy || !ready} className={button} onClick={() => run(async () => { const current = validDraft(); await navigator.clipboard.writeText(`${current[key]}${key === "metaPrimary" ? `\n\nHeadline: ${current.metaHeadline}` : ""}\n\n${campaignUrl(current.landingUrl, source, `job-${jobId}`)}`); return "Copied."; }, false)}>{label}</button>)}</div><p className="mt-3 text-sm text-slate-800">Exported graphics use the first selected photo in square, portrait and landscape formats. No ads launch or spend money from this screen.</p></details>
      <p className="text-sm text-slate-800">{dirty ? "Unsaved changes. Save or download your drafts before leaving." : savedId || (!demo && usableDraft) ? "Saved version loaded. Save new edits as another version." : "Save this pack to keep your inputs for reuse."}</p>
    </div> : <p className="mt-4 text-sm text-slate-800">No saved caption is open. The template below copies saved notes into the caption boxes. It does not inspect photos or run AI.</p>}
    <details className="mt-4 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Starting text template</summary><p className="mt-2 text-sm text-slate-800">This fills the caption boxes from saved notes. It does not inspect photos or run AI.</p><button type="button" disabled={!ready || busy} className={`${button} mt-3`} onClick={fillTemplate}>{editorOpen ? "Reset starting text" : "Create starting text from notes"}</button></details>
    <details className="mt-3 rounded-xl border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">File assignment</summary><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!ready || busy || chosen.some((photo) => photo.published)} className={button} onClick={() => run(async () => { await mutate({ action: "archive", assetIds: activeIds }); return "Archived. Originals remain in the job."; })}>Archive</button>{chosen.some((photo) => photo.tags.includes(ARCHIVED_PHOTO_TAG)) ? <button type="button" disabled={busy} className={button} onClick={() => run(async () => { await mutate({ action: "restore", assetIds: activeIds }); return "Restored to the review queue."; })}>Restore</button> : null}</div><div className="mt-3 flex flex-wrap gap-2"><select aria-label="Destination job" value={targetJob} onChange={(e) => setTargetJob(e.target.value)} className="min-h-11 min-w-0 max-w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"><option value="">Choose job…</option>{jobs.filter((job) => job.id !== jobId).map((job) => <option key={job.id} value={job.id}>{job.jobName}</option>)}</select><button type="button" disabled={!ready || !targetJob || busy || chosen.some((photo) => photo.published)} className={button} onClick={() => run(async () => { await mutate({ action: "assign", assetIds: activeIds, jobId: targetJob }); return "Photos assigned to the job."; })}>Move selected photos</button></div></details>
    <details className="mt-3 rounded-xl border border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Website photo feed</summary>
      <p className="mt-2 text-sm text-slate-800">This puts finished photos on the website Projects feed. It does not publish a social post. Homepage features and curated galleries keep their existing placement rules.</p>
      <label className="mt-3 flex items-start gap-2 text-sm text-slate-900"><input type="checkbox" checked={publicUse} onChange={(e) => setPublicUse(e.target.checked)} /><span>I have permission to publish these photos and have checked for personal details in the photos and descriptions.</span></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primary} disabled={!ready || !publicUse || unsorted || busy || chosen.some((photo) => !canPublishPhoto(photo))} onClick={() => run(async () => { const result = await mutate({ action: "publish", assetIds: activeIds, clearedForPublicUse: true }); return `${result.completed} photo(s) published to the website feed. ${result.warning || ""}`; })}>Publish to website</button><button type="button" className={button} disabled={!ready || busy} onClick={() => run(async () => { const result = await mutate({ action: "unpublish", assetIds: activeIds }); return `Removed from the website feed. ${result.warning || ""}`; })}>Remove from website</button></div>
      {ready && (unsorted || chosen.some((photo) => !canPublishPhoto(photo))) ? <p className="mt-2 text-sm text-amber-950">Assign photos to a job, set their stage to Finished work, and use JPG, PNG or WebP before publishing. Restore archived photos first.</p> : null}
    </details>
    <p role="status" aria-live="polite" className="mt-3 whitespace-pre-wrap text-sm font-semibold text-teal-950">{busy ? "Working…" : message}</p>
  </section>;
}
