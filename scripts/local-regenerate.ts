import type { PrismaClient } from "@prisma/client";
import { REVIEW_REQUEST, reviewRecordSchema } from "../src/lib/content-review";
import { DRAFT_SAVED_ACTION } from "../src/lib/marketing";
import type { MarketingEvidence } from "../src/lib/marketing-evidence";
import { loadContentReview } from "../src/lib/content-review-store";
import { localModels } from "../src/lib/local-models";
import { localAiSettings } from "./local-ai-settings";
import { inspectSubmission } from "./local-evidence-pipeline";

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

/**
 * For a draft that was never checked: read its photos and notes now with the fast reader, the same
 * way the AI check does (scripts/local-content-review.ts), so regenerating never needs a check first.
 */
export async function freshEvidence(prisma: PrismaClient, orgId: string, draftId: string): Promise<MarketingEvidence | null> {
  const context = await loadContentReview(orgId, draftId, prisma);
  if (!context) return null;
  const { supabaseAdmin } = await import("../src/lib/supabase/admin");
  const sharp = (await import("sharp")).default;
  const { imageSize } = localAiSettings();
  const photos: { id: string; image: string }[] = [];
  for (const asset of context.assets) {
    const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").download(asset.storageKey);
    if (error || !data) return null;
    photos.push({ id: asset.id, image: (await sharp(Buffer.from(await data.arrayBuffer())).resize({ width: imageSize, height: imageSize, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()).toString("base64") });
  }
  const sources = { notes: context.originals.receiptNotes.join("\n\n"), voice: context.audio.map((audio) => audio.transcript).join("\n\n"), owner: context.draft.sourceNotes };
  return inspectSubmission({ model: localModels().reader, photos, postType: context.draft.postType, sources });
}

/** The owner's steering note, stored inside the request's instruction text. */
export function regenerateNote(instruction: string) {
  return instruction.replace(/^Regenerate the unlocked captions:?\s*/i, "").trim();
}
