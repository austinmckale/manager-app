/* Private signed photo links are rendered directly, without the public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DRAFT_SAVED_ACTION } from "@/lib/marketing";
import { PHOTO_RECEIVED } from "@/lib/field-intake";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { GENERATION_ACTION } from "@/lib/marketing-evidence";
import { INTAKE_PACK } from "@/lib/intake-delivery";
import { REVIEW_APPROVAL, REVIEW_SUPERSEDED } from "@/lib/content-review";
import { MarketingGenerateButton } from "@/components/marketing-generate-button";
import { MarketingJobReview } from "@/components/marketing-job-review";
import { exampleDraft, exampleJobId, examplePhotos } from "@/lib/marketing-example";
import { parseSavedPack } from "@/lib/saved-marketing";
import { buildInboxCards, type InboxCardModel } from "@/lib/marketing-inbox";
import { processingId, processingSettings } from "@/lib/marketing-processing";
import { bufferSelectionId } from "@/lib/publishing/buffer";
import { BUFFER_DELIVERY } from "@/lib/publishing/buffer-delivery";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";

export const dynamic = "force-dynamic";

const pageSize = 12;
const primaryLink = "inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-900 px-4 py-2 text-sm font-semibold text-white";
const secondaryLink = "inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-900";

type StoredPhoto = {
  id: string;
  jobId: string;
  jobName: string;
  unsorted: boolean;
  createdAt: string;
  description: string;
  tags: string[];
  onWebsite: boolean;
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  stage: "BEFORE" | "DURING" | "AFTER" | null;
  area: string | null;
  updatedAt: string;
};

function inboxQuery(input: { tests?: boolean; page?: number; jobId?: string; open?: string; hash?: string }) {
  const search = new URLSearchParams();
  if (input.tests) search.set("tests", "1");
  if (input.page && input.page > 1) search.set("page", String(input.page));
  if (input.jobId) search.set("jobId", input.jobId);
  if (input.open) search.set("open", input.open);
  const query = search.toString();
  return `/marketing${query ? `?${query}` : ""}${input.hash ?? ""}`;
}

function cardHref(card: InboxCardModel, tests: boolean, jobId: string, owner: boolean) {
  const delivery = card.status === "scheduled" || card.status === "posted" || card.statusLabel === "Draft in Buffer" || card.statusLabel === "Send failed" || card.statusLabel === "Send unconfirmed";
  if (owner && card.draftId && delivery) return `/marketing/buffer/send/${card.draftId}`;
  if ((card.action === "review") && card.draftId) return `/marketing/review/${card.draftId}`;
  return inboxQuery({ tests, jobId, open: card.id, hash: card.action === "notes" ? "#submission-notes" : "#submission-editor" });
}

function InboxCard({ card, tests, jobId, owner, thumbs }: { card: InboxCardModel; tests: boolean; jobId: string; owner: boolean; thumbs: { id: string; url: string; name: string }[] }) {
  const when = new Date(card.submittedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  return <article className="rounded-2xl border border-slate-300 bg-white p-3">
    <div className="flex gap-3">
      <div className="flex shrink-0 gap-1">{thumbs.length ? thumbs.map((thumb) => thumb.url ? <img key={thumb.id} src={thumb.url} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <div key={thumb.id} className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-center text-[10px] font-medium text-slate-800">No preview</div>) : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-center text-[10px] font-medium text-slate-800">No photo</div>}</div>
      <div className="min-w-0">
        <h3 className="font-semibold text-slate-900">{card.title}</h3>
        <p className="text-sm text-slate-800">{card.place && card.jobLabel !== card.title ? `${card.jobLabel} · ` : ""}{when} Eastern · {card.photoCount} {card.photoCount === 1 ? "photo" : "photos"}</p>
        <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-900">{card.test ? "Test upload · " : ""}{card.statusLabel}</p>
      </div>
    </div>
    <p className="mt-2 text-sm text-slate-800">{card.summary || "No note or transcript is saved."}</p>
    <p className="mt-1 text-sm text-slate-800">{card.detail}</p>
    {card.websitePhotoCount > 0 ? <p className="mt-1 text-sm text-slate-800">{card.websitePhotoCount} {card.websitePhotoCount === 1 ? "photo is" : "photos are"} on the website. That is separate from a social post.</p> : null}
    <Link href={cardHref(card, tests, jobId, owner)} className={`${primaryLink} mt-3 w-full sm:w-auto`}>{card.actionLabel}</Link>
  </article>;
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ page?: string; jobId?: string; example?: string; draftId?: string; demoDraft?: string; tests?: string; open?: string }> }) {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p className="rounded-xl bg-slate-50 p-4 text-slate-900">Photo review and marketing drafts are available to the owner and admins. <Link href="/capture" className="font-semibold text-teal-900 underline">Add job photos</Link></p>;
  const params = await searchParams;
  const demo = isDemoMode();
  if (demo) {
    return <div className="space-y-4">
      <section className="rounded-2xl border border-slate-300 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Next</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Preview inbox</h2>
        <p className="mt-2 text-sm text-slate-800">Example packs stay in this browser. Uploading and saving need the connected app database.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link href="/marketing?example=1" className={primaryLink}>Open the website photo example</Link>
          <Link href="/capture" className={secondaryLink}>Upload photos</Link>
        </div>
      </section>
      {params.example === "1" ? <MarketingJobReview key={params.demoDraft ?? "website-example"} jobId={exampleJobId} jobName="Reading patio and pavilion · website example" unsorted={false} jobs={[]} photos={examplePhotos} initialDraft={exampleDraft} demo demoDraftId={params.demoDraft} /> : null}
    </div>;
  }

  const owner = isDashboardOwnerEmail(auth.email);
  const showTests = params.tests === "1";
  const jobFilter = /^[0-9a-f-]{36}$/i.test(params.jobId ?? "") ? params.jobId! : "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const openId = params.open ?? "";
  const savedRecord = /^[0-9a-f-]{36}$/i.test(params.draftId ?? "") ? await prisma.activityLog.findFirst({ where: { id: params.draftId, orgId: auth.orgId, action: DRAFT_SAVED_ACTION }, include: { job: { select: { jobName: true } } } }) : null;
  const savedPack = savedRecord ? parseSavedPack(savedRecord) : null;
  const setupPromise = readSetup(auth.orgId);
  const recent = await prisma.fileAsset.findMany({ where: { job: { orgId: auth.orgId }, type: "PHOTO" }, include: { job: { select: { id: true, jobName: true, categoryTags: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 120 });
  const submissionIds = [...new Set(recent.flatMap((asset) => { const tag = asset.tags.find((item) => item.startsWith("submission:"))?.slice(11); return tag && /^[0-9a-f-]{36}$/i.test(tag) ? [tag] : []; }))];
  const jobIds = [...new Set(recent.map((asset) => asset.jobId))];
  const [extra, contextLogs, draftLogs] = await Promise.all([
    submissionIds.length ? prisma.fileAsset.findMany({ where: { job: { orgId: auth.orgId }, type: "PHOTO", OR: submissionIds.map((id) => ({ tags: { has: `submission:${id}` } })) }, include: { job: { select: { id: true, jobName: true, categoryTags: true } } }, take: 400 }) : [],
    prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: { in: [PHOTO_RECEIVED, AUDIO_RECEIVED, GENERATION_ACTION, INTAKE_PACK] } }, orderBy: { createdAt: "desc" }, take: 400 }),
    jobIds.length ? prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: DRAFT_SAVED_ACTION, jobId: { in: jobIds } }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
  ]);
  const photos = new Map<string, StoredPhoto>();
  for (const asset of [...recent, ...extra]) photos.set(asset.id, mapAsset(asset));
  const photoList = [...photos.values()];
  const baseLogs = [...contextLogs, ...draftLogs].map(mapLog);
  const preliminary = buildInboxCards(photoList, baseLogs);
  const draftIds = [...new Set(preliminary.flatMap((card) => card.draftId ? [card.draftId] : []))];
  const reviewLogs = draftIds.length ? await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: { in: [REVIEW_APPROVAL, REVIEW_SUPERSEDED, BUFFER_DELIVERY] }, OR: draftIds.map((id) => ({ metadata: { path: ["draftId"], equals: id } })) }, orderBy: { createdAt: "desc" }, take: 400 }) : [];
  const cards = reviewLogs.length ? buildInboxCards(photoList, [...baseLogs, ...reviewLogs.map(mapLog)]) : preliminary;
  const scoped = jobFilter ? cards.filter((card) => card.jobId === jobFilter) : cards;
  const hiddenTests = scoped.filter((card) => card.test).length;
  const listed = scoped.filter((card) => showTests || !card.test);
  const pageCards = listed.slice((page - 1) * pageSize, page * pageSize);
  const opened = cards.find((card) => card.id === openId) ?? null;
  const openedSubmissionId = opened && /^[0-9a-f-]{36}$/i.test(opened.id) ? opened.id : "";
  const loadedGenerationStatus = openedSubmissionId ? newestGenerationStatus(baseLogs, openedSubmissionId) : "";
  const next = listed[0] ?? null;
  const [setup, generationRow] = await Promise.all([
    setupPromise,
    openedSubmissionId && !loadedGenerationStatus ? prisma.activityLog.findFirst({ where: { orgId: auth.orgId, action: GENERATION_ACTION, metadata: { path: ["submissionId"], equals: openedSubmissionId } }, orderBy: { createdAt: "desc" }, select: { metadata: true } }) : null,
  ]);
  const generationSentence = generationJobSentence(loadedGenerationStatus || generationMetadataStatus(generationRow?.metadata));
  const savedAssets = savedPack ? await prisma.fileAsset.findMany({ where: { id: { in: savedPack.draft.assetIds }, job: { orgId: auth.orgId } }, include: { job: { select: { id: true, jobName: true, categoryTags: true } } } }) : [];
  for (const asset of savedAssets) photos.set(asset.id, mapAsset(asset));
  const jobs = savedPack || opened ? await prisma.job.findMany({ where: { orgId: auth.orgId }, select: { id: true, jobName: true, categoryTags: true }, orderBy: { updatedAt: "desc" }, take: 250 }) : [];
  const signIds = new Set<string>([...pageCards.flatMap((card) => card.photoIds.slice(0, 4)), ...(opened && !savedPack ? opened.photoIds : []), ...savedAssets.map((asset) => asset.id)]);
  const signKeys = [...signIds].flatMap((id) => { const photo = photos.get(id); return photo ? [photo.storageKey] : []; });
  const signed = signKeys.length ? await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").createSignedUrls(signKeys, 3600) : null;
  const signedUrls = new Map<string, string | undefined>((signed?.data ?? []).flatMap((item) => (item.path ? [[item.path, item.signedUrl ?? undefined] as const] : [])));
  const editorJobs = jobs.filter((job) => !job.categoryTags.includes("photo-dump"));
  const showProcessingBanner = Boolean(opened?.status === "processing" && (!setup?.heartbeat || setup.heartbeat.state === "error"));

  return <div className="space-y-4">
    <section className="rounded-2xl border border-slate-300 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Next</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{next ? next.actionLabel : "Nothing is waiting"}</h2>
      <p className="mt-2 text-sm text-slate-800">{next ? `${next.title}. ${next.statusLabel}.` : "New submissions will appear here."}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {next ? <Link href={cardHref(next, showTests, jobFilter, owner)} className={primaryLink}>{next.actionLabel}</Link> : <Link href="/capture" className={primaryLink}>Upload photos</Link>}
        {next ? <Link href="/capture" className={secondaryLink}>Upload photos</Link> : null}
      </div>
    </section>
    <p className="text-sm text-slate-800">{setup ? <>{setup.ai} <Link href="/marketing/delivery" className="font-semibold text-teal-950 underline">AI setup</Link>. {setup.buffer} <Link href="/marketing/buffer" className="font-semibold text-teal-950 underline">Buffer setup</Link>.</> : "AI and Buffer status could not be read."} {setup ? null : <Link href="/marketing/delivery" className="font-semibold text-teal-950 underline">AI setup</Link>}</p>
    {showProcessingBanner ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{setup?.heartbeat?.state === "error" ? "This submission is still processing, and the worker’s last stored state is error." : "This submission is still processing, and no worker check-in is stored."} <Link href="/marketing/delivery" className="font-semibold underline">Open AI setup</Link></p> : null}
    {params.draftId && !savedPack ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">This saved pack is unavailable. Open <Link href="/marketing/saved" className="font-semibold underline">Content</Link> to choose another.</p> : null}
    {savedPack ? <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-950">Reusing “{savedPack.draft.packName || savedPack.jobName}”. The saved original stays unchanged; saving creates a new version.</p> : null}
    {opened && opened.test && !showTests ? <p className="text-sm text-slate-800">This marked test upload is open. It stays out of the list until you show test uploads.</p> : null}
    {savedPack ? <MarketingJobReview jobId={savedPack.jobId} jobName={savedPack.jobName} unsorted={false} jobs={editorJobs} photos={editorPhotos(savedPack.draft.assetIds, photos, signedUrls)} initialDraft={savedPack.draft} savedPackId={savedPack.id} submittedNote={savedPack.draft.sourceNotes} /> : null}
    {!savedPack && opened ? <div className="space-y-2">{openedSubmissionId ? <div className="flex flex-wrap items-center gap-3"><MarketingGenerateButton submissionId={openedSubmissionId} hasDraft={Boolean(opened.draft)} />{generationSentence ? <p role="status" className="text-sm font-semibold text-slate-900">{generationSentence}</p> : null}</div> : null}<Link href={inboxQuery({ tests: showTests, jobId: jobFilter })} className={secondaryLink}>Close</Link><MarketingJobReview key={opened.id} jobId={opened.jobId} jobName={opened.jobName} unsorted={opened.unsorted} batchLabel={opened.title} jobs={editorJobs} photos={editorPhotos(opened.photoIds, photos, signedUrls)} initialDraft={opened.draft ?? undefined} savedPackId={opened.draftId ?? undefined} submittedNote={opened.summary} /></div> : null}
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link href={inboxQuery({ tests: !showTests, jobId: jobFilter })} className="font-semibold text-slate-900 underline">{showTests ? "Hide test uploads" : "Show test uploads"}</Link>
      {jobFilter ? <Link href={inboxQuery({ tests: showTests })} className="font-semibold text-slate-900 underline">Show every submission</Link> : null}
      {!showTests && hiddenTests > 0 ? <p className="text-slate-800">{hiddenTests} marked test {hiddenTests === 1 ? "upload is" : "uploads are"} hidden.</p> : null}
    </div>
    {pageCards.length ? <div className="space-y-3">{pageCards.map((card) => <InboxCard key={card.id} card={card} tests={showTests} jobId={jobFilter} owner={owner} thumbs={card.photoIds.slice(0, 4).map((id) => { const photo = photos.get(id); return { id, url: photo ? signedUrls.get(photo.storageKey) ?? "" : "", name: photo?.fileName ?? "Photo" }; })} />)}</div> : <section className="rounded-2xl border border-dashed border-slate-400 p-6"><h3 className="font-semibold text-slate-900">{listed.length ? "No submissions on this page." : "No submissions in this view."}</h3><p className="mt-2 text-sm text-slate-800">Uploads with a note show up here. Marked test uploads stay hidden until you ask for them.</p></section>}
    <div className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={inboxQuery({ tests: showTests, jobId: jobFilter, page: page - 1 })} className="text-slate-900 underline">Previous</Link> : <span />}{page * pageSize < listed.length ? <Link href={inboxQuery({ tests: showTests, jobId: jobFilter, page: page + 1 })} className="text-slate-900 underline">Next</Link> : null}</div>
  </div>;
}

function mapAsset(asset: { id: string; jobId: string; createdAt: Date; description: string | null; tags: string[]; isPortfolio: boolean; storageKey: string; fileName: string; mimeType: string | null; stage: "BEFORE" | "DURING" | "AFTER" | null; area: string | null; updatedAt: Date; job: { jobName: string; categoryTags: string[] } }): StoredPhoto {
  return { id: asset.id, jobId: asset.jobId, jobName: asset.job.jobName, unsorted: asset.job.categoryTags.includes("photo-dump"), createdAt: asset.createdAt.toISOString(), description: asset.description ?? "", tags: asset.tags, onWebsite: asset.isPortfolio, storageKey: asset.storageKey, fileName: asset.fileName, mimeType: asset.mimeType, stage: asset.stage, area: asset.area, updatedAt: asset.updatedAt.toISOString() };
}

function mapLog(log: { id: string; action: string; createdAt: Date; metadata: unknown }) {
  return { id: log.id, action: log.action, createdAt: log.createdAt.toISOString(), metadata: log.metadata };
}

function generationMetadataStatus(metadata: unknown) {
  const status = metadata && typeof metadata === "object" ? (metadata as { status?: unknown }).status : "";
  return status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "held" ? status : "";
}

function newestGenerationStatus(logs: { action: string; createdAt: string; metadata: unknown }[], submissionId: string) {
  let newest: { createdAt: string; status: string } | null = null;
  for (const log of logs) {
    if (log.action !== GENERATION_ACTION) continue;
    const metadata = log.metadata && typeof log.metadata === "object" ? log.metadata as { submissionId?: unknown } : null;
    const status = metadata?.submissionId === submissionId ? generationMetadataStatus(log.metadata) : "";
    if (!status || (newest && log.createdAt <= newest.createdAt)) continue;
    newest = { createdAt: log.createdAt, status };
  }
  return newest?.status ?? "";
}

function generationJobSentence(status: string) {
  if (status === "queued") return "Waiting for the local worker";
  if (status === "running") return "The local worker is writing the draft";
  if (status === "failed") return "This request stopped";
  if (status === "held") return "Add details, then queue it again";
  return "";
}

function editorPhotos(ids: string[], photos: Map<string, StoredPhoto>, urls: Map<string, string | undefined>) {
  return ids.flatMap((id) => {
    const photo = photos.get(id);
    if (!photo) return [];
    return [{ id, fileName: photo.fileName, url: urls.get(photo.storageKey) ?? "", description: photo.description, stage: photo.stage, area: photo.area, tags: photo.tags, mimeType: photo.mimeType, published: photo.onWebsite, updatedAt: photo.updatedAt }];
  });
}

async function readSetup(orgId: string) {
  try {
    const [settings, heartbeatRow, channelRow] = await Promise.all([
      processingSettings(prisma, orgId),
      prisma.activityLog.findFirst({ where: { id: processingId(orgId, "heartbeat"), orgId } }),
      prisma.activityLog.findFirst({ where: { id: bufferSelectionId(orgId), orgId } }),
    ]);
    const heartbeat = heartbeatRow?.metadata && typeof heartbeatRow.metadata === "object" ? heartbeatRow.metadata as { checkedAt?: unknown; state?: unknown } : null;
    const storedHeartbeat = heartbeat && typeof heartbeat.checkedAt === "string" && typeof heartbeat.state === "string" ? { checkedAt: heartbeat.checkedAt, state: heartbeat.state } : null;
    const channels = channelRow?.metadata && typeof channelRow.metadata === "object" && Array.isArray((channelRow.metadata as { channels?: unknown }).channels) ? (channelRow.metadata as { channels: unknown[] }).channels.length : 0;
    const automatic = settings.enabled && settings.mode !== "manual" ? "Automatic processing is on" : "Automatic processing is off";
    const ai = storedHeartbeat ? `${automatic}. Worker ${storedHeartbeat.state}, last seen ${new Date(storedHeartbeat.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern.` : `${automatic}. No worker check-in is stored.`;
    const keySet = Boolean(process.env.BUFFER_API_KEY);
    const buffer = !keySet && channels === 0 ? "Buffer is not configured." : !keySet ? `Buffer API key is not set. ${channels} saved ${channels === 1 ? "channel" : "channels"}.` : channels === 0 ? "Buffer key is set, and no channel is saved." : `Buffer key is set. ${channels} saved ${channels === 1 ? "channel" : "channels"}.`;
    return { ai, buffer, heartbeat: storedHeartbeat };
  } catch {
    return null;
  }
}
