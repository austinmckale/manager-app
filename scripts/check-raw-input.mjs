import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name === "zod") return require("zod"); if (name === "node:crypto") return require("node:crypto"); throw new Error(name); }, URL, Buffer, crypto, console: { error() {} } }, { filename: file });
  return exports;
}
const raw = load("src/lib/raw-input.ts");
const ids = { inviteId: "10000000-0000-4000-8000-000000000001", submissionId: "20000000-0000-4000-8000-000000000002", draftId: "30000000-0000-4000-8000-000000000003" };

test("a long transcript is stored instead of rejected at 6000 characters", () => {
  const kept = raw.keepRawText("a".repeat(6001));
  assert.equal(kept.text.length, 6001);
  assert.equal(kept.truncated, false);
});

test("a transcript past the raw limit is clipped and marked", () => {
  const kept = raw.keepRawText("b".repeat(raw.RAW_TEXT_LIMIT + 5));
  assert.equal(kept.text.length, raw.RAW_TEXT_LIMIT);
  assert.equal(kept.truncated, true);
});

test("the raw record keeps the transcript separate from a short public post", () => {
  const record = raw.buildRawInput({ ...ids, typedNote: "Reading patio", transcript: "We set the posts and stained the ceiling. ".repeat(200), photoIds: [ids.draftId] });
  assert.equal(record.version, 1);
  assert.ok(record.transcript.length > 6000);
  assert.equal(raw.rawInputId("org", ids.submissionId), raw.rawInputId("org", ids.submissionId));
});
