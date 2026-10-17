// Review gate only. This record is not marketing copy and cannot be imported or published.

const SHORT_TEXT = 120;

const DECISION_FIELDS = [
  "version",
  "status",
  "reasons",
  "neededContext",
  "canImportMarketingCopy",
  "canPublish",
] as const;

const COPY_FIELDS = ["copy", "social", "googleBusiness", "metaPrimary", "headlines", "approved"] as const;

const UPLOAD_LINK_REVIEW_NOTE =
  "Reading, PA \u2014 website example\nTEST \u2014 existing website photo used to verify Ryan\u2019s upload link. Paver patio and pavilion. Keep this sample in review; do not publish it again.";

export type ReviewDecisionStatus = "blocked" | "needs_context";

export type ReviewDecision = {
  version: 2;
  status: ReviewDecisionStatus;
  reasons: string[];
  neededContext: string[];
  canImportMarketingCopy: false;
  canPublish: false;
};

function canonicalNote(value: string) {
  return value.replace(/[\u2018\u2019\u2032]/g, "'").replace(/\r\n/g, "\n").trim();
}

function isShortText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= SHORT_TEXT && !/[\r\n]/.test(value);
}

function isShortList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8 && value.every((item) => isShortText(item));
}

export function isReviewDecision(value: unknown): value is ReviewDecision {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== DECISION_FIELDS.length) return false;
  if (!DECISION_FIELDS.every((field) => Object.hasOwn(record, field))) return false;
  if (COPY_FIELDS.some((field) => Object.hasOwn(record, field))) return false;
  if (record.version !== 2) return false;
  if (record.status !== "blocked" && record.status !== "needs_context") return false;
  const reasons = record.reasons;
  const neededContext = record.neededContext;
  if (!isShortList(reasons) || reasons.length === 0) return false;
  if (!isShortList(neededContext)) return false;
  if (record.status === "needs_context" && neededContext.length === 0) return false;
  if (record.canImportMarketingCopy !== false) return false;
  if (record.canPublish !== false) return false;
  return true;
}

export function reviewDecisionForNote(note: string): ReviewDecision | null {
  const sample = canonicalNote(UPLOAD_LINK_REVIEW_NOTE);
  if (!canonicalNote(note).includes(sample)) return null;
  return {
    version: 2,
    status: "blocked",
    reasons: ["This is a test of an upload link.", "It must not be published again."],
    neededContext: [],
    canImportMarketingCopy: false,
    canPublish: false,
  };
}
