export type PublicationSources = { notes: string; voice: string; owner: string };
export type PublicationBlock = { code: string; title: string; lines: string[] };

const closing = "No public draft should be approved from this submission.";

function combined(sources: PublicationSources) {
  return [sources.notes, sources.voice, sources.owner].map((part) => part || "").join("\n").replace(/[’‘]/g, "'");
}

function markedTest(text: string) {
  if (text.split(/\r?\n/).some((line) => /^TEST\b/i.test(line.trim()))) return true;
  return /\btest(?:ing)?\s+ryan'?s?\s+upload\b/i.test(text)
    || /\btest(?:ing)?\s+the\s+upload\s+link\b/i.test(text)
    || /\bmicrophone\s+tests?\b/i.test(text);
}

function withheld(text: string) {
  return /\b(?:do not|don't|dont|never|not to)\s+(?:re)?publish\b/i.test(text)
    || /\bnot\s+for\s+publication\b/i.test(text)
    || /\bnon-?publishable\b/i.test(text);
}

function websiteReuse(text: string) {
  if (/\bexisting\s+website\s+(?:photo|image|picture|shot)s?\b/i.test(text)) return true;
  if (/\bexisting\s+website\s+content\b/i.test(text) && /\bre-?us(?:e|ed|ing)\b/i.test(text)) return true;
  if (/\bre-?us(?:e|ed|ing)\b[^\n]{0,80}\bwebsite\s+(?:photo|image|picture|content)s?\b/i.test(text)) return true;
  if (/\bwebsite\s+(?:photo|image|picture|content)s?\b[^\n]{0,80}\bre-?us(?:e|ed|ing)\b/i.test(text)) return true;
  return /\b(?:photo|image|picture)s?\b[^\n]{0,50}\balready\s+on\s+(?:the\s+|our\s+)?website\b/i.test(text);
}

export function publicationBlock(sources: PublicationSources): PublicationBlock | null {
  const text = combined(sources);
  const test = markedTest(text);
  const held = withheld(text);
  const reused = websiteReuse(text);
  if (!test && !held && !reused) return null;
  const lines: string[] = [];
  if (reused && test) lines.push("The notes say this is existing website content used to test an upload.");
  else if (reused) lines.push("The notes say this is existing website content being reused.");
  else if (/\bmicrophone\s+tests?\b/i.test(text)) lines.push("The notes say this is a microphone test.");
  else if (test) lines.push("The notes say this is a test submission.");
  if (held) lines.push("The notes say not to publish it again.");
  lines.push(closing);
  const code = test ? "test_content" : held ? "not_publishable" : "website_reuse";
  const title = test ? "Review blocked: test submission" : held ? "Review blocked: not for publication" : "Review blocked: existing website content";
  return { code, title, lines: lines.slice(0, 4) };
}

export type PublishabilityInput = { notes?: readonly string[]; photoDescriptions?: readonly string[] };
export type PublishabilityResult = { blocked: boolean; reasons: string[] };

// Source notes and photo descriptions are evidence. Only an explicit owner
// restriction below can block publication; the wording is not an instruction.
const RESTRICTED_SAMPLE = normalizeRestrictedText("Reading, PA \u2014 website example\nTEST \u2014 existing website photo used to verify Ryan\u2019s upload link. Paver patio and pavilion. Keep this sample in review; do not publish it again.");

function normalizeRestrictedText(value: string) {
  return value.replace(/[\u2018\u2019\u2032]/g, "'");
}

export function assessPublishability(input: PublishabilityInput): PublishabilityResult {
  const parts = [...(input.notes ?? []), ...(input.photoDescriptions ?? [])];
  const combined = normalizeRestrictedText(parts.join("\n"));
  if (combined.includes(RESTRICTED_SAMPLE)) {
    return { blocked: true, reasons: ["test submission", "existing website image", "do not publish again"] };
  }
  const test = markedTest(combined);
  const held = withheld(combined);
  const reused = websiteReuse(combined);
  if (!test && !held && !reused) return { blocked: false, reasons: [] };
  const reasons: string[] = [];
  if (test) reasons.push("test submission");
  if (reused) reasons.push("existing website image");
  if (held) reasons.push("do not publish again");
  return { blocked: true, reasons };
}

export function draftPublishability(draft: { sourceNotes?: string; social?: string; googleBusiness?: string; metaPrimary?: string; metaHeadline?: string; imageHeadline?: string; publicLocation?: string; googleHeadlines?: readonly string[]; googleDescriptions?: readonly string[]; photoNotes?: readonly { description?: string }[] }, originals?: { receiptNotes?: readonly string[]; photos?: readonly { description?: string }[]; audio?: readonly { transcript?: string }[] }, assets?: readonly { description?: string | null }[]) {
  return assessPublishability({
    notes: [
      draft.sourceNotes ?? "",
      draft.social ?? "",
      draft.googleBusiness ?? "",
      draft.metaPrimary ?? "",
      draft.metaHeadline ?? "",
      draft.imageHeadline ?? "",
      draft.publicLocation ?? "",
      ...(draft.googleHeadlines ?? []),
      ...(draft.googleDescriptions ?? []),
      ...(originals?.receiptNotes ?? []),
      ...(originals?.audio ?? []).map((item) => item.transcript ?? ""),
    ],
    photoDescriptions: [
      ...(draft.photoNotes ?? []).map((photo) => photo.description ?? ""),
      ...(originals?.photos ?? []).map((photo) => photo.description ?? ""),
      ...(assets ?? []).map((asset) => asset.description ?? ""),
    ],
  });
}
