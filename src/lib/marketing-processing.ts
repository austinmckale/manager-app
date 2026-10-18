import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export const PROCESSING_SETTINGS = "marketing.processing.settings";
export const PROCESSING_HEARTBEAT = "marketing.processing.heartbeat";
export const processingSettingsSchema = z.object({ enabled: z.boolean().default(false), mode: z.enum(["hybrid", "local", "manual"]).default("hybrid"), dailyCallLimit: z.number().int().min(1).max(500).default(60), testRequestedAt: z.string().nullable().default(null), testDraftId: z.string().uuid().nullable().default(null), testSubmissionId: z.string().uuid().nullable().default(null) });
export type ProcessingSettings = z.infer<typeof processingSettingsSchema>;
export function processingId(orgId: string, kind: string) {
  const hex = createHash("sha256").update(`rhi-processing-v1:${orgId}:${kind}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function processingSettings(db: PrismaClient, orgId: string) {
  const row = await db.activityLog.findFirst({ where: { id: processingId(orgId, "settings"), orgId, action: PROCESSING_SETTINGS } });
  const parsed = processingSettingsSchema.safeParse(row?.metadata);
  return parsed.success ? parsed.data : processingSettingsSchema.parse({});
}
// Same rule as localModels() in src/lib/local-models.ts, kept here so this file has no extra imports.
function localModelLabel() {
  const reader = process.env.INTAKE_OLLAMA_MODEL || "qwen3.5:4b";
  const writer = process.env.INTAKE_OLLAMA_WRITER_MODEL || reader;
  return reader === writer ? reader : `${reader} + ${writer}`;
}
export async function workerHeartbeat(db: PrismaClient, orgId: string, state: "paused" | "processing" | "idle" | "error", mode: ProcessingSettings["mode"]) {
  const metadata = { checkedAt: new Date().toISOString(), state, mode, apiKeyReady: Boolean(process.env.OPENAI_API_KEY), model: mode === "hybrid" ? process.env.MARKETING_OPENAI_MODEL || "gpt-4.1-mini" : localModelLabel() };
  const id = processingId(orgId, "heartbeat");
  await db.activityLog.upsert({ where: { id }, create: { id, orgId, action: PROCESSING_HEARTBEAT, metadata }, update: { metadata } });
}

// Reserve before sending: timeouts still consume a slot because a provider may
// have processed them. Serializability prevents concurrent workers overspending
// the request limit. This is a call cap, not a guaranteed dollar budget.
export async function reserveApiCall(db: PrismaClient, orgId: string, limit: number, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const id = processingId(orgId, `usage:${day}`);
  await db.$transaction(async (tx) => {
    const row = await tx.activityLog.upsert({ where: { id }, create: { id, orgId, action: "marketing.processing.usage", metadata: { day, calls: 0, inputTokens: 0, outputTokens: 0 } }, update: {} });
    const usage = row.metadata as { calls: number; inputTokens: number; outputTokens: number; day: string };
    if (!Number.isInteger(usage.calls) || usage.calls >= limit) throw new Error("Daily AI call limit reached.");
    await tx.activityLog.update({ where: { id }, data: { metadata: { ...usage, calls: usage.calls + 1 } } });
  }, { isolationLevel: "Serializable" });
  return id;
}
