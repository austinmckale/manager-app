import type { PrismaClient } from "@prisma/client";
import { REVIEW_REQUEST, reviewRecordSchema } from "../src/lib/content-review";
import { DRAFT_SAVED_ACTION } from "../src/lib/marketing";
import type { MarketingEvidence } from "../src/lib/marketing-evidence";

/**
 * What the last AI check saw (photo observations and note facts) for this draft, or for the
 * versions it was saved from. Regenerating reuses it instead of reading the photos again.
 */
export async function latestCheckedEvidence(prisma: PrismaClient, orgId: string, draftId: string): Promise<MarketingEvidence | null> {
  let id: string | null = draftId;
  for (let depth = 0; id && depth < 6; depth++) {
    const reviews = await prisma.activityLog.findMany({ where: { orgId, action: REVIEW_REQUEST, metadata: { path: ["draftId"], equals: id } }, orderBy: { createdAt: "desc" }, take: 5 });
    for (const row of reviews) {
      const parsed = reviewRecordSchema.safeParse(row.metadata);
      if (parsed.success && parsed.data.status === "completed" && parsed.data.evidence) return parsed.data.evidence;
    }
    const saved: { metadata: unknown } | null = await prisma.activityLog.findFirst({ where: { id, orgId, action: DRAFT_SAVED_ACTION }, select: { metadata: true } });
    const parent: unknown = (saved?.metadata as { parentDraftId?: unknown } | null)?.parentDraftId;
    id = typeof parent === "string" ? parent : null;
  }
  return null;
}

/** The owner's steering note, stored inside the request's instruction text. */
export function regenerateNote(instruction: string) {
  return instruction.replace(/^Regenerate the unlocked captions:?\s*/i, "").trim();
}
