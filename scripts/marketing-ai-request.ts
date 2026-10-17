import type { PrismaClient } from "@prisma/client";
import { reserveApiCall, processingSettings } from "../src/lib/marketing-processing";
import { localReviewRequest } from "./local-review-request";

type AIInput = { model: string; format: Record<string, unknown>; options?: { num_predict?: number }; messages: { role: string; content: string; images?: string[] }[] };
export function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => !["$schema", "default"].includes(key)).map(([key, item]) => [key, strictSchema(item)]));
  if (source.type === "object" && source.properties) { result.required = Object.keys(source.properties); result.additionalProperties = false; }
  return result;
}
export function marketingAiRequest(db: PrismaClient, orgId: string, mode: "hybrid" | "local" | "manual", testOnce: boolean, fetcher: typeof fetch = fetch): typeof localReviewRequest {
  if (mode === "local") return localReviewRequest;
  return async (body) => {
    if (mode !== "hybrid") throw new Error("Automatic AI processing is disabled.");
    const settings = await processingSettings(db, orgId);
    if ((!settings.enabled && !testOnce) || settings.mode !== "hybrid") throw new Error("Automatic AI processing is paused.");
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI API key is not configured on the worker.");
    const input = body as AIInput;
    const usageId = await reserveApiCall(db, orgId, settings.dailyCallLimit);
    const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(120000), body: JSON.stringify({
      model: input.model, store: false, max_output_tokens: Math.min(5000, input.options?.num_predict || 2500),
      input: input.messages.map((message) => ({ role: message.role === "system" ? "developer" : message.role, content: message.images?.length ? [{ type: "input_text", text: message.content }, ...message.images.map((image) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${image}`, detail: "auto" }))] : message.content })),
      text: { format: { type: "json_schema", name: "marketing_result", strict: true, schema: strictSchema(input.format) } },
    }) });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}.`);
    const value = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    if (value.usage) {
      await db.$transaction(async (tx) => {
        const row = await tx.activityLog.findUnique({ where: { id: usageId } });
        if (row) { const usage = row.metadata as { day: string; calls: number; inputTokens: number; outputTokens: number }; await tx.activityLog.update({ where: { id: usageId }, data: { metadata: { ...usage, inputTokens: usage.inputTokens + (value.usage?.input_tokens || 0), outputTokens: usage.outputTokens + (value.usage?.output_tokens || 0) } } }); }
      }, { isolationLevel: "Serializable" });
    }
    const text = value.output?.filter((item) => item.type === "message").flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
    if (value.status !== "completed" || !text || text.length > 256 * 1024) throw new Error("AI response was incomplete or refused.");
    return { message: { content: text } };
  };
}
