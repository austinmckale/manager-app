// A finished patio, a missing on-photo logo, and a voice note that is not
// painted on the picture are not publish blocks. A withhold phrase is.
// "Internal test data" is not a withhold by itself.
const withhold = /^TEST\b|do\s+not\s+publish|don['’]t\s+publish|not\s+for\s+publication|microphone\s+test/im;
const keptBlock = /\bRHI\b|\baddress\b|\bemail\b|\bphone\b|\bcontradict|\bconflicts?\b|\bdisagree|\bwho built\b|\bunsupported claim\b|\bneeds details\b/i;
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
  /\bverification purposes\b/i,
  /\bnot necessarily showing completed work\b/i,
  /\bno explicit connection\b/i,
];

export function cosmeticFinding(detail: string): boolean {
  if (withhold.test(detail) || keptBlock.test(detail)) return false;
  const text = detail.replace(/\s+/g, " ");
  return cosmeticPatterns.some((pattern) => pattern.test(text));
}
