import type { PrismaClient } from "@prisma/client";
import { CAPTION_REVISION_ACTION, PICK_INSTRUCTION, captionRevisionId, captionRevisionSchema } from "@/lib/caption-revision";
import { REVIEW_POLICY_VERSION, REVIEW_SUPERSEDED, canApproveContent, needsResolutionNote, postedCopyChecks, type ContentReview, type ReviewFinding } from "@/lib/content-review";
import { DRAFT_SAVED_ACTION } from "@/lib/marketing";
import { draftPublishability } from "@/lib/publishability";
import { BUFFER_DELIVERY } from "@/lib/publishing/buffer-delivery";
import { cosmeticFinding } from "@/lib/review-findings";
import { PICK_RECENT_DAYS, PICK_SKIP_DAYS } from "@/lib/post-picks-rules";

/**
 * Pick posts: every marketing pack that is ready, or being made ready, to post. "Fill my picks" turns
 * the website's past jobs into packs and has this PC rewrite and check each one; Ryan's new uploads
 * arrive already written and checked. Picking one is the owner's approval: nothing is approved or
 * sent without it, and a job sent to Buffer in the last 90 days is not offered again.
 * Database helpers load lazily so the rules here can be tested without a database.
 */
export const PICK_SKIPPED = "marketing.pick.skipped";
// PAST_JOBS_TAG in past-jobs.ts, which opens storage when it loads.
const PAST_JOB_TAG = "website-project";
const DAY = 24 * 60 * 60 * 1000;
const testDraft = /\bTEST\s*[—:-]/i;

type Row = { metadata: unknown };
type DeliveryRow = { createdAt: Date; metadata: unknown };

/** Links between versions, from the "replaced by" record each save writes. */
export function versionLinks(rows: readonly Row[]) {
  const next = new Map<string, string>();
  const previous = new Map<string, string>();
  for (const row of rows) {
    const meta = row.metadata as { draftId?: unknown; replacementDraftId?: unknown } | null;
    if (typeof meta?.draftId !== "string" || typeof meta.replacementDraftId !== "string") continue;
    next.set(meta.draftId, meta.replacementDraftId);
    previous.set(meta.replacementDraftId, meta.draftId);
  }
  return { next, previous };
}

/** Every version of the post a draft belongs to, oldest first. */
export function chainOf(draftId: string, links: ReturnType<typeof versionLinks>) {
  let root = draftId;
  for (let step = 0; step < 100 && links.previous.has(root); step++) root = links.previous.get(root)!;
  const ids = [root];
  for (let step = 0; step < 100 && links.next.has(ids[ids.length - 1]); step++) ids.push(links.next.get(ids[ids.length - 1])!);
  return ids;
}

/** The newest delivery of any of these versions that may have reached Buffer. Rows come newest first. */
export function lastDelivery(versionIds: readonly string[], rows: readonly DeliveryRow[]) {
  const ids = new Set(versionIds);
  for (const row of rows) {
    const meta = row.metadata as { draftId?: unknown; status?: unknown; channelName?: unknown } | null;
    if (typeof meta?.draftId === "string" && ids.has(meta.draftId) && meta.status !== "rejected") return { at: row.createdAt, channelName: typeof meta.channelName === "string" ? meta.channelName : "Buffer" };
  }
  return null;
}

/** Posts the owner skipped, by their first version, while the skip lasts. */
export function skippedRoots(rows: readonly Row[], now: Date) {
  return new Set(rows.flatMap((row) => {
    const meta = row.metadata as { rootId?: unknown; until?: unknown } | null;
    return typeof meta?.rootId === "string" && typeof meta.until === "string" && new Date(meta.until).getTime() > now.getTime() ? [meta.rootId] : [];
  }));
}

export type PickStatus = "ready" | "look" | "approved" | "preparing" | "checking" | "unchecked" | "failed" | "blocked";

/** Where a post stands: being prepared on this PC, waiting for its check, ready, or needing the owner. */
export function pickStatus(input: { preparing: boolean; review: ContentReview | null; inputHash: string; approvedAt: string | null; voicePending: boolean; copyBlocked: boolean }): PickStatus {
  if (input.preparing) return "preparing";
  if (input.approvedAt) return "approved";
  const review = input.review;
  if (!review || review.inputHash !== input.inputHash) return "unchecked";
  if (review.status === "queued" || review.status === "running") return "checking";
  if (review.status === "failed") return "failed";
  if (review.policyVersion !== REVIEW_POLICY_VERSION) return "unchecked";
  if (input.copyBlocked || !canApproveContent(input.inputHash, review, false, input.voicePending)) return "blocked";
  return needsResolutionNote(review.result?.findings ?? []) ? "look" : "ready";
}

/** A finding in words the owner can act on: photo ids become "Photo 2". */
export function plainNote(text: string, assetIds: readonly string[]) {
  let line = text;
  assetIds.forEach((id, index) => { line = line.split(`Photo ${id}`).join(`Photo ${index + 1}`).split(id).join(`Photo ${index + 1}`); });
  return line.replace(/\s+/g, " ").trim().slice(0, 240);
}

/** What the card says under a post that is not simply ready. */
export function pickNotes(status: PickStatus, review: ContentReview | null, copy: readonly ReviewFinding[], assetIds: readonly string[]) {
  const lines = status === "failed" ? [review?.error || "The AI check did not finish."]
    : status === "blocked" ? [...(review?.evidence?.reasons ?? []), ...[...copy, ...(review?.result?.findings ?? [])].filter((finding) => finding.severity === "blocker").map((finding) => finding.detail)].filter((line) => !cosmeticFinding(line))
    : status === "look" ? (review?.result?.findings ?? []).filter((finding) => finding.severity === "warning" && !cosmeticFinding(finding.detail)).map((finding) => finding.detail)
    : [];
  return [...new Set(lines.map((line) => plainNote(line, assetIds)))].slice(0, 3);
}

export type Pick = {
  draftId: string; rootId: string; inputHash: string; source: "past" | "new"; title: string; createdAt: string;
  social: string; googleBusiness: string; assetIds: string[]; photos: { id: string; storageKey: string; description: string }[];
  status: PickStatus; notes: string[]; lastSentAt: string | null;
};

/** The newest version of every post that can still be posted, newest first. */
export async function listPicks(db: PrismaClient, orgId: string, now = new Date(), limit = 40): Promise<Pick[]> {
  const { loadContentReview } = await import("@/lib/content-review-store");
  const since = now.getTime() - PICK_RECENT_DAYS * DAY;
  const [drafts, superseded, deliveries, skips, prepares] = await Promise.all([
    db.activityLog.findMany({ where: { orgId, action: DRAFT_SAVED_ACTION }, orderBy: { createdAt: "desc" }, take: 400, select: { id: true, createdAt: true, metadata: true } }),
    db.activityLog.findMany({ where: { orgId, action: REVIEW_SUPERSEDED }, select: { metadata: true }, take: 5000 }),
    db.activityLog.findMany({ where: { orgId, action: BUFFER_DELIVERY }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true }, take: 1000 }),
    db.activityLog.findMany({ where: { orgId, action: PICK_SKIPPED }, select: { metadata: true }, take: 1000 }),
    db.activityLog.findMany({ where: { orgId, action: CAPTION_REVISION_ACTION, AND: [{ metadata: { path: ["apply"], equals: true } }, { OR: [{ metadata: { path: ["status"], equals: "queued" } }, { metadata: { path: ["status"], equals: "running" } }] }] }, select: { metadata: true }, take: 200 }),
  ]);
  const links = versionLinks(superseded);
  const skipped = skippedRoots(skips, now);
  const preparing = new Set(prepares.flatMap((row) => { const id = (row.metadata as { draftId?: unknown } | null)?.draftId; return typeof id === "string" ? [id] : []; }));
  const heads = drafts.filter((row) => !links.next.has(row.id) && !testDraft.test(String((row.metadata as { sourceNotes?: unknown } | null)?.sourceNotes ?? "")));
  const picks: Pick[] = [];
  for (let start = 0; start < heads.length && picks.length < limit; start += 8) {
    const batch = await Promise.all(heads.slice(start, start + 8).map(async (row): Promise<Pick | null> => {
      const versionIds = chainOf(row.id, links);
      if (skipped.has(versionIds[0])) return null;
      const sent = lastDelivery(versionIds, deliveries);
      if (sent && sent.at.getTime() >= since) return null;
      const context = await loadContentReview(orgId, row.id, db);
      if (!context || context.superseded || draftPublishability(context.draft, context.originals, context.assets).blocked) return null;
      const copy = postedCopyChecks(context.draft);
      const status = pickStatus({ preparing: preparing.has(row.id), review: context.review, inputHash: context.inputHash, approvedAt: context.approvedAt, voicePending: context.voicePending, copyBlocked: copy.some((finding) => finding.severity === "blocker") });
      const assetIds = context.draft.assetIds;
      const photos = assetIds.flatMap((id) => { const asset = context.assets.find((item) => item.id === id); return asset ? [{ id, storageKey: asset.storageKey, description: asset.description ?? "" }] : []; });
      return {
        draftId: row.id, rootId: versionIds[0], inputHash: context.inputHash, source: context.assets.some((asset) => asset.tags.includes(PAST_JOB_TAG)) ? "past" : "new",
        title: context.draft.packName || context.jobName, createdAt: row.createdAt.toISOString(), social: context.draft.social, googleBusiness: context.draft.googleBusiness,
        assetIds, photos, status, notes: pickNotes(status, context.review, copy, assetIds), lastSentAt: sent ? sent.at.toISOString() : null,
      };
    }));
    for (const pick of batch) if (pick && picks.length < limit) picks.push(pick);
  }
  return picks;
}

/**
 * "Fill my picks": makes a pack for each website past job that has none, then asks this PC to rewrite
 * both posts of every past-job pack nobody has changed yet, save them as a new version and check it.
 * Packs the owner edited, approved, skipped or sent in the last 90 days are left alone. Stops after
 * about `budgetMs` so one request stays short; call again while `remaining` is true.
 */
export async function fillPicks(db: PrismaClient, auth: { orgId: string; userId: string }, budgetMs = 40000, now = new Date()) {
  const { listPastJobs, makePastJobPack } = await import("@/lib/past-jobs");
  const { loadContentReview } = await import("@/lib/content-review-store");
  const { queueCaptionRevision } = await import("@/lib/caption-revision-store");
  const started = Date.now();
  const [jobs, deliveries, skips] = await Promise.all([
    listPastJobs(db, auth.orgId),
    db.activityLog.findMany({ where: { orgId: auth.orgId, action: BUFFER_DELIVERY, createdAt: { gte: new Date(now.getTime() - PICK_RECENT_DAYS * DAY) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true }, take: 1000 }),
    db.activityLog.findMany({ where: { orgId: auth.orgId, action: PICK_SKIPPED }, select: { metadata: true }, take: 1000 }),
  ]);
  const skipped = skippedRoots(skips, now);
  let made = 0;
  let queued = 0;
  for (const job of jobs) {
    if (job.status === "approved" || job.versionIds.length > 1 || (job.versionIds[0] && skipped.has(job.versionIds[0])) || lastDelivery(job.versionIds, deliveries)) continue;
    if (Date.now() - started > budgetMs) return { made, queued, remaining: true };
    const draftId = job.draftId ?? (await makePastJobPack(db, auth, job.slug, { check: false })).draftId;
    if (!job.draftId) made++;
    const context = await loadContentReview(auth.orgId, draftId, db);
    if (!context || context.superseded || context.voicePending || context.approvedAt) continue;
    // One prepare per version: a finished or waiting one is not asked again.
    const existing = await db.activityLog.findFirst({ where: { id: captionRevisionId(auth.orgId, draftId, context.inputHash, PICK_INSTRUCTION, JSON.stringify({})), action: CAPTION_REVISION_ACTION }, select: { metadata: true } });
    const status = captionRevisionSchema.safeParse(existing?.metadata).data?.status;
    if (status === "queued" || status === "running" || status === "ready") continue;
    await queueCaptionRevision(db, auth.orgId, auth.userId, context.jobId, draftId, context.inputHash, PICK_INSTRUCTION, context.draft.social, context.draft.googleBusiness, { locked: {}, apply: true });
    queued++;
  }
  return { made, queued, remaining: false };
}

/** Hides a post from the picks for 30 days. Its versions and checks stay as they are. */
export async function skipPick(db: PrismaClient, auth: { orgId: string; userId: string }, draftId: string, now = new Date()) {
  const draft = await db.activityLog.findFirst({ where: { id: draftId, orgId: auth.orgId, action: DRAFT_SAVED_ACTION }, select: { jobId: true } });
  if (!draft) throw new Error("That post is not in your content.");
  const superseded = await db.activityLog.findMany({ where: { orgId: auth.orgId, action: REVIEW_SUPERSEDED }, select: { metadata: true }, take: 5000 });
  const rootId = chainOf(draftId, versionLinks(superseded))[0];
  const until = new Date(now.getTime() + PICK_SKIP_DAYS * DAY).toISOString();
  await db.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId: draft.jobId, action: PICK_SKIPPED, metadata: { rootId, draftId, until } } });
  return { until };
}

/** When another version of this post went to Buffer in the last 90 days, for the send page's warning. */
export async function otherVersionSent(db: PrismaClient, orgId: string, draftId: string, now = new Date()) {
  const [superseded, deliveries] = await Promise.all([
    db.activityLog.findMany({ where: { orgId, action: REVIEW_SUPERSEDED }, select: { metadata: true }, take: 5000 }),
    db.activityLog.findMany({ where: { orgId, action: BUFFER_DELIVERY, createdAt: { gte: new Date(now.getTime() - PICK_RECENT_DAYS * DAY) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true }, take: 1000 }),
  ]);
  return lastDelivery(chainOf(draftId, versionLinks(superseded)).filter((id) => id !== draftId), deliveries);
}
