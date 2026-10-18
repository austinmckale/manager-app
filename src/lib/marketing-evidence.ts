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
  sources: z.object({ notes: z.string().max(12000), voice: z.string().max(180000), owner: z.string().max(6000) }),
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

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Upload tests, microphone checks and approval commands are not job facts.
function isUsableQuote(quote: string) {
  return !/ignore\s+(?:all\s+|any\s+|previous\s+|prior\s+)?instructions|mark\s+(?:this\s+|it\s+)?approved|(?:do not|don't)\s+publish|existing website photo|test the upload|upload link|microphone test|\btesting testing\b/i.test(quote);
}
function shortEvidenceText(text: string) {
  return text.replace(uuidPattern, "").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim().slice(0, 160);
}
function capEvidenceLines(items: string[]) {
  const lines: string[] = [];
  for (const item of items) {
    const line = shortEvidenceText(item);
    if (!line || lines.includes(line)) continue;
    lines.push(line);
    if (lines.length === 8) break;
  }
  return lines;
}
// Quotes are anchored in immutable sources. Model-written summaries are never
// promoted to source facts: the writer gets the exact quote instead.
export function verifiedNoteFacts(notes: z.infer<typeof noteEvidenceSchema>, sources: EvidenceSources) {
  return notes.facts.filter((fact) => sources[fact.source].includes(fact.quote));
}
// Same rule as cosmeticFinding in review-findings.ts. Kept in this file so the
// evidence checks can load it with zod alone. A finished patio, a missing logo,
// and a voice note that is not on the photo are not publish blocks.
const cosmeticWithhold = /^TEST\b|do\s+not\s+publish|don['’]t\s+publish|not\s+for\s+publication|microphone\s+test/im;
const cosmeticKeptBlock = /\bRHI\b|\baddress\b|\bemail\b|\bphone\b|\bcontradict|\bconflicts?\b|\bdisagree|\bwho built\b|\bunsupported claim\b|\bneeds details\b/i;
const cosmeticPatterns = [
  /\bwork appears complete\b/i,
  /\bno\b[^.]{0,180}\bunfinished elements\b/i,
  /\bno\b[^.]{0,180}\bconstruction equipment\b/i,
  /\bno\b[^.]{0,180}\bbranding\b/i,
  /\bno\b[^.]{0,80}\blogos?\b/i,
  /\b(?:company name|ownership)\b[^.]{0,80}\bnot visible\b/i,
  /\bno\b[^.]{0,180}\b(?:company name|project ownership)\b/i,
  /\b(?:voice|notes?|messages?)\b[^.]{0,220}\b(?:do not|don['’]t|does not|doesn['’]t) appear in the (?:image|photo)\b/i,
  /\brelevant photo\b/i,
  /\bunrelated to construction\b/i,
  /\bno visible construction activity\b/i,
  /\bdoes not indicate that our company built\b/i,
  /\bunrelated to the visual content\b/i,
];
function cosmeticFinding(detail: string) {
  if (cosmeticWithhold.test(detail) || cosmeticKeptBlock.test(detail)) return false;
  const text = detail.replace(/\s+/g, " ");
  return cosmeticPatterns.some((pattern) => pattern.test(text));
}
export function assessEvidence(input: { postType: z.infer<typeof postTypeSchema>; photos: z.infer<typeof photoEvidenceSchema>[]; notes: z.infer<typeof noteEvidenceSchema>; sources: EvidenceSources; assetIds: string[]; voicePending?: boolean }): MarketingEvidence {
  const reasons: string[] = [];
  const photos = input.photos.map((photo) => photoEvidenceSchema.parse(photo));
  if (input.voicePending) reasons.push("Wait for the voice recording to finish transcription.");
  if (new Set(photos.map((photo) => photo.assetId)).size !== input.assetIds.length || photos.length !== input.assetIds.length || input.assetIds.some((id) => !photos.some((photo) => photo.assetId === id))) reasons.push("Every selected photo must be inspected before drafting.");
  for (const photo of photos) {
    reasons.push(...photo.concerns.map((concern) => `Photo ${photo.assetId}: ${concern}`).filter((line) => !cosmeticFinding(line)));
  }
  reasons.push(...input.notes.conflicts);
  const traced = verifiedNoteFacts(input.notes, input.sources);
  if (traced.length !== input.notes.facts.length) reasons.push("Some extracted facts could not be traced to the original notes. Check the notes and retry.");
  const facts = traced.filter((fact) => isUsableQuote(fact.quote));
  if (input.postType === "company_life" && !input.sources.owner.trim()) reasons.push("Describe the intended company-personality post in the owner notes.");
  const hasProjectPhoto = photos.some((photo) => photo.relevance === "construction");
  if (input.postType === "project" && facts.length === 0 && !hasProjectPhoto) reasons.push("Needs details: these photos and notes do not establish a project.");
  return evidenceSchema.parse({ version: 1, sources: input.sources, postType: input.postType, photos, notes: { ...input.notes, facts }, reasons: reasons.slice(0, 40) });
}
export function classifyEvidence(evidence: MarketingEvidence) {
  const visual: string[] = [];
  const concerns: string[] = [];
  const unrelated: string[] = [];
  for (const photo of evidence.photos) {
    concerns.push(...photo.concerns);
    if (photo.relevance === "construction" || photo.relevance === "company_life") visual.push(...photo.observations);
    else unrelated.push(...photo.observations);
  }
  const claimed = verifiedNoteFacts(evidence.notes, evidence.sources).filter((fact) => isUsableQuote(fact.quote)).map((fact) => fact.quote);
  return { visual: capEvidenceLines(visual), claimed: capEvidenceLines(claimed), unsupported: capEvidenceLines([...concerns, ...evidence.notes.conflicts, ...unrelated]) };
}
type NoteRead = z.infer<typeof noteEvidenceSchema>;
type PhotoRead = z.infer<typeof photoEvidenceSchema>;

// Two independent reads. A quoted fact from either read is kept when the quote
// is really in the source, so a thin first read does not throw away a later one.
// Observations are kept only when both looks agree on what the photo is.
export function mergeNoteReads(reads: NoteRead[], sources: EvidenceSources): NoteRead {
  const facts: NoteRead["facts"] = [];
  const seen = new Set<string>();
  for (const read of reads) {
    for (const fact of read.facts) {
      if (!sources[fact.source].includes(fact.quote)) continue;
      const key = `${fact.source}:${fact.quote.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(fact);
    }
  }
  const conflicts = [...new Set(reads.flatMap((read) => read.conflicts.map((conflict) => conflict.trim())).filter(Boolean))].slice(0, 3);
  return noteEvidenceSchema.parse({ facts: facts.slice(0, 30), conflicts });
}
export function mergePhotoReads(first: PhotoRead, second: PhotoRead): PhotoRead {
  const concerns = [...new Set([...first.concerns, ...second.concerns].map((item) => item.trim()).filter(Boolean))].slice(0, 4);
  if (first.assetId !== second.assetId || first.relevance !== second.relevance) {
    return photoEvidenceSchema.parse({ assetId: first.assetId, relevance: "unclear", observations: [], concerns });
  }
  const observations = [...new Set([...first.observations, ...second.observations].map((item) => item.trim()).filter(Boolean))].slice(0, 12);
  return photoEvidenceSchema.parse({ assetId: first.assetId, relevance: first.relevance, observations, concerns });
}
export function plainGaps(findings: { detail: string }[]) {
  const lines: string[] = [];
  for (const finding of findings) {
    const detail = finding.detail.replace(/\s+/g, " ").trim();
    const line = /finish transcription/i.test(detail) ? "Wait for the voice transcript."
      : /no usable project facts/i.test(detail) ? "Add what work was done."
      : /unrelated|relevant photo|does not match/i.test(detail) ? "The note does not match these photos."
      : /email/i.test(detail) ? "Remove the email from the public text."
      : /owner notes/i.test(detail) ? "Add what this company photo is for."
      : detail.replace(/Photo [0-9a-f-]{36}:\s*/i, "").slice(0, 90);
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines.slice(0, 5);
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
  const issues = evidence.reasons.filter((reason) => !cosmeticFinding(reason));
  for (const [field, text] of Object.entries(publicFields(copy))) {
    const checks = audit.fields.filter((check) => check.field === field);
    if (checks.length !== 1 || checks[0].text !== text) { issues.push(`${field}: the reviewer did not check the exact current text.`); continue; }
    const check = checks[0];
    const reported = check.issues.filter((issue) => !cosmeticFinding(issue));
    if ((!check.supported || reported.length) && (reported.length || check.issues.length === 0)) issues.push(`${field}: ${reported.join(" ") || "Unsupported claim or unsuitable copy."}`);
    if (check.factIds.some((id) => !facts.has(id))) issues.push(`${field}: the reviewer cited evidence that does not exist.`);
    if (text.trim() && !check.factIds.length) issues.push(`${field}: no source evidence was linked to this copy.`);
  }
  return [...new Set(issues)];
}
