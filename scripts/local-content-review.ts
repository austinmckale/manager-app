import type { PrismaClient } from "@prisma/client";
import type { supabaseAdmin as SupabaseAdmin } from "../src/lib/supabase/admin";
import { z } from "zod";
import { inspectSubmission, auditDraft } from "./local-evidence-pipeline";
import { localReviewRequest } from "./local-review-request";
import { localAiSettings } from "./local-ai-settings";
import { localModels } from "../src/lib/local-models";
import { proposeCaptionFixes, type CaptionFixes } from "./local-write-loop";
import { voiceContext } from "./local-voice";
import { DRAFT_SAVED_ACTION } from "../src/lib/marketing";
import { loadContentReview } from "../src/lib/content-review-store";
import { REVIEW_REQUEST, postedCopyChecks, reviewRecordSchema, type ReviewFinding } from "../src/lib/content-review";
import { cosmeticFinding } from "../src/lib/review-findings";
import { publicationBlock } from "../src/lib/publishability";

export async function runContentReview(prisma: PrismaClient, supabase: typeof SupabaseAdmin, orgId: string, includeTest = false, ai?: { model: string; writer?: string; request: typeof localReviewRequest; draftId?: string }) {
  const pending = await prisma.activityLog.findMany({ where: { orgId, action: REVIEW_REQUEST, OR: [{ metadata: { path: ["status"], equals: "queued" } }, { metadata: { path: ["status"], equals: "running" } }] }, orderBy: { createdAt: "asc" }, take: 20 });
  let context: Awaited<ReturnType<typeof loadContentReview>> = ai?.draftId ? await loadContentReview(orgId, ai.draftId) : null;
  if (context?.superseded) context = null;
  if (ai?.draftId && !context) return { reviewed: false };
  for (const row of pending) {
    if (context) break;
    const parsed = reviewRecordSchema.safeParse(row.metadata);
    if (!parsed.success || (parsed.data.status === "running" && Date.now() - new Date(parsed.data.startedAt || "").getTime() < 20 * 60000)) continue;
    const candidate = await loadContentReview(orgId, parsed.data.draftId);
    if (!candidate || candidate.superseded || candidate.inputHash !== parsed.data.inputHash) {
      await prisma.activityLog.update({ where: { id: row.id }, data: { metadata: { ...parsed.data, status: "failed", error: "Source or draft changed. Request checks on the current version." } } });
      continue;
    }
    context = candidate; break;
  }
  if (!context) {
    const drafts = await prisma.activityLog.findMany({ where: { orgId, action: DRAFT_SAVED_ACTION }, orderBy: { createdAt: "desc" }, take: 50 });
    for (const row of drafts) {
      const candidate = await loadContentReview(orgId, row.id);
      if (!candidate || candidate.superseded || (candidate.review && candidate.review.policyVersion === 3) || candidate.voicePending || (!includeTest && /\bTEST\s*[—:-]/i.test(candidate.draft.sourceNotes))) continue;
      context = candidate; break;
    }
  }
  if (!context || context.voicePending) return { reviewed: false };
  const current = context;
  const metadata = { draftId: current.draftId, inputHash: current.inputHash, requestedAt: current.review?.requestedAt || new Date().toISOString(), startedAt: new Date().toISOString(), status: "running" as const };
  await prisma.activityLog.upsert({ where: { id: current.reviewId }, create: { id: current.reviewId, orgId, jobId: current.jobId, action: REVIEW_REQUEST, metadata }, update: { metadata } });
  try {
    // Photos and notes are read by the fast reader; the fact-check uses the writer model when one is set.
    const model = ai?.model || localModels().reader;
    const checker = ai ? ai.writer || ai.model : localModels().writer;
    if ([model, checker].some((name) => name.includes("cloud") || name.includes("/"))) throw new Error("Local model required");
    const sharp = (await import("sharp")).default;
    const images = [] as { id: string; image: string }[];
    const settings = localAiSettings();
    const imageSize = settings.imageSize;
    for (const photo of current.assets) {
      const { data, error } = await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").download(photo.storageKey);
      if (error || !data) throw new Error("Private photo unavailable");
      images.push({ id: photo.id, image: (await sharp(Buffer.from(await data.arrayBuffer())).resize({ width: imageSize, height: imageSize, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()).toString("base64") });
    }
    const sources = { notes: current.originals.receiptNotes.join("\n\n"), voice: current.audio.map((audio) => audio.transcript).join("\n\n"), owner: current.draft.sourceNotes };
    const evidence = await inspectSubmission({ model, photos: images, postType: current.draft.postType, sources }, ai?.request);
    const block = publicationBlock(sources);
    // Buffer posts only the Facebook/Instagram text and the Google Business text, so only those are fact-checked.
    const posted = { social: current.draft.social, googleBusiness: current.draft.googleBusiness };
    const audit = block || evidence.reasons.length ? null : await auditDraft(checker, posted, evidence, ai?.request);
    const issues = audit?.issues || evidence.reasons;
    const findings: ReviewFinding[] = block
      ? block.lines.map((line) => ({ category: "facts" as const, severity: "blocker" as const, detail: line, evidence: "The notes match a publication block.", suggestion: "Use a new verified submission." }))
      : [...postedCopyChecks(current.draft), ...issues.map((issue) => ({ category: "facts" as const, severity: cosmeticFinding(issue) ? "warning" as const : "blocker" as const, detail: issue.slice(0, 800), evidence: "Compared with all selected photos and the original notes and voice transcript.", suggestion: "Correct the notes or public copy, or choose relevant photos, then save a new version and run checks again." }))];
    const summary = block ? block.title : findings.length ? "Changes or context are required before approval." : "Every selected photo and both posts were checked against source evidence. Owner approval is still required.";
    // When the posts fail the fact-check, suggest fixes the owner can accept. Nothing is applied here,
    // and a failed suggestion never fails the review.
    let fixes: CaptionFixes | undefined;
    if (audit?.issues.length) {
      try { fixes = await proposeCaptionFixes({ voice: await voiceContext(prisma, orgId), request: ai?.request ?? localReviewRequest, model: checker, evidence, draft: current.draft, issues: audit.issues, options: { num_ctx: 8192, num_predict: 2200, ...settings.options } }); }
      catch { fixes = undefined; }
    }
    // Re-read evidence before committing a result for an immutable input hash.
    const latest = await loadContentReview(orgId, current.draftId);
    if (!latest || latest.superseded || latest.inputHash !== current.inputHash) throw new Error("Source changed during review");
    await prisma.activityLog.update({ where: { id: current.reviewId }, data: { metadata: { ...metadata, status: "completed", completedAt: new Date().toISOString(), engine: model === checker ? model : `${model} + ${checker}`, policyVersion: 3, evidence, imagesChecked: images.length, ...(fixes ? { fixes } : {}), result: { summary, findings: [...findings.filter((finding) => finding.severity === "blocker"), ...findings.filter((finding) => finding.severity === "warning")].slice(0, 30) } } } });
    return { reviewed: true };
  } catch (error) {
    const reason = error instanceof z.ZodError || error instanceof SyntaxError ? "Local reviewer returned invalid structured findings." : error instanceof Error && /^Local reviewer returned HTTP \d{3}$/.test(error.message) ? error.message + "." : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "Local reviewer timed out." : "Local review failed or evidence changed.";
    await prisma.activityLog.update({ where: { id: current.reviewId }, data: { metadata: { ...metadata, status: "failed", error: reason + " Check Ollama, then request checks again. No approval or publishing occurred." } } });
    return { reviewed: false, reviewFailed: true };
  }
}
