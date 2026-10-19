import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { REVIEW_APPROVAL, REVIEW_REQUEST, REVIEW_SUPERSEDED } from "@/lib/content-review";
import { loadContentReview } from "@/lib/content-review-store";
import { DRAFT_SAVED_ACTION } from "@/lib/marketing";
import { pastJobBySlug, pastJobDraft, websiteThumb } from "@/lib/past-jobs-copy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { WEBSITE_ORIGIN, websiteProjectCatalog, type WebsiteCatalogProject } from "@/lib/website-project-catalog";
export { pastJobBySlug, pastJobDraft, pastJobNotes, websiteThumb } from "@/lib/past-jobs-copy";

/**
 * Past jobs: the projects on rhipros.com, turned into marketing packs so there is something true to
 * post between new uploads. All of their photos live in one internal job so the Jobs list stays clean.
 */
export const PAST_JOBS_TAG = "website-project";
export const websiteSlugTag = (slug: string) => `website:${slug}`;
const PAST_JOBS_NAME = "Website past jobs";

export type PastJob = WebsiteCatalogProject & { draftId: string | null; status: "new" | "draft" | "approved"; coverUrl: string };

async function pastJobsJob(db: PrismaClient, orgId: string) {
  const existing = await db.job.findFirst({ where: { orgId, categoryTags: { has: PAST_JOBS_TAG } }, select: { id: true } });
  if (existing) return existing.id;
  const customer = (await db.customer.findFirst({ where: { orgId, name: PAST_JOBS_NAME }, select: { id: true } })) ?? (await db.customer.create({ data: { orgId, name: PAST_JOBS_NAME, notes: "Photos copied from rhipros.com for posting past work." }, select: { id: true } }));
  const job = await db.job.create({ data: { orgId, customerId: customer.id, jobName: PAST_JOBS_NAME, address: "rhipros.com projects", status: "COMPLETED", categoryTags: ["general-remodeling", PAST_JOBS_TAG] }, select: { id: true } });
  return job.id;
}

const stageOf = (src: string) => (/\/before\//i.test(src) ? "BEFORE" : /\/during\//i.test(src) ? "DURING" : "AFTER");

/** Copies the project's website photos into the app once, re-encoded without metadata. */
async function importPhotos(db: PrismaClient, orgId: string, jobId: string, project: WebsiteCatalogProject) {
  const tag = websiteSlugTag(project.slug);
  const existing = await db.fileAsset.findMany({ where: { jobId, type: "PHOTO", tags: { has: tag } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (existing.length) return existing.map((asset) => asset.id);
  const sharp = (await import("sharp")).default;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
  const ids: string[] = [];
  for (const image of project.images) {
    const response = await fetch(new URL(image.src, WEBSITE_ORIGIN), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Could not download a photo from the website (${response.status}).`);
    const bytes = await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const id = randomUUID();
    const storageKey = `${orgId}/${jobId}/website/${project.slug}-${id}.jpg`;
    const upload = await supabaseAdmin.storage.from(bucket).upload(storageKey, bytes, { contentType: "image/jpeg", upsert: false });
    if (upload.error) throw new Error("A photo could not be stored. Try again.");
    await db.fileAsset.create({ data: { id, jobId, type: "PHOTO", storageKey, fileName: image.src.split("/").pop() || `${project.slug}.jpg`, mimeType: "image/jpeg", fileSize: bytes.byteLength, stage: stageOf(image.src), area: project.service.slice(0, 100), description: image.alt.slice(0, 3000), tags: [PAST_JOBS_TAG, tag], isPortfolio: false, isClientVisible: false } });
    ids.push(id);
  }
  return ids;
}

/** The newest version of a draft, following "replaced by" links. */
function latestVersion(draftId: string, replacedBy: Map<string, string>) {
  let id = draftId;
  for (let step = 0; step < 50 && replacedBy.has(id); step++) id = replacedBy.get(id)!;
  return id;
}

export async function listPastJobs(db: PrismaClient, orgId: string): Promise<PastJob[]> {
  const [drafts, superseded, approvals] = await Promise.all([
    db.activityLog.findMany({ where: { orgId, action: DRAFT_SAVED_ACTION, metadata: { path: ["source"], equals: PAST_JOBS_TAG } }, orderBy: { createdAt: "asc" }, select: { id: true, metadata: true } }),
    db.activityLog.findMany({ where: { orgId, action: REVIEW_SUPERSEDED }, select: { metadata: true }, take: 2000 }),
    db.activityLog.findMany({ where: { orgId, action: REVIEW_APPROVAL }, select: { metadata: true }, take: 2000 }),
  ]);
  const replacedBy = new Map(superseded.flatMap((row) => { const meta = row.metadata as { draftId?: string; replacementDraftId?: string } | null; return meta?.draftId && meta.replacementDraftId ? [[meta.draftId, meta.replacementDraftId] as const] : []; }));
  const approved = new Set(approvals.flatMap((row) => { const id = (row.metadata as { draftId?: string } | null)?.draftId; return id ? [id] : []; }));
  const bySlug = new Map(drafts.flatMap((row) => { const slug = (row.metadata as { websiteSlug?: string } | null)?.websiteSlug; return slug ? [[slug, latestVersion(row.id, replacedBy)] as const] : []; }));
  return websiteProjectCatalog.map((project) => {
    const draftId = bySlug.get(project.slug) ?? null;
    return { ...project, draftId, status: !draftId ? "new" : approved.has(draftId) ? "approved" : "draft", coverUrl: project.images[0] ? websiteThumb(project.images[0].src) : "" };
  });
}

/**
 * Makes (or finds) the marketing pack for one website project and queues the AI check on it, so
 * the review page shows suggested fixes once this PC's worker has run. Nothing is approved or posted.
 */
export async function makePastJobPack(db: PrismaClient, auth: { orgId: string; userId: string }, slug: string) {
  const project = pastJobBySlug(slug);
  if (!project) throw new Error("That project is not on the website.");
  const already = (await listPastJobs(db, auth.orgId)).find((item) => item.slug === slug)?.draftId;
  if (already) return { draftId: already, created: false };
  const jobId = await pastJobsJob(db, auth.orgId);
  const assetIds = await importPhotos(db, auth.orgId, jobId, project);
  if (!assetIds.length) throw new Error("That project has no photos on the website.");
  const draft = pastJobDraft(project, assetIds);
  const saved = await db.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId, action: DRAFT_SAVED_ACTION, metadata: { ...draft, source: PAST_JOBS_TAG, websiteSlug: slug } as Prisma.InputJsonValue } });
  // Queue the AI check; the worker takes queued checks in order when no single test is waiting.
  const context = await loadContentReview(auth.orgId, saved.id, db);
  if (context) {
    const metadata = { draftId: context.draftId, inputHash: context.inputHash, status: "queued", requestedAt: new Date().toISOString() };
    await db.activityLog.upsert({ where: { id: context.reviewId }, create: { id: context.reviewId, orgId: auth.orgId, actorId: auth.userId, jobId, action: REVIEW_REQUEST, metadata }, update: { metadata } });
  }
  return { draftId: saved.id, created: true };
}
