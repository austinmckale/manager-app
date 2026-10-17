// Classifies source evidence. It does not draft marketing copy, and note text
// is never treated as an approval or a command to publish.

export type EvidenceText = string | readonly string[] | null | undefined;

export type EvidenceClaimInput = {
  notes?: EvidenceText;
  photoDescriptions?: EvidenceText;
  transcript?: EvidenceText;
};

export type EvidenceClaimResult = {
  visibleFacts: string[];
  ownerProvidedFacts: string[];
  unsupportedClaims: string[];
  publicationRestrictions: string[];
  missingInformation: string[];
  blocked: boolean;
  canImportMarketingCopy: boolean;
};

const EXACT_RESTRICTION =
  "Reading, PA \u2014 website example\nTEST \u2014 existing website photo used to verify Ryan\u2019s upload link. Paver patio and pavilion. Keep this sample in review; do not publish it again.";

const ATTRIBUTION_GAP = "RHI Pros installed or completed this job";

const MATERIAL =
  /\b(?:pavers?|bluestone|travertine|porcelain|composite|cedar|ipe|teak|marble|granite|flagstone|brick|vinyl|concrete|timber|wood|stone|boards?|planks?)\b/i;

const PRAISE =
  /\b(?:beautiful|gorgeous|stunning|amazing|loved|loves|thrilled|wonderful|awesome|perfect)\b/i;

const PRICE = /\$\s?\d|\b(?:price|priced|cost|costs|charged)\b/i;

const PERMIT = /\b(?:permits?|permitted|inspection|inspected)\b/i;

const TOWN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}\b|\bin\s+(?!the\b|this\b|a\b|an\b|review\b|our\b)[A-Z][a-z]+\b/;

const COMPLETION = /\b(?:installed|completed|finished|built)\b/i;

function textOf(value: EvidenceText): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === "string").join("\n");
  return "";
}

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u2012\u2013\u2014]/g, "-")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = item.trim();
    const key = normalize(cleaned).toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rhiWorkPhrase(text: string): boolean {
  const line = normalize(text);
  return /\brhi\s+pros\b[^.!\n]{0,80}\b(?:installed|completed|built|finished|did)\b/i.test(line)
    || /\b(?:installed|completed|built|finished)\s+by\s+rhi\s+pros\b/i.test(line);
}

function notesSayRhiDidTheWork(notes: string): boolean {
  return sentences(notes).some((sentence) => !isRestriction(sentence) && !isInjection(sentence) && rhiWorkPhrase(sentence));
}

function isInjection(text: string): boolean {
  const line = normalize(text);
  return /ignore\s+(?:all\s+|any\s+|previous\s+|prior\s+)?(?:rules|instructions|prompts)\b/i.test(line)
    || /\b(?:mark|set|treat)\b[^.!\n]{0,40}\b(?:approved|published)\b/i.test(line)
    || /\bapprove\s+(?:this|it)\b/i.test(line);
}

function isPrivacy(text: string): boolean {
  const line = normalize(text);
  return /\b(?:customer|client|homeowner)(?:'s)?\s+name\b/i.test(line)
    || /\b(?:do not|don't|dont|never)\s+share\b/i.test(line);
}

function isRestriction(text: string): boolean {
  const line = normalize(text);
  if (/^TEST\b/i.test(line)) return true;
  if (/\b(?:do not|don't|dont|never|not to)\s+(?:re)?publish\b/i.test(line)) return true;
  if (/\bnot\s+for\s+publication\b/i.test(line) || /\bnon-?publishable\b/i.test(line)) return true;
  if (/\bexisting\s+website\s+(?:photo|image|picture|shot)s?\b/i.test(line)) return true;
  if (/\b(?:photo|image|picture)s?\b[^.!\n]{0,60}\balready\s+on\s+(?:the\s+|our\s+)?website\b/i.test(line)) return true;
  if (/\bre-?us(?:e|ed|ing)\b[^.!\n]{0,80}\b(?:existing\s+)?website\s+(?:photo|image|picture|content)s?\b/i.test(line)) return true;
  if (/\bwebsite\s+(?:photo|image|picture|content)s?\b[^.!\n]{0,80}\bre-?us(?:e|ed|ing)\b/i.test(line)) return true;
  if (/\bmicrophone\s+tests?\b/i.test(line)) return true;
  if (/\btest(?:ing)?\s+(?:ryan's\s+)?upload\b/i.test(line)) return true;
  if (/\btest(?:ing)?\s+the\s+upload\s+link\b/i.test(line)) return true;
  if (/\bthis\s+is\s+a\s+test\b/i.test(line)) return true;
  return false;
}

function isHidden(text: string): boolean {
  const line = normalize(text);
  return /\bhidden\b/i.test(line)
    || /\bnot\s+visible\b/i.test(line)
    || /\b(?:cannot|can't|cant)\s+(?:see|be seen)\b/i.test(line)
    || /\bbehind\s+the\b/i.test(line)
    || /\binside\s+the\s+(?:wall|walls|ceiling|floor)\b/i.test(line);
}

function containsExactRestriction(text: string): boolean {
  return normalize(text).includes(normalize(EXACT_RESTRICTION));
}

function coveredByExactRestriction(sentence: string, combined: string): boolean {
  return containsExactRestriction(combined) && normalize(EXACT_RESTRICTION).includes(normalize(sentence));
}

function isSkipped(sentence: string, combined: string): boolean {
  return isInjection(sentence) || isPrivacy(sentence) || isRestriction(sentence) || coveredByExactRestriction(sentence, combined);
}

function shareBan(text: string): boolean {
  return /\b(?:do not|don't|dont|never)\s+share\b/i.test(normalize(text));
}

function withheldNames(text: string): string[] {
  if (!shareBan(text)) return [];
  const names: string[] = [];
  const labeled = /(?:customer|client|homeowner)(?:'s)?\s+name\s+is\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/gi;
  for (const match of text.matchAll(labeled)) {
    const name = match[1]?.trim();
    if (name && !/^(?:not|private|confidential|hidden|unknown)$/i.test(name)) names.push(name);
  }
  const proper = /\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  const allowed = new Set(["paver", "patio", "pavilion", "reading", "ryan", "rhi", "pros", "website", "photo", "test"]);
  for (const match of text.matchAll(proper)) {
    const name = match[1];
    if (!name || name.split(/\s+/).every((part) => allowed.has(part.toLowerCase()))) continue;
    names.push(name);
  }
  return dedupe(names);
}

function redact(text: string, names: string[]): string {
  let result = text;
  for (const name of names.flatMap((entry) => [entry, ...entry.split(/\s+/)])) {
    if (name.length < 3) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "");
  }
  return result.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

function redactAll(items: string[], names: string[]): string[] {
  return dedupe(items.map((item) => redact(item, names)));
}

function withArticle(phrase: string): string {
  const trimmed = phrase.replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();
  const ready = trimmed.replace(/^(a|an|the)\b/i, (word) => word.toLowerCase());
  if (!ready) return "";
  if (/^(?:a|an|the)\b/i.test(ready)) return ready;
  return `${/^[aeiou]/i.test(ready) ? "an" : "a"} ${ready}`;
}

function visualObject(object: string): string {
  const stripped = object
    .replace(/\b(?:that|which)\s+RHI\s+Pros\b.*$/i, "")
    .replace(/\bRHI\s+Pros\b.*$/i, "")
    .replace(/\b(?:we|our crew)\s+(?:built|installed|completed|finished)\b.*$/i, "")
    .replace(/\b(?:priced|costing|for)\s+\$\s?\d[\d,]*.*$/i, "")
    .replace(PRAISE, "")
    .replace(PERMIT, "")
    .replace(PRICE, "")
    .replace(/\b(?:completed|finished)\b/gi, "")
    .replace(TOWN, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .trim();
  return stripped;
}

function shownFact(object: string): string[] {
  const phrase = withArticle(visualObject(object));
  if (!phrase || isHidden(phrase)) return [];
  return [`The photo shows ${phrase}.`];
}

function explicitVisible(sentence: string): string[] {
  if (isHidden(sentence)) return [];
  const match = sentence.match(/\b(?:photo|picture|image|shot)s?\s+(?:clearly\s+)?(?:shows?|depicts?|captures?|displays?)\s+(.+)/i);
  if (!match?.[1]) return [];
  return shownFact(match[1]);
}

function visualNouns(text: string): string[] {
  return dedupe((text.match(/\b(?:pavilions?|patios?|pavers?|roofs?|ceilings?|posts?|decks?|fences?|pergolas?|porches?|walkways?|driveways?|walls?|floors?|flooring|lights?|boards?|planks?|stones?|railings?|columns?|beams?|trusses?|gutters?|sidings?|shingles?|steps?|stairs?)\b/gi) ?? []).map((word) => word.toLowerCase()));
}

function hasSeparateClaim(sentence: string): boolean {
  return rhiWorkPhrase(sentence)
    || /\bRHI\s+Pros\b/i.test(sentence)
    || PRAISE.test(sentence)
    || PRICE.test(sentence)
    || PERMIT.test(sentence)
    || TOWN.test(sentence)
    || /\b(?:completed|finished)\b/i.test(sentence);
}

function visibleFromPhoto(sentence: string): string[] {
  const explicit = explicitVisible(sentence);
  if (explicit.length) return explicit;
  if (isHidden(sentence)) return [];
  if (!hasSeparateClaim(sentence)) {
    const caption = visualObject(sentence);
    if (caption) return [`The photo shows ${withArticle(caption)}.`];
  }
  const nouns = visualNouns(sentence);
  if (!nouns.length) return [];
  return [`The photo shows ${withArticle(nouns.join(" and "))}.`];
}

function isOwnerAssertion(sentence: string): boolean {
  if (/^(?:please\s+)?(?:ignore|approve|mark)\b/i.test(sentence)) return false;
  return COMPLETION.test(sentence)
    || /\b(?:is|are|was|were|laid|set|used|ran|framed|stained|has|have|had|did|put|poured|hung|wired)\b/i.test(sentence)
    || TOWN.test(sentence)
    || MATERIAL.test(sentence)
    || PRAISE.test(sentence)
    || PRICE.test(sentence)
    || PERMIT.test(sentence);
}

function ownerStatement(sentence: string, source: "notes" | "transcript", notes: string): string[] {
  if (explicitVisible(sentence).length && !isHidden(sentence)) return [];
  if (source === "transcript" && rhiWorkPhrase(sentence) && !notesSayRhiDidTheWork(notes)) return [];
  if (!isHidden(sentence) && !isOwnerAssertion(sentence)) return [];
  return [sentence];
}

function claimSentences(sentence: string, notes: string, transcript: string): string[] {
  const owner = `${notes}\n${transcript}`;
  const claims: string[] = [];
  if ((/\bRHI\s+Pros\b/i.test(sentence) || rhiWorkPhrase(sentence)) && !notesSayRhiDidTheWork(notes)) claims.push(sentence);
  if (PRAISE.test(sentence) && !PRAISE.test(owner)) claims.push(sentence);
  if (PRICE.test(sentence) && !PRICE.test(owner)) claims.push(sentence);
  if (PERMIT.test(sentence) && !PERMIT.test(owner)) claims.push(sentence);
  if (TOWN.test(sentence) && !TOWN.test(owner)) claims.push(sentence);
  if (/\b(?:completed|finished)\b/i.test(sentence) && !COMPLETION.test(owner)) claims.push(sentence);
  if (/\b(?:bluestone|travertine|porcelain|composite|cedar|ipe|teak|marble|granite|flagstone)\b/i.test(sentence) && !MATERIAL.test(owner)) claims.push(sentence);
  return claims;
}

function usable(text: string, combined: string): string[] {
  return sentences(text).filter((sentence) => !isSkipped(sentence, combined));
}

function collectRestrictions(notes: string, photoDescriptions: string, transcript: string): string[] {
  const combined = [notes, photoDescriptions, transcript].filter((part) => part.trim()).join("\n");
  const found: string[] = [];
  if (containsExactRestriction(combined)) found.push(EXACT_RESTRICTION);
  for (const sentence of sentences(combined)) {
    if (coveredByExactRestriction(sentence, combined)) continue;
    if (isRestriction(sentence)) found.push(sentence);
  }
  return dedupe(found);
}

function missingQuestions(input: { notes: string; transcript: string; combined: string; visibleFacts: string[]; ownerProvidedFacts: string[]; names: string[] }): string[] {
  const project = input.visibleFacts.length > 0 || input.ownerProvidedFacts.length > 0;
  const ownerText = `${input.notes}\n${input.transcript}`;
  const questions: string[] = [];
  if (!input.visibleFacts.length) questions.push("What does the photo show?");
  if (!project) questions.push("What work was done?");
  if (project && !notesSayRhiDidTheWork(input.notes)) questions.push("Did RHI Pros install or complete this work?");
  if (project && !TOWN.test(ownerText)) questions.push("Which town is this project in?");
  if (project && !COMPLETION.test(ownerText)) questions.push("Is the work finished?");
  const materialSource = `${ownerText}\n${input.visibleFacts.join("\n")}`;
  if (project && !MATERIAL.test(materialSource)) questions.push("What materials were used?");
  if (input.names.length || shareBan(input.combined)) questions.push("What can be said publicly without the customer name?");
  return dedupe(questions);
}

export function classifyEvidence(input: EvidenceClaimInput = {}): EvidenceClaimResult {
  const notes = textOf(input?.notes);
  const photoDescriptions = textOf(input?.photoDescriptions);
  const transcript = textOf(input?.transcript);
  const combined = [notes, photoDescriptions, transcript].filter((part) => part.trim()).join("\n");
  const names = withheldNames(combined);
  const publicationRestrictions = redactAll(collectRestrictions(notes, photoDescriptions, transcript), names);
  const blocked = publicationRestrictions.length > 0;
  const visibleFacts = redactAll([
    ...usable(notes, combined).flatMap(explicitVisible),
    ...usable(photoDescriptions, combined).flatMap(visibleFromPhoto),
    ...usable(transcript, combined).flatMap(explicitVisible),
  ], names);
  const ownerProvidedFacts = redactAll([
    ...usable(notes, combined).flatMap((sentence) => ownerStatement(sentence, "notes", notes)),
    ...usable(transcript, combined).flatMap((sentence) => ownerStatement(sentence, "transcript", notes)),
  ], names);
  const unsupported = [
    ...usable(photoDescriptions, combined).flatMap((sentence) => claimSentences(sentence, notes, transcript)),
    ...usable(transcript, combined).flatMap((sentence) => (rhiWorkPhrase(sentence) && !notesSayRhiDidTheWork(notes) ? [sentence] : [])),
  ];
  if ((visibleFacts.length > 0 || ownerProvidedFacts.length > 0) && !notesSayRhiDidTheWork(notes)) unsupported.push(ATTRIBUTION_GAP);
  const unsupportedClaims = redactAll(unsupported, names);
  const missingInformation = blocked && visibleFacts.length === 0 && ownerProvidedFacts.length === 0
    ? []
    : missingQuestions({ notes, transcript, combined, visibleFacts, ownerProvidedFacts, names });
  return {
    visibleFacts,
    ownerProvidedFacts,
    unsupportedClaims,
    publicationRestrictions,
    missingInformation,
    blocked,
    canImportMarketingCopy: !blocked,
  };
}
