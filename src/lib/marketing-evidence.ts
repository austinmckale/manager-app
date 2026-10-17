import { z } from "zod";

export const GENERATION_ACTION = "marketing.generation.job";
export const postTypeSchema = z.enum(["project", "company_life"]);
export const photoEvidenceSchema = z.object({
  assetId: z.string().uuid(),
  relevance: z.enum(["construction", "company_life", "unrelated", "unclear"]),
  observations: z.array(z.string().min(1).max(400)).max(12),
  concerns: z.array(z.string().min(1).max(400)).max(8),
});
export const noteEvidenceSchema = z.object({
  facts: z.array(z.object({ source: z.enum(["notes", "voice", "owner"]), quote: z.string().min(1).max(500), fact: z.string().min(1).max(500) })).max(30),
  conflicts: z.array(z.string().min(1).max(400)).max(10),
});
export const evidenceSchema = z.object({
  version: z.literal(1),
  postType: postTypeSchema,
  photos: z.array(photoEvidenceSchema).min(1).max(24),
  notes: noteEvidenceSchema,
  reasons: z.array(z.string().min(1).max(800)).max(40),
});
export type MarketingEvidence = z.infer<typeof evidenceSchema>;
export type EvidenceSources = { notes: string; voice: string; owner: string };
export const generationRecordSchema = z.object({
  inviteId: z.string().uuid(), submissionId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "held"]),
  attempts: z.number().int().nonnegative(), runningAt: z.string().nullable(), nextRetryAt: z.string().nullable(), error: z.string().max(200).nullable(),
  ownerNotes: z.string().max(6000).default(""), postType: postTypeSchema.default("project"),
  evidence: evidenceSchema.optional(), issues: z.array(z.string().max(1000)).max(80).optional(),
  checkedFields: z.record(z.string(), z.string()).optional(),
});

// Quotes are anchored in immutable sources. Model-written summaries are never
// promoted to source facts: the writer gets the exact quote instead.
export function verifiedNoteFacts(notes: z.infer<typeof noteEvidenceSchema>, sources: EvidenceSources) {
  return notes.facts.filter((fact) => sources[fact.source].includes(fact.quote));
}
export function assessEvidence(input: { postType: z.infer<typeof postTypeSchema>; photos: z.infer<typeof photoEvidenceSchema>[]; notes: z.infer<typeof noteEvidenceSchema>; sources: EvidenceSources; assetIds: string[]; voicePending?: boolean }): MarketingEvidence {
  const reasons: string[] = [];
  const photos = input.photos.map((photo) => photoEvidenceSchema.parse(photo));
  if (input.voicePending) reasons.push("Wait for the voice recording to finish transcription.");
  if (new Set(photos.map((photo) => photo.assetId)).size !== input.assetIds.length || photos.length !== input.assetIds.length || input.assetIds.some((id) => !photos.some((photo) => photo.assetId === id))) reasons.push("Every selected photo must be inspected before drafting.");
  for (const photo of photos) {
    if (photo.relevance !== "construction" && !(input.postType === "company_life" && photo.relevance === "company_life")) reasons.push(`Photo ${photo.assetId}: add a relevant photo or explain its connection to the intended post.`);
    reasons.push(...photo.concerns.map((concern) => `Photo ${photo.assetId}: ${concern}`));
  }
  reasons.push(...input.notes.conflicts);
  const facts = verifiedNoteFacts(input.notes, input.sources);
  if (facts.length !== input.notes.facts.length) reasons.push("Some extracted facts could not be traced to the original notes. Check the notes and retry.");
  if (input.postType === "company_life" && !input.sources.owner.trim()) reasons.push("Describe the intended company-personality post in the owner notes.");
  if (!facts.length && !photos.some((photo) => photo.relevance === "construction" && photo.observations.length)) reasons.push("No usable project facts were supplied. Add job details or choose a company-personality post and explain the photo.");
  return evidenceSchema.parse({ version: 1, postType: input.postType, photos, notes: { ...input.notes, facts }, reasons: reasons.slice(0, 40) });
}
export function evidenceFacts(evidence: MarketingEvidence) {
  return [
    ...evidence.photos.flatMap((photo) => photo.observations.map((text, index) => ({ id: `photo:${photo.assetId}:${index}`, source: "photo", text }))),
    ...evidence.notes.facts.map((fact, index) => ({ id: `note:${index}`, source: fact.source, text: fact.quote })),
  ];
}
export const claimAuditSchema = z.object({
  fields: z.array(z.object({ field: z.string().min(1).max(80), text: z.string().max(2200), supported: z.boolean(), factIds: z.array(z.string().max(100)).max(30), issues: z.array(z.string().min(1).max(500)).max(8) })).max(40),
});
export function publicFields(copy: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(copy).filter(([key]) => !["sourceNotes", "photoNotes", "assetIds", "packName", "landingUrl", "postType"].includes(key)).flatMap(([key, value]) => Array.isArray(value) ? value.map((text, index) => [`${key}.${index}`, String(text)]) : [[key, String(value)]]));
}
export function checkedFieldsMatch(copy: Record<string, unknown>, checked?: Record<string, string>) {
  const fields = publicFields(copy);
  return !!checked && Object.keys(fields).length === Object.keys(checked).length && Object.entries(fields).every(([key, value]) => checked[key] === value);
}
export function auditIssues(copy: Record<string, unknown>, evidence: MarketingEvidence, audit: z.infer<typeof claimAuditSchema>) {
  const facts = new Set(evidenceFacts(evidence).map((fact) => fact.id));
  const issues = [...evidence.reasons];
  for (const [field, text] of Object.entries(publicFields(copy))) {
    const checks = audit.fields.filter((check) => check.field === field);
    if (checks.length !== 1 || checks[0].text !== text) { issues.push(`${field}: the reviewer did not check the exact current text.`); continue; }
    const check = checks[0];
    if (!check.supported || check.issues.length) issues.push(`${field}: ${check.issues.join(" ") || "Unsupported claim or unsuitable copy."}`);
    if (check.factIds.some((id) => !facts.has(id))) issues.push(`${field}: the reviewer cited evidence that does not exist.`);
    if (text.trim() && !check.factIds.length) issues.push(`${field}: no source evidence was linked to this copy.`);
  }
  return [...new Set(issues)];
}
