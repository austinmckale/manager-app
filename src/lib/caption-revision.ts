import { createHash } from "node:crypto";
import { z } from "zod";

export const CAPTION_REVISION_ACTION = "marketing.caption.revision";

const draftIdSchema = z.string().uuid();
const inputHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const instructionSchema = z.string().trim().min(1).max(400);

export const captionRevisionBodySchema = z
  .object({
    draftId: draftIdSchema,
    inputHash: inputHashSchema,
    instruction: instructionSchema,
  })
  .strict();

export function captionRevisionId(orgId: string, draftId: string, inputHash: string, instruction: string) {
  const hex = createHash("sha256").update(`rhi-caption-revision-v1:${orgId}:${draftId}:${inputHash}:${instruction.trim()}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export const captionRevisionSchema = z.object({
  draftId: draftIdSchema,
  inputHash: inputHashSchema,
  instruction: instructionSchema,
  status: z.enum(["queued", "running", "ready", "failed", "stale"]).default("queued"),
  social: z.string().max(2200).default(""),
  googleBusiness: z.string().max(1500).default(""),
  error: z.string().nullable(),
  approved: z.literal(false),
  published: z.literal(false),
});

export function emptyRevision(draftId: string, inputHash: string, instruction: string) {
  return captionRevisionSchema.parse({
    draftId,
    inputHash,
    instruction,
    error: null,
    approved: false,
    published: false,
  });
}
