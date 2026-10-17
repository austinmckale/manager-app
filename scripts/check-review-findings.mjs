import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, imports) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); }, URL, Buffer, crypto, Date, Set, Map, Object, Response, Request, AbortSignal, console: { error() {} } }, { filename: file });
  return exports;
}
const findings = load("src/lib/review-findings.ts", {});
const evidence = load("src/lib/marketing-evidence.ts", { zod: require("zod") });
function same(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

const photoId = "20000000-0000-4000-8000-000000000001";
const finished = "The image shows no visible construction equipment or unfinished elements — all work appears complete.";
const unbranded = "No text, notes, or markings indicate company branding or project ownership on-site.";
const absentNote = "The voice and owner messages are internal test data; they do not appear in the image itself.";
const cosmetic = [finished, unbranded, absentNote];
const prefixed = cosmetic.map((line) => `Photo ${photoId}: ${line}`);

test("finished work, missing branding, and notes that are not in the image are cosmetic", () => {
  for (const detail of [...cosmetic, ...prefixed]) assert.equal(findings.cosmeticFinding(detail), true);
  assert.equal(findings.cosmeticFinding(finished.toUpperCase()), true);
  assert.equal(findings.cosmeticFinding("The company name is not visible on the photo."), true);
  assert.equal(findings.cosmeticFinding("There is no logo on the finished patio."), true);
});

test("a Do not publish sentence is not cosmetic", () => {
  assert.equal(findings.cosmeticFinding("Do not publish this photo."), false);
  assert.equal(findings.cosmeticFinding("Don't publish this finished patio. All work appears complete."), false);
  assert.equal(findings.cosmeticFinding("This recording is not for publication."), false);
  assert.equal(findings.cosmeticFinding("This is a microphone test."), false);
  assert.equal(findings.cosmeticFinding("TEST\nAll work appears complete."), false);
  assert.equal(findings.cosmeticFinding(`Photo ${photoId}: Do not publish this photo.`), false);
});

test("internal test data alone is not a withhold", () => {
  assert.equal(findings.cosmeticFinding(absentNote), true);
  assert.equal(findings.cosmeticFinding("internal test data"), false);
});

test("contradictions, privacy, and an unsupported RHI claim are not cosmetic", () => {
  assert.equal(findings.cosmeticFinding("Voice says unfinished, typed notes say finished."), false);
  assert.equal(findings.cosmeticFinding("Customer address visible."), false);
  assert.equal(findings.cosmeticFinding("The caption says RHI built it, and the notes do not."), false);
});

test("auditIssues drops cosmetic photo lines and keeps real blocks", () => {
  const kept = [
    `Photo ${photoId}: Do not publish this photo.`,
    "Voice says unfinished, typed notes say finished.",
    "Customer address visible.",
    "The caption says RHI built it, and the notes do not.",
  ];
  const issues = evidence.auditIssues({}, {
    photos: [{ assetId: photoId, observations: ["A finished paver patio."] }],
    notes: { facts: [{ source: "voice", quote: "We laid a paver patio.", fact: "Patio" }] },
    reasons: [...prefixed, ...kept],
  }, { fields: [] });
  same(issues, kept);
  const copy = { social: "We laid a paver patio." };
  const cosmeticOnly = evidence.auditIssues(copy, {
    photos: [{ assetId: photoId, observations: ["A finished paver patio."] }],
    notes: { facts: [{ source: "voice", quote: "We laid a paver patio.", fact: "Patio" }] },
    reasons: [],
  }, { fields: [{ field: "social", text: copy.social, supported: false, factIds: ["note:0"], issues: [finished] }] });
  same(cosmeticOnly, []);
  const authorship = evidence.auditIssues(copy, {
    photos: [{ assetId: photoId, observations: ["A finished paver patio."] }],
    notes: { facts: [{ source: "voice", quote: "We laid a paver patio.", fact: "Patio" }] },
    reasons: [],
  }, { fields: [{ field: "social", text: copy.social, supported: false, factIds: ["note:0"], issues: ["The caption says RHI built it, and the notes do not."] }] });
  same(authorship, ["social: The caption says RHI built it, and the notes do not."]);
});

test("assessEvidence does not turn cosmetic photo notes into blocking reasons", () => {
  const sources = { notes: "Reading", voice: "We laid a paver patio.", owner: "" };
  const result = evidence.assessEvidence({
    postType: "project",
    photos: [{
      assetId: photoId,
      relevance: "construction",
      observations: ["A paver patio is visible."],
      concerns: [...cosmetic, "Do not publish this photo.", "Customer address visible."],
    }],
    notes: { facts: [{ source: "voice", quote: "We laid a paver patio.", fact: "Crew laid a patio." }], conflicts: ["Voice says unfinished, typed notes say finished."] },
    sources,
    assetIds: [photoId],
  });
  for (const line of cosmetic) assert.equal(result.reasons.some((reason) => reason.includes(line)), false);
  assert.ok(result.reasons.some((reason) => reason.includes("Do not publish this photo.")));
  assert.ok(result.reasons.some((reason) => reason.includes("Customer address visible.")));
  assert.ok(result.reasons.includes("Voice says unfinished, typed notes say finished."));
});
