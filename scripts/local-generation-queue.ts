import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { generationRecordSchema } from "../src/lib/marketing-evidence";
import type { z } from "zod";

export const GENERATION_JOB = "marketing.generation.job";
export const GENERATION_ERROR = "Local draft generation could not complete. The submission remains saved.";
const jobSchema = generationRecordSchema;
export type GenerationJob = z.infer<typeof jobSchema>;

export function generationJobId(orgId: string, inviteId: string, submissionId: string) {
  const hex = createHash("sha256").update(`rhi-generation-job-v1:${orgId}:${inviteId}:${submissionId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
export function safeGenerationError() {
  return GENERATION_ERROR;
}
function comparableMetadata(metadata: unknown): Prisma.InputJsonObject | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Prisma.InputJsonObject;
}
function parseJob(metadata: unknown) {
  const parsed = jobSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
function waiting(job: GenerationJob, now: Date) {
  return Boolean(job.nextRetryAt && new Date(job.nextRetryAt).getTime() > now.getTime());
}
export function generationScanDecision(metadata: unknown, now: Date) {
  const job = parseJob(metadata);
  if (!job) return "run";
  if (job.status === "completed" || job.status === "failed" || job.status === "held" || job.status === "running" || job.attempts >= 3 || waiting(job, now)) return "skip";
  return "run";
}
export function claimMetadata(metadata: unknown, now: Date) {
  const job = parseJob(metadata);
  if (!job || job.status !== "queued" || job.attempts >= 3 || waiting(job, now)) return null;
  return { ...job, status: "running" as const, attempts: job.attempts + 1, runningAt: now.toISOString(), nextRetryAt: null, error: null };
}
export function failMetadata(metadata: unknown, now: Date) {
  const job = parseJob(metadata);
  if (!job) return null;
  if (job.attempts >= 3) return { ...job, status: "failed" as const, runningAt: null, nextRetryAt: null, error: GENERATION_ERROR };
  return { ...job, status: "queued" as const, runningAt: null, nextRetryAt: new Date(now.getTime() + job.attempts * 5 * 60000).toISOString(), error: GENERATION_ERROR };
}
export function recoverMetadata(metadata: unknown) {
  const job = parseJob(metadata);
  if (!job || job.status !== "running") return null;
  if (job.attempts >= 3) return { ...job, status: "failed" as const, runningAt: null, nextRetryAt: null, error: GENERATION_ERROR };
  return { ...job, status: "queued" as const, runningAt: null, nextRetryAt: null, error: null };
}
export function completeMetadata(metadata: unknown) {
  const job = parseJob(metadata);
  if (!job || job.status === "completed") return null;
  return { ...job, status: "completed" as const, runningAt: null, nextRetryAt: null, error: null };
}
export function nextGenerationSubmission<T extends { inviteId: string; submissionId: string }>(orgId: string, items: T[], jobs: Map<string, unknown>, now: Date) {
  return items.find((item) => generationScanDecision(jobs.get(generationJobId(orgId, item.inviteId, item.submissionId)), now) === "run") ?? null;
}
const blank = (inviteId: string, submissionId: string): GenerationJob => ({ inviteId, submissionId, status: "queued", attempts: 0, runningAt: null, nextRetryAt: null, error: null, ownerNotes: "", postType: "project" });

export async function recordEvidenceResult(store: PrismaClient, orgId: string, inviteId: string, submissionId: string, evidence: NonNullable<GenerationJob["evidence"]>, issues: string[], held: boolean, checkedFields?: Record<string, string>) {
  const id = generationJobId(orgId, inviteId, submissionId);
  const row = await store.activityLog.findUnique({ where: { id } });
  const current = parseJob(row?.metadata);
  if (!row || !current || current.status !== "running") throw new Error("Generation ownership changed.");
  const metadata = { ...current, evidence, issues: issues.slice(0, 80), checkedFields: checkedFields || {}, ...(held ? { status: "held" as const, runningAt: null, nextRetryAt: null, error: null } : {}) };
  const result = await store.activityLog.updateMany({ where: { id, metadata: { equals: row.metadata } }, data: { metadata } });
  if (result.count !== 1) throw new Error("Generation evidence changed.");
}

export async function claimGenerationJob(store: PrismaClient, orgId: string, jobId: string | null, inviteId: string, submissionId: string, now = new Date()) {
  const id = generationJobId(orgId, inviteId, submissionId);
  await store.activityLog.upsert({ where: { id }, create: { id, orgId, jobId, action: GENERATION_JOB, metadata: blank(inviteId, submissionId) }, update: {} });
  const row = await store.activityLog.findUnique({ where: { id } });
  const current = comparableMetadata(row?.metadata);
  const metadata = claimMetadata(row?.metadata, now);
  if (!metadata || !row || !current) return "skip" as const;
  const claim = await store.activityLog.updateMany({ where: { id, metadata: { equals: current } }, data: { metadata } });
  return claim.count === 1 ? "run" as const : "skip" as const;
}
export async function recordGenerationFailure(store: PrismaClient, orgId: string, inviteId: string, submissionId: string, now = new Date()) {
  const id = generationJobId(orgId, inviteId, submissionId);
  const row = await store.activityLog.findUnique({ where: { id } });
  const current = comparableMetadata(row?.metadata);
  const metadata = failMetadata(row?.metadata, now);
  if (!metadata || !row || !current) return null;
  await store.activityLog.updateMany({ where: { id, metadata: { equals: current } }, data: { metadata } });
  return metadata;
}
export async function recordGenerationCompleted(store: PrismaClient, orgId: string, inviteId: string, submissionId: string) {
  const id = generationJobId(orgId, inviteId, submissionId);
  const row = await store.activityLog.findUnique({ where: { id } });
  const current = comparableMetadata(row?.metadata);
  const metadata = completeMetadata(row?.metadata);
  if (!metadata || !row || !current) return null;
  await store.activityLog.updateMany({ where: { id, metadata: { equals: current } }, data: { metadata } });
  return metadata;
}
export async function recoverInterruptedGeneration(store: PrismaClient, orgId: string) {
  const rows = await store.activityLog.findMany({ where: { orgId, action: GENERATION_JOB, metadata: { path: ["status"], equals: "running" } }, take: 20 });
  let recovered = 0;
  for (const row of rows) {
    const current = comparableMetadata(row.metadata);
    const metadata = recoverMetadata(row.metadata);
    if (!metadata || !current) continue;
    const saved = await store.activityLog.updateMany({ where: { id: row.id, metadata: { equals: current } }, data: { metadata } });
    recovered += saved.count;
  }
  return recovered;
}
