// A finished patio, a missing on-photo logo, and a voice note that is not
// painted on the picture are not publish blocks. A withhold phrase is.
// "Internal test data" is not a withhold by itself.
// RHI Pros did all the work shown in its job photos, so a finding that only doubts
// who did it ("the notes do not say RHI built it") is not a block. One that also
// questions a town, an offer, a date or a contact detail still is.
const withhold = /^TEST\b|do\s+not\s+publish|don['’]t\s+publish|not\s+for\s+publication|microphone\s+test/im;
const workDone = String.raw`(?:RHI(?: Pros)?|we|our (?:company|crew|team)|the company|the crew|the contractor)\s+(?:built|installed|did|completed|finished|performed|constructed)(?:\s+(?:it|this|that|them|anything|any work|the work|this work|the job|this job|the project|this project))?\s*(?:[,.;!?]|$|\s+(?:and|but|or)\b)`;
const authorshipDoubt = new RegExp(String.raw`\bwho built\b|\bcompany involvement\b|\b(?:does not|doesn['’]t|do not|don['’]t|did not|didn['’]t|cannot|can['’]t|not)\s+(?:say|state|show|prove|establish|confirm|mention|indicate|support)\w*\s+(?:that\s+)?${workDone}|\b${workDone}[^.]{0,40}\b(?:notes|facts|sources?|evidence)\b[^.]{0,20}\b(?:do not|don['’]t|does not|doesn['’]t|never)\b`, "i");
const otherClaim = /\btown\b|\bcity\b|\blocation\b|\boffers?\b|\bdiscount|\bwarrant|\bguarantee|\bprice|\bdates?\b|\bpraise\b|\breviews?\b|\bawards?\b|\blicen[sc]|\bcertif|\baddress\b|\bemail\b|\bphone\b|\bcontradict|\bconflicts?\b|\bdisagree/i;
const keptBlock = /\bRHI\b|\baddress\b|\bemail\b|\bphone\b|\bcontradict|\bconflicts?\b|\bdisagree|\bunsupported claim\b|\bneeds details\b/i;
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
  if (withhold.test(detail)) return false;
  const text = detail.replace(/\s+/g, " ");
  if (authorshipDoubt.test(text) && !otherClaim.test(text)) return true;
  if (keptBlock.test(detail)) return false;
  return cosmeticPatterns.some((pattern) => pattern.test(text));
}
