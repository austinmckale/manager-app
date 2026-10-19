import type { PrismaClient } from "@prisma/client";
import { REVIEW_APPROVAL } from "../src/lib/content-review";
import { DRAFT_SAVED_ACTION } from "../src/lib/marketing";

/**
 * How RHI Pros posts sound, from the website's copy rules (CODEX.md, "Two voices"). The owner's own
 * approved posts are better examples, so they are sent too once there are some.
 */
export const HOUSE_VOICE = [
  "Write like Ryan, the owner, telling a neighbor about a job he is proud of: plain, specific, friendly, first person plural (we).",
  "Say what was there and what we did with plain trade verbs: built, set, hung, laid, poured, tore out, primed.",
  "Talk about the space the way a homeowner would see it. Use plain homeowner words (patio, not surround).",
  "No slogans, puns, punchlines or lines any contractor could post. Never use the word scope, or jargon like closeout, punch list or milestones.",
  "Less text beats weak text. Every fact must come from the facts given.",
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
