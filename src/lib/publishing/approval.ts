import { loadContentReview } from "@/lib/content-review-store";
import { canApproveContent, copyChecks } from "@/lib/content-review";
import { PublishRejection } from "@/lib/publishing/types";

export type PublishingReviewContext = NonNullable<Awaited<ReturnType<typeof loadContentReview>>>;
export type ApprovedPublishingDraft = {
  orgId: string;
  jobId: string;
  draftId: string;
  metadata: PublishingReviewContext["draft"];
  approvalHash: string;
};

export function approvedPublishingDraft(orgId: string, draftId: string, context: PublishingReviewContext | null): ApprovedPublishingDraft {
  if (!context || context.draftId !== draftId) throw new PublishRejection("That saved draft is not available.", 404);
  if (context.superseded) throw new PublishRejection("This draft was replaced. Review and approve the current version before publishing.", 409);
  if (!context.approvedAt || context.review?.draftId !== draftId || !canApproveContent(context.inputHash, context.review, context.superseded, context.voicePending) || copyChecks(context.draft).some((finding) => finding.severity === "blocker")) {
    throw new PublishRejection("Owner approval of the exact current draft and source evidence is required before publishing.", 409);
  }
  return { orgId, jobId: context.jobId, draftId, metadata: context.draft, approvalHash: context.inputHash };
}

export async function loadApprovedPublishingDraft(orgId: string, draftId: string) {
  // The existing store scopes all evidence and approval lookups to this org,
  // and only returns approvedAt for the current full review-input hash.
  return approvedPublishingDraft(orgId, draftId, await loadContentReview(orgId, draftId));
}
