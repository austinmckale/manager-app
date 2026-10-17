import { createHash } from "node:crypto";
import { z } from "zod";

export const RAW_INPUT_ACTION = "marketing.raw.input";
/** Matches the voice length already accepted by evidence checks. */
export const RAW_TEXT_LIMIT = 180_000;

export const rawInputSchema = z.object({
  version: z.literal(1),
  inviteId: z.string().uuid(),
  submissionId: z.string().uuid(),
  draftId: z.string().uuid(),
  location: z.string().max(500).default(""),
  typedNote: z.string().max(RAW_TEXT_LIMIT).default(""),
  transcript: z.string().max(RAW_TEXT_LIMIT).default(""),
  transcriptTruncated: z.boolean().default(false),
  photoIds: z.array(z.string().uuid()).max(24),
}).strict();

export type RawInput = z.infer<typeof rawInputSchema>;

export function rawInputId(orgId: string, submissionId: string) {
  const hex = createHash("sha256").update(`rhi-raw-input-v1:${orgId}:${submissionId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function keepRawText(text: string) {
  const trimmed = text.trim();
  return { text: trimmed.slice(0, RAW_TEXT_LIMIT), truncated: trimmed.length > RAW_TEXT_LIMIT };
}

export function buildRawInput(input: { inviteId: string; submissionId: string; draftId: string; location?: string; typedNote?: string; transcript?: string; photoIds: string[] }): RawInput {
  const transcript = keepRawText(input.transcript ?? "");
  const typedNote = keepRawText(input.typedNote ?? "");
  return rawInputSchema.parse({
    version: 1,
    inviteId: input.inviteId,
    submissionId: input.submissionId,
    draftId: input.draftId,
    location: (input.location ?? "").slice(0, 500),
    typedNote: typedNote.text,
    transcript: transcript.text,
    transcriptTruncated: transcript.truncated,
    photoIds: input.photoIds,
  });
}
