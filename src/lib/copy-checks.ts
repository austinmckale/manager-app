import { marketingDraftSchema, type MarketingDraft } from "@/lib/marketing";
import { cosmeticFinding } from "@/lib/review-findings";

export type CopyFinding = { category: "facts" | "privacy" | "copy" | "images"; severity: "blocker" | "warning"; detail: string; evidence: string; suggestion: string };

const danglingEnding = /\b(?:in|and|or|with|the|a|to|for|of)$/i;
const workClaim = /\b(?:we|our crew|RHI Pros)\b.{0,40}\b(?:built|installed|completed|finished)\b/i;
const workNote = /\b(?:we|our|built|installed|completed)\b/i;
const templateCta = "Planning a project of your own? Contact RHI Pros.";

function endsMidToken(value: string) {
  const text = value.trim();
  if (/[-–—]$/.test(text)) return true;
  const last = (text.split(/\s+/).pop() ?? "").replace(/[.,!?;:]+$/g, "");
  const word = last.replace(/[^A-Za-z]/g, "");
  if (!word) return false;
  if (word.length === 1) return !/^[AI]$/i.test(word);
  if (word === word.toUpperCase()) return false;
  if (!/[aeiouy]/i.test(word)) return true;
  return /[a-z]{4,}i$/i.test(word) && !/^(?:hawaii|miami|safari|sushi|taxi|deli|ski|alibi|broccoli|zucchini|spaghetti|macaroni|jacuzzi|tsunami)$/i.test(word);
}
function cutOffAtLimit(value: string, max: number) {
  const text = value.trim();
  return text.length / max >= 0.85 && !/[.!?]["']?$/.test(text);
}
function normalizedCopy(value: string) {
  return value.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}
function nearDuplicate(left: string, right: string) {
  const a = normalizedCopy(left);
  const b = normalizedCopy(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length) >= 0.86;
}
const descriptionDangling = /(?:^|\s)(?:enhance|in|and|or|with|for|the|a|an|to|of|your)$/i;
function splitDescription(current: string, next: string | undefined) {
  const following = next?.trim() ?? "";
  const text = current.trim().replace(/[\s,;:]+$/g, "");
  if (!following || !text || /[.!?]$/.test(text) || !descriptionDangling.test(text)) return false;
  return /^[a-z]/.test(following) || current.trim().length >= 90;
}
function cutOffPhrase(value: string) {
  return /\bhome['’]s curb$/i.test(value.trim().replace(/[\s,;:]+$/g, ""));
}

export function copyChecks(draft: MarketingDraft): CopyFinding[] {
  const findings: CopyFinding[] = [];
  const add = (category: CopyFinding["category"], detail: string, evidence: string, suggestion: string, severity: CopyFinding["severity"] = "blocker") => {
    if (severity === "blocker" && cosmeticFinding(detail)) return;
    findings.push({ category, severity, detail, evidence, suggestion });
  };
  if (!marketingDraftSchema.safeParse(draft).success) add("copy", "Draft format is invalid.", "Field validation failed.", "Correct text lengths and required fields.");
  for (const [label, value] of Object.entries({ social: draft.social, googleBusiness: draft.googleBusiness })) if (!value.trim()) add("copy", `${label} is empty.`, "No public copy supplied.", "Write this field before approval.");
  for (const [label, value] of Object.entries({ metaPrimary: draft.metaPrimary, metaHeadline: draft.metaHeadline, imageHeadline: draft.imageHeadline })) if (!value.trim()) add("copy", `${label} is empty.`, "No public copy supplied.", "Write this field before using it in an ad.", "warning");
  const publicText = [draft.social, draft.googleBusiness, draft.metaPrimary, draft.metaHeadline, draft.imageHeadline, ...draft.googleHeadlines, ...draft.googleDescriptions].join("\n");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicText)) add("privacy", "An email address appears in public copy.", "An email pattern was detected.", "Remove customer contact details; use the approved website link.");
  if (!["rhipros.com", "www.rhipros.com"].includes(new URL(draft.landingUrl).hostname)) add("copy", "The landing page is outside the RHI Pros website.", "Unexpected destination hostname.", "Use the appropriate RHI Pros project or quote page.");
  if (new Set(draft.googleHeadlines.map((value) => value.trim().toLowerCase())).size !== draft.googleHeadlines.length) add("copy", "Google headlines repeat.", "Duplicate headline text.", "Use distinct headlines.", "warning");
  for (const [label, value] of [["Meta headline", draft.metaHeadline], ["graphic headline", draft.imageHeadline]] as const) {
    const text = value.trim();
    if (!text) continue;
    if (danglingEnding.test(text)) add("copy", `Finish the ${label} so it does not end on a dangling word.`, `${label}: "${text}".`, "Finish the phrase or remove the last word.", "warning");
    else if (endsMidToken(text)) add("copy", `Finish the ${label} so it does not stop mid-word.`, `${label}: "${text}".`, "Finish the word or shorten the headline.", "warning");
    else if (cutOffPhrase(text)) add("copy", `Finish the ${label} so it does not end on a cut-off phrase.`, `${label}: "${text}".`, "Finish the phrase instead of stopping at curb.", "warning");
  }
  draft.googleHeadlines.forEach((value, index) => {
    const text = value.trim();
    if (cutOffAtLimit(value, 30)) add("copy", `Finish Google headline ${index + 1} so it is not cut off.`, `Google headline ${index + 1}: "${text}".`, "End the sentence or shorten the headline.", "warning");
    if (text && danglingEnding.test(text)) add("copy", `Finish Google headline ${index + 1} so it does not end on a dangling word.`, `Google headline ${index + 1}: "${text}".`, "Finish the phrase or remove the last word.", "warning");
    else if (text && cutOffPhrase(text)) add("copy", `Finish Google headline ${index + 1} so it does not end on a cut-off phrase.`, `Google headline ${index + 1}: "${text}".`, "Finish the phrase instead of stopping at curb.", "warning");
  });
  draft.googleDescriptions.forEach((value, index) => { if (cutOffAtLimit(value, 90)) add("copy", `Finish Google description ${index + 1} so it is not cut off.`, `Google description ${index + 1}: "${value.trim()}".`, "End the sentence or shorten the description.", "warning"); });
  for (let index = 0; index < draft.googleDescriptions.length - 1; index++) if (splitDescription(draft.googleDescriptions[index], draft.googleDescriptions[index + 1])) add("copy", `Finish Google description ${index + 1} so it does not continue into the next one.`, `Google description ${index + 1} ends on a connector and the next description continues it.`, "Give each description its own complete sentence.", "warning");
  if (draft.googleDescriptions.some((value, index) => draft.googleDescriptions.some((other, otherIndex) => otherIndex > index && (value.trim().toLowerCase() === other.trim().toLowerCase() || nearDuplicate(value, other))))) add("copy", "Rewrite the repeated Google description.", "Duplicate or near-duplicate description text.", "Use a different description.", "warning");
  if (draft.social.trim() && draft.social.trim() === draft.metaPrimary.trim()) add("copy", "Rewrite the Meta ad so it is not the same as the Facebook post.", "Facebook and Meta primary text match after trim.", "Write a separate Meta ad or change the Facebook post.", "warning");
  if (/\S/.test(draft.imageHeadline) && draft.imageHeadline.includes("  ")) add("copy", "Remove the double space from the graphic headline.", `Graphic headline: "${draft.imageHeadline}".`, "Use a single space.", "warning");
  for (const [label, value, severity] of [["public town", draft.publicLocation, "blocker"], ["work performed", draft.service, "blocker"], ["Facebook post", draft.social, "blocker"], ["Google Business update", draft.googleBusiness, "blocker"], ["Meta ad", draft.metaPrimary, "warning"], ["Meta headline", draft.metaHeadline, "warning"], ...draft.googleHeadlines.map((value, index) => [`Google headline ${index + 1}`, value, "warning"] as [string, string, "warning"]), ...draft.googleDescriptions.map((value, index) => [`Google description ${index + 1}`, value, "warning"] as [string, string, "warning"])] as [string, string, "blocker" | "warning"][]) if (value.trim() && value.includes("  ")) add("copy", `Remove the double space from the ${label}.`, `${label}: "${value.trim().slice(0, 160)}".`, "Use a single space.", severity);
  const claimed = [draft.social, draft.googleBusiness, draft.metaPrimary].some((value) => workClaim.test(value.split(templateCta).join(" ")));
  if (claimed && !workNote.test(draft.sourceNotes)) add("facts", "The caption says RHI Pros did this work, and the notes do not.", "Public copy says RHI Pros built, installed, or completed the work, and the notes do not.", "Add a first-person note if RHI Pros did the work, or remove the claim.");
  return findings;
}
