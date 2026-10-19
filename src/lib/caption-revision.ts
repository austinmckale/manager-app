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

/** Every public caption a draft has. The owner can keep (lock) any of them before regenerating. */
export const CAPTION_FIELDS = ["social", "googleBusiness", "metaPrimary", "metaHeadline", "imageHeadline", "googleHeadlines", "googleDescriptions", "publicLocation", "service"] as const;
export type CaptionField = (typeof CAPTION_FIELDS)[number];
export const captionFieldSchema = z.enum(CAPTION_FIELDS);
export const captionValuesSchema = z.object({
  social: z.string().max(2200), googleBusiness: z.string().max(1500), metaPrimary: z.string().max(2200), metaHeadline: z.string().max(40), imageHeadline: z.string().max(60),
  googleHeadlines: z.array(z.string().min(1).max(30)).min(3).max(15), googleDescriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
  publicLocation: z.string().max(100), service: z.string().max(100),
}).partial().strict();
export type CaptionValues = z.infer<typeof captionValuesSchema>;

/** "Regenerate unlocked captions": the kept captions are sent as fixed context and never rewritten. */
export const captionRegenerateBodySchema = z
  .object({ draftId: draftIdSchema, inputHash: inputHashSchema, mode: z.literal("regenerate"), locked: captionValuesSchema, note: z.string().trim().max(300).default("") })
  .strict();
export function regenerateInstruction(note: string) {
  return `Regenerate the unlocked captions${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 400);
}

export const CAPTION_LOCKS_ACTION = "marketing.caption.locks";
export const captionLocksSchema = z.object({ draftId: draftIdSchema, fields: z.array(captionFieldSchema).max(CAPTION_FIELDS.length) });
export function captionLocksId(orgId: string, draftId: string) {
  const hex = createHash("sha256").update(`rhi-caption-locks-v1:${orgId}:${draftId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function captionRevisionId(orgId: string, draftId: string, inputHash: string, instruction: string, variant = "") {
  const hex = createHash("sha256").update(`rhi-caption-revision-v1:${orgId}:${draftId}:${inputHash}:${instruction.trim()}${variant ? `:${variant}` : ""}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export const captionRevisionSchema = z.object({
  draftId: draftIdSchema,
  inputHash: inputHashSchema,
  instruction: instructionSchema,
  status: z.enum(["queued", "running", "ready", "failed", "stale"]).default("queued"),
  social: z.string().max(2200).default(""),
  googleBusiness: z.string().max(1500).default(""),
  // Regenerate requests: the kept captions, the new text for the rest, and how many problems the fact-check still found.
  mode: z.enum(["caption", "regenerate"]).default("caption"),
  locked: captionValuesSchema.default({}),
  proposal: captionValuesSchema.default({}),
  remaining: z.number().int().min(0).nullable().default(null),
  requestedAt: z.string().default(""),
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
