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
  vm.runInNewContext(source, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); }, URL, Buffer, crypto, Date, Set, Map, Response, Request, console: { error() {} } }, { filename: file });
  return exports;
}
const caption = load("src/lib/caption-revision.ts", { zod: require("zod"), "node:crypto": require("node:crypto") });

const orgId = "org";
const draftId = "10000000-0000-4000-8000-000000000001";
const inputHash = "a".repeat(64);
const instruction = "Make the caption shorter and warmer.";

test("an instruction of 401 characters fails the schema", () => {
  const body = { draftId, inputHash, instruction: "x".repeat(401) };
  assert.equal(caption.captionRevisionBodySchema.safeParse(body).success, false);
});

test("an empty instruction fails", () => {
  const body = { draftId, inputHash, instruction: "" };
  assert.equal(caption.captionRevisionBodySchema.safeParse(body).success, false);
});

test("a valid body parses and captionRevisionId is stable and looks like a UUID", () => {
  const body = caption.captionRevisionBodySchema.parse({ draftId, inputHash, instruction });
  assert.equal(body.draftId, draftId);
  assert.equal(body.inputHash, inputHash);
  assert.equal(body.instruction, instruction);
  const first = caption.captionRevisionId(orgId, body.draftId, body.inputHash, body.instruction);
  const second = caption.captionRevisionId(orgId, body.draftId, body.inputHash, body.instruction);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("emptyRevision sets approved false and published false", () => {
  const revision = caption.emptyRevision(draftId, inputHash, instruction);
  assert.equal(revision.approved, false);
  assert.equal(revision.published, false);
});

test("captionRevisionSchema rejects approved true and published true", () => {
  const revision = caption.emptyRevision(draftId, inputHash, instruction);
  assert.equal(caption.captionRevisionSchema.safeParse({ ...revision, approved: true }).success, false);
  assert.equal(caption.captionRevisionSchema.safeParse({ ...revision, published: true }).success, false);
});

test("two different instructions produce different ids", () => {
  const first = caption.captionRevisionId(orgId, draftId, inputHash, instruction);
  const second = caption.captionRevisionId(orgId, draftId, inputHash, "Lead with the finished patio.");
  assert.notEqual(first, second);
});

test("older revision records still load as plain caption requests", () => {
  const old = { draftId, inputHash, instruction, status: "ready", social: "A", googleBusiness: "B", error: null, approved: false, published: false };
  const parsed = caption.captionRevisionSchema.parse(old);
  assert.equal(parsed.mode, "caption");
  assert.deepEqual({ ...parsed.locked }, {});
  assert.equal(parsed.remaining, null);
});

test("a regenerate request takes kept captions within their limits and nothing else", () => {
  const ok = { draftId, inputHash, mode: "regenerate", locked: { social: "Kept text.", googleHeadlines: ["One", "Two", "Three"] }, note: "shorter" };
  assert.equal(caption.captionRegenerateBodySchema.safeParse(ok).success, true);
  assert.equal(caption.captionRegenerateBodySchema.safeParse({ ...ok, locked: { metaHeadline: "x".repeat(41) } }).success, false);
  assert.equal(caption.captionRegenerateBodySchema.safeParse({ ...ok, locked: { sourceNotes: "private" } }).success, false);
  assert.equal(caption.captionRegenerateBodySchema.safeParse({ ...ok, approved: true }).success, false);
  assert.match(caption.regenerateInstruction("mention the landing"), /^Regenerate the unlocked captions: mention the landing$/);
  const a = caption.captionRevisionId("org", draftId, inputHash, "Regenerate the unlocked captions", JSON.stringify({ social: "A" }));
  const b = caption.captionRevisionId("org", draftId, inputHash, "Regenerate the unlocked captions", JSON.stringify({ social: "B" }));
  assert.notEqual(a, b);
});
