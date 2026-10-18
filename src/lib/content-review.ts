import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketingDraft } from "@/lib/marketing";
import { evidenceSchema } from "@/lib/marketing-evidence";
import { copyChecks } from "@/lib/copy-checks";
import { cosmeticFinding } from "@/lib/review-findings";

export { copyChecks };

export const REVIEW_POLICY_VERSION = 3 as const;
export const REVIEW_REQUEST = "marketing.content.review";
export const REVIEW_APPROVAL = "marketing.content.approved";
export const REVIEW_SUPERSEDED = "marketing.content.superseded";
export const findingSchema = z.object({ category: z.enum(["facts", "privacy", "copy", "images"]), severity: z.enum(["blocker", "warning"]), detail: z.string().min(1).max(800), evidence: z.string().min(1).max(800), suggestion: z.string().max(800) });
export const reviewResultSchema = z.object({ summary: z.string().min(1).max(1000), findings: z.array(findingSchema).max(30) }).transform((result) => ({ ...result, findings: result.findings.map((finding) => finding.category === "images" ? { ...finding, severity: "warning" as const } : finding) }));
export const aiReviewResultSchema = z.object({ summary: z.string().min(1).max(1000), findings: z.array(findingSchema.extend({ publicField: z.enum(["publicLocation", "service", "social", "googleBusiness", "metaPrimary", "metaHeadline", "imageHeadline", "googleHeadlines", "googleDescriptions", "landingUrl", "photos"]), quote: z.string().max(400) })).max(6) });
export const reviewRecordSchema = z.object({ draftId: z.string().uuid(), inputHash: z.string().length(64), status: z.enum(["queued", "running", "completed", "failed"]), requestedAt: z.string(), startedAt: z.string().optional(), completedAt: z.string().optional(), result: reviewResultSchema.optional(), engine: z.string().optional(), error: z.string().optional(), imagesChecked: z.number().optional(), policyVersion: z.union([z.literal(2), z.literal(3)]).optional(), evidence: evidenceSchema.optional() });
export type ContentReview = z.infer<typeof reviewRecordSchema>;
export type ReviewFinding = z.infer<typeof findingSchema>;
export function groundReviewFindings(draft: MarketingDraft, result: z.infer<typeof aiReviewResultSchema>): ReviewFinding[] {
  const seen = new Set<string>();
  return result.findings.flatMap((finding) => {
    const key = [finding.category, finding.publicField, finding.detail.trim().toLowerCase(), finding.quote.trim().toLowerCase()].join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    const value = finding.publicField === "photos" ? null : draft[finding.publicField];
    const text = Array.isArray(value) ? value.join("\n") : value || "";
    if (finding.publicField !== "photos" && (!finding.quote.trim() || !text.includes(finding.quote))) return [{ category: finding.category, severity: "warning" as const, detail: `Unverified AI finding: ${finding.detail}`.slice(0, 800), evidence: "The reviewer did not supply an exact matching quote from the named public field.", suggestion: "Check this claim manually. Do not remove private source notes just because they are not suitable for public copy." }];
    return [{ category: finding.category, severity: finding.category === "images" ? "warning" as const : finding.severity, detail: finding.detail, evidence: `${finding.publicField}${finding.quote ? `: “${finding.quote}”` : ""}. ${finding.evidence}`.slice(0, 800), suggestion: finding.suggestion }];
  });
}
export function contentHash(input: unknown) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
export function contentReviewId(draftId: string, hash: string) {
  const hex = contentHash(["rhi-content-review-v2", draftId, hash]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function needsResolutionNote(findings: readonly { severity: string; detail: string }[]) {
  return findings.some((finding) => finding.severity === "warning" && !cosmeticFinding(finding.detail));
}
// An edited copy of a photo (from ChatGPT or another editor) is a new file linked to the photo it
// replaces. A save may swap it in only when that photo is on the version being saved.
export const CHAT_EDIT_TAG = "chat-edit";
export function editedFromTag(photoId: string) { return `edited-from:${photoId}`; }
export function allowedPhotoSelection(next: readonly string[], current: readonly string[]) {
  if (next.length < 1 || next.length > current.length) return false;
  const allowed = new Set(current);
  const seen = new Set<string>();
  for (const id of next) {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
export function canApproveContent(hash: string, review: ContentReview | null, superseded: boolean, voicePending: boolean) {
  return !superseded && !voicePending && review?.inputHash === hash && review.status === "completed" && review.policyVersion === REVIEW_POLICY_VERSION && !!review.evidence && !review.evidence.reasons.some((reason) => !cosmeticFinding(reason)) && !!review.result && !review.result.findings.some((finding) => finding.severity === "blocker" && !cosmeticFinding(finding.detail));
}
