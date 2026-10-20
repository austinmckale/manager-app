import type { PrismaClient } from "@prisma/client";
import { REVIEW_APPROVAL } from "../src/lib/content-review";
import { DRAFT_SAVED_ACTION } from "../src/lib/marketing";

/**
 * How RHI Pros posts sound, from the website's copy rules (CODEX.md, "Two voices") and the owner's
 * direction: RHI Pros did everything in its job photos, and the posts are about the work, with life.
 * The owner's own approved posts are better examples, so they are sent too once there are some.
 */
export const HOUSE_VOICE = [
  "Write like Ryan, the owner, telling a neighbor about a recent job: warm, specific and alive, never stiff.",
  "RHI Pros did everything shown in the photos. Say so lightly or not at all; the post is about the work, not about us.",
  "Bring the work to life: the materials, colors, textures and light, the craftsmanship in the details, and how the space looks and feels now.",
  "Talk about the space the way a homeowner would see it. Use plain homeowner words (patio, not surround).",
  "No slogans, hype or lines any contractor could post about any job. Never use the word scope, or jargon like closeout, punch list or milestones.",
  "Short and vivid beats long and flat. Be creative in how you say it, never in what you claim: every fact comes from the facts given.",
];

/** The owner's newest approved Facebook/Instagram posts, as tone examples only. */
export async function voiceExamples(prisma: PrismaClient, orgId: string, limit = 3): Promise<string[]> {
  const approvals = await prisma.activityLog.findMany({ where: { orgId, action: REVIEW_APPROVAL }, orderBy: { createdAt: "desc" }, take: 20, select: { metadata: true } });
  const draftIds = [...new Set(approvals.flatMap((row) => { const id = (row.metadata as { draftId?: unknown } | null)?.draftId; return typeof id === "string" ? [id] : []; }))];
  if (!draftIds.length) return [];
  const drafts = await prisma.activityLog.findMany({ where: { orgId, action: DRAFT_SAVED_ACTION, id: { in: draftIds } }, select: { id: true, metadata: true } });
  const byId = new Map(drafts.map((row) => [row.id, (row.metadata as { social?: unknown } | null)?.social]));
  const examples: string[] = [];
  for (const id of draftIds) {
    const social = byId.get(id);
    if (typeof social === "string" && social.trim() && !examples.includes(social.trim())) examples.push(social.trim().slice(0, 600));
    if (examples.length >= limit) break;
  }
  return examples;
}

/** Context for every writer call: the house voice and, when there are any, the owner's approved posts. */
export async function voiceContext(prisma: PrismaClient, orgId: string) {
  const examples = await voiceExamples(prisma, orgId).catch(() => []);
  return { houseVoice: HOUSE_VOICE, ...(examples.length ? { voiceExamples: examples } : {}) };
}
