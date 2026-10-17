import { createHash } from "node:crypto";
import { z } from "zod";
import { marketingDraftSchema, type MarketingDraft } from "@/lib/marketing";

export const REVIEW_REQUEST = "marketing.content.review";
export const REVIEW_APPROVAL = "marketing.content.approved";
export const REVIEW_SUPERSEDED = "marketing.content.superseded";
export const findingSchema = z.object({ category: z.enum(["facts", "privacy", "copy", "images"]), severity: z.enum(["blocker", "warning"]), detail: z.string().min(1).max(800), evidence: z.string().min(1).max(800), suggestion: z.string().max(800) });
export const reviewResultSchema = z.object({ summary: z.string().min(1).max(1000), findings: z.array(findingSchema).max(30) }).transform((result) => ({ ...result, findings: result.findings.map((finding) => finding.category === "images" ? { ...finding, severity: "warning" as const } : finding) }));
export const aiReviewResultSchema = z.object({ summary: z.string().min(1).max(1000), findings: z.array(findingSchema.extend({ publicField: z.enum(["publicLocation", "service", "social", "googleBusiness", "metaPrimary", "metaHeadline", "imageHeadline", "googleHeadlines", "googleDescriptions", "landingUrl", "photos"]), quote: z.string().max(400) })).max(6) });
export const reviewRecordSchema = z.object({ draftId: z.string().uuid(), inputHash: z.string().length(64), status: z.enum(["queued", "running", "completed", "failed"]), requestedAt: z.string(), startedAt: z.string().optional(), completedAt: z.string().optional(), result: reviewResultSchema.optional(), engine: z.string().optional(), error: z.string().optional(), imagesChecked: z.number().optional() });
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
  const hex = contentHash(["rhi-content-review-v1", draftId, hash]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function copyChecks(draft: MarketingDraft): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const add = (category: ReviewFinding["category"], detail: string, evidence: string, suggestion: string) => findings.push({ category, severity: "blocker", detail, evidence, suggestion });
  if (!marketingDraftSchema.safeParse(draft).success) add("copy", "Draft format is invalid.", "Field validation failed.", "Correct text lengths and required fields.");
  for (const [label, value] of Object.entries({ social: draft.social, googleBusiness: draft.googleBusiness, metaPrimary: draft.metaPrimary, metaHeadline: draft.metaHeadline, imageHeadline: draft.imageHeadline })) if (!value.trim()) add("copy", `${label} is empty.`, "No public copy supplied.", "Write this field before approval.");
  const publicText = [draft.social, draft.googleBusiness, draft.metaPrimary, draft.metaHeadline, draft.imageHeadline, ...draft.googleHeadlines, ...draft.googleDescriptions].join("\n");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicText)) add("privacy", "An email address appears in public copy.", "An email pattern was detected.", "Remove customer contact details; use the approved website link.");
  if (!['rhipros.com', 'www.rhipros.com'].includes(new URL(draft.landingUrl).hostname)) add("copy", "The landing page is outside the RHI Pros website.", "Unexpected destination hostname.", "Use the appropriate RHI Pros project or quote page.");
  if (new Set(draft.googleHeadlines.map((value) => value.trim().toLowerCase())).size !== draft.googleHeadlines.length) add("copy", "Google headlines repeat.", "Duplicate headline text.", "Use distinct headlines.");
  return findings;
}
export function canApproveContent(hash: string, review: ContentReview | null, superseded: boolean, voicePending: boolean) {
  return !superseded && !voicePending && review?.inputHash === hash && review.status === "completed" && !!review.result && !review.result.findings.some((finding) => finding.severity === "blocker");
}
