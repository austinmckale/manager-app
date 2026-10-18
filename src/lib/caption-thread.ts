import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

export const CAPTION_THREAD_ACTION = "marketing.caption.thread";

const turnSchema = z.object({
  at: z.string().min(1).max(40),
  instruction: z.string().trim().min(1).max(400),
  status: z.enum(["queued", "ready", "failed"]),
  error: z.string().max(200).optional(),
}).strict();

export const captionThreadSchema = z.object({
  version: z.literal(1),
  draftId: z.string().uuid(),
  turns: z.array(turnSchema).max(12),
}).strict();

export type CaptionTurn = z.infer<typeof turnSchema>;
type CaptionThread = z.infer<typeof captionThreadSchema>;

/** One ask stays one row. A finished rewrite replaces its waiting row instead of adding a second line. */
export function nextCaptionTurns(turns: CaptionTurn[], turn: CaptionTurn, settle = false): CaptionTurn[] {
  const nextTurn = turnSchema.parse(turn);
  if (!settle) return [...turns, nextTurn].slice(-12);
  const fromEnd = [...turns].reverse().findIndex((item) => item.instruction === nextTurn.instruction && item.status === "queued");
  if (fromEnd === -1) return [...turns, nextTurn].slice(-12);
  const copy = turns.slice();
  copy[turns.length - 1 - fromEnd] = nextTurn;
  return copy.slice(-12);
}

export function captionThreadId(orgId: string, draftId: string) {
  const hex = createHash("sha256").update(`rhi-caption-thread-v1:${orgId}:${draftId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function toJson(thread: CaptionThread): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(thread));
}

export async function readCaptionThread(store: PrismaClient, orgId: string, draftId: string): Promise<CaptionTurn[] | null> {
  const row = await store.activityLog.findFirst({ where: { id: captionThreadId(orgId, draftId), orgId, action: CAPTION_THREAD_ACTION } });
  const parsed = captionThreadSchema.safeParse(row?.metadata);
  return parsed.success ? parsed.data.turns : null;
}

export async function appendCaptionTurn(store: PrismaClient, orgId: string, actorId: string | null, draftId: string, turn: CaptionTurn, settle = false) {
  const id = captionThreadId(orgId, draftId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await store.activityLog.findFirst({ where: { id, action: CAPTION_THREAD_ACTION } });
    const current = captionThreadSchema.safeParse(row?.metadata);
    const turns = nextCaptionTurns(current.success ? current.data.turns : [], turn, settle);
    const metadata = captionThreadSchema.parse({ version: 1, draftId, turns });
    if (!row) {
      try {
        await store.activityLog.create({ data: { id, orgId, actorId, action: CAPTION_THREAD_ACTION, metadata: toJson(metadata) } });
        return metadata.turns;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    const saved = await store.activityLog.updateMany({
      where: { id, action: CAPTION_THREAD_ACTION, metadata: { equals: row.metadata === null ? Prisma.DbNull : (row.metadata as Prisma.InputJsonValue) } },
      data: { metadata: toJson(metadata) },
    });
    if (saved.count === 1) return metadata.turns;
  }
  throw new Error("Could not save the caption history.");
}
