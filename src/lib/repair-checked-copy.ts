import type { MarketingDraft } from "@/lib/marketing";

const danglingEnding = /\b(?:in|and|or|with|the|a|to|for|of)$/i;
const curbEnding = /\bhome['’]s curb$/i;
const headlineFallbacks = ["RHI Pros", "Your next project", "Request an estimate", "Local home projects", "Ask about a project"];
const descriptionFallbacks = ["Request an estimate.", "See recent projects.", "Ask about your project.", "Contact RHI Pros."];

function oneSpace(value: string) {
  return value.replace(/[ \t]{2,}/g, " ").replace(/[-–—]+$/g, "").trim();
}

function tidy(value: string) {
  let text = oneSpace(value);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = oneSpace(text.replace(curbEnding, "").replace(danglingEnding, ""));
    if (next === text) break;
    text = next;
  }
  const last = text.split(/\s+/).pop() ?? "";
  const word = last.replace(/[^A-Za-z]/g, "");
  if ((word.length === 1 && !/^[AI]$/i.test(word)) || (word.length > 1 && !/[aeiouy]/i.test(word))) {
    text = oneSpace(text.slice(0, text.length - last.length));
  }
  return text;
}

function fit(value: string, max: number, fallback: string) {
  let text = tidy(value);
  const limit = Math.max(8, Math.floor(max * 0.84));
  while (text.length > limit) {
    const cut = text.slice(0, limit);
    const space = cut.lastIndexOf(" ");
    text = tidy(space > 4 ? cut.slice(0, space) : cut);
  }
  if (!text) text = tidy(fallback);
  return text.slice(0, max);
}

function uniqueLines(values: string[], max: number, fallbacks: string[], minCount: number) {
  const used = new Set<string>();
  const next = values.map((value) => fit(value, max, fallbacks[0]));
  for (let index = 0; index < next.length; index += 1) {
    const key = next[index].trim().toLowerCase();
    if (!key || used.has(key)) {
      const replacement = fallbacks.find((item) => !used.has(item.toLowerCase())) ?? fallbacks[0];
      next[index] = fit(replacement, max, fallbacks[0]);
    }
    used.add(next[index].trim().toLowerCase());
  }
  while (next.length < minCount) {
    const replacement = fallbacks.find((item) => !used.has(item.toLowerCase())) ?? fallbacks[0];
    next.push(fit(replacement, max, fallbacks[0]));
    used.add(next[next.length - 1].trim().toLowerCase());
  }
  return next;
}

export function repairCheckedCopy(draft: MarketingDraft): MarketingDraft {
  return {
    ...draft,
    social: oneSpace(draft.social),
    googleBusiness: oneSpace(draft.googleBusiness),
    metaPrimary: oneSpace(draft.metaPrimary),
    publicLocation: oneSpace(draft.publicLocation),
    service: oneSpace(draft.service),
    metaHeadline: fit(draft.metaHeadline, 40, "Tell us about your project"),
    imageHeadline: fit(draft.imageHeadline, 60, "Project by RHI Pros"),
    googleHeadlines: uniqueLines(draft.googleHeadlines, 30, headlineFallbacks, 3),
    googleDescriptions: uniqueLines(draft.googleDescriptions, 90, descriptionFallbacks, 2),
  };
}
