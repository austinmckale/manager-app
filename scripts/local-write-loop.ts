import { z } from "zod";
import { auditDraft } from "./local-evidence-pipeline";
import { evidenceFacts, type MarketingEvidence } from "../src/lib/marketing-evidence";
import type { localReviewRequest } from "./local-review-request";

type RequestAI = typeof localReviewRequest;
type Message = { role: string; content: string; images?: string[] };
type Checked<T> = { copy: T; issues: string[] };

export type WriteLoopPlan = { candidates: number; fixRounds: number };

// Local calls are free, so write two versions and keep the better one. Paid (hybrid) calls write one.
// Either way the fact-check's findings go back to the writer for up to two fix rounds before a hold.
export function writeLoopPlan(mode: "hybrid" | "local"): WriteLoopPlan {
  return mode === "local" ? { candidates: 2, fixRounds: 2 } : { candidates: 1, fixRounds: 2 };
}

// These come from the checker not doing its job, not from the copy. Check again instead of rewriting.
const checkerOnly = (issue: string) => /the reviewer (did not check the exact current text|cited evidence that does not exist)/.test(issue);

const SCHEMA_RETRY = "The output did not match the schema. Regenerate valid JSON, keeping headlines under 25 characters and descriptions under 80 characters.";
const FIX_TASK = "A separate fact-check found these problems in previousDraft. Return the complete pack again. Fix every listed problem. If a claim is not supported by the facts, remove it instead of rewording it. Keep the parts that had no problem.";

/**
 * Writes the pack, fact-checks it in a separate pass, and feeds the findings back to the writer.
 * Returns the draft with the fewest problems; the caller holds it for the owner when problems remain.
 */
export async function writeCheckedCopy<T extends Record<string, unknown>>(input: {
  request: RequestAI;
  model: string;
  system: string;
  evidence: MarketingEvidence;
  schema: z.ZodType<T>;
  complete: (copy: T) => boolean;
  options: Record<string, unknown>;
  plan: WriteLoopPlan;
  audit?: typeof auditDraft;
}) {
  const audit = input.audit ?? auditDraft;
  const facts = evidenceFacts(input.evidence);
  let writes = 0;
  let checks = 0;

  async function write(task: Record<string, unknown>, temperature: number): Promise<T | undefined> {
    const messages: Message[] = [
      { role: "system", content: input.system },
      { role: "user", content: JSON.stringify({ postType: input.evidence.postType, facts, ...task }) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      writes++;
      const result = await input.request({ model: input.model, messages, stream: false, think: false, format: z.toJSONSchema(input.schema), options: { ...input.options, temperature }, keep_alive: "5m" });
      try {
        const candidate = input.schema.parse(JSON.parse(result.message?.content || ""));
        if (!input.complete(candidate)) throw new Error("Incomplete copy needs review.");
        return candidate;
      } catch {
        messages.push({ role: "assistant", content: result.message?.content || "" }, { role: "user", content: SCHEMA_RETRY });
      }
    }
    return undefined;
  }

  async function check(copy: T): Promise<Checked<T>> {
    checks++;
    const { issues } = await audit(input.model, copy, input.evidence, input.request);
    return { copy, issues };
  }

  const keepBetter = (best: Checked<T> | undefined, next: Checked<T>) => (!best || next.issues.length <= best.issues.length ? next : best);

  let best: Checked<T> | undefined;
  const firstTask = { task: "Write the marketing pack from these facts. Do not include private source quotes verbatim when unsuitable for public copy." };
  const temperatures = [0.4, 0.75];
  for (let index = 0; index < input.plan.candidates && !(best && best.issues.length === 0); index++) {
    const copy = await write(firstTask, temperatures[index % temperatures.length]);
    if (copy) best = keepBetter(best, await check(copy));
  }

  for (let round = 0; best && best.issues.length && round < input.plan.fixRounds; round++) {
    if (best.issues.every(checkerOnly)) {
      best = keepBetter(best, await check(best.copy));
      continue;
    }
    const fixed = await write({ previousDraft: best.copy, problems: best.issues.filter((issue) => !checkerOnly(issue)), task: FIX_TASK }, 0.3);
    if (fixed) best = keepBetter(best, await check(fixed));
  }

  if (!best) throw new Error("Local output needs review; no pack was released.");
  return { ...best, writes, checks };
}
