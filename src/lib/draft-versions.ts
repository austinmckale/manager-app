import type { Prisma, PrismaClient } from "@prisma/client";
import { REVIEW_SUPERSEDED } from "@/lib/content-review";
import { DRAFT_SAVED_ACTION, marketingDraftSchema, type MarketingDraft } from "@/lib/marketing";
import type { CaptionValues } from "@/lib/caption-revision";

type Loaded = { draftId: string; jobId: string; draft: MarketingDraft; inputHash: string; superseded: boolean; approvedAt: string | null };
type Load = (orgId: string, draftId: string, db: Prisma.TransactionClient) => Promise<Loaded | null>;

/**
 * Saves rewritten posts as a new, unapproved version of a draft, like Save on the review page: only
 * the Facebook/Instagram and Google Business text change. Returns the new version's id, or null when
 * the draft changed, was replaced or was approved after the rewrite was asked for.
 */
export async function saveProposalVersion(db: PrismaClient, orgId: string, draftId: string, inputHash: string, proposal: CaptionValues, load?: Load): Promise<string | null> {
  const social = proposal.social?.trim();
  const googleBusiness = proposal.googleBusiness?.trim();
  if (!social && !googleBusiness) return null;
  const loader: Load = load ?? (await import("@/lib/content-review-store")).loadContentReview;
  return db.$transaction(async (tx) => {
    const context = await loader(orgId, draftId, tx);
    if (!context || context.superseded || context.approvedAt || context.inputHash !== inputHash) return null;
    const draft = marketingDraftSchema.parse({ ...context.draft, ...(social ? { social } : {}), ...(googleBusiness ? { googleBusiness } : {}) });
    const base = { orgId, actorId: null, jobId: context.jobId };
    const version = await tx.activityLog.create({ data: { ...base, action: DRAFT_SAVED_ACTION, metadata: { ...draft, parentDraftId: context.draftId } } });
    await tx.activityLog.create({ data: { ...base, action: REVIEW_SUPERSEDED, metadata: { draftId: context.draftId, replacementDraftId: version.id } } });
    return version.id;
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
