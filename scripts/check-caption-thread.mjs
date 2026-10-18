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
const thread = load("src/lib/caption-thread.ts", {
  zod: require("zod"),
  "node:crypto": require("node:crypto"),
  "@prisma/client": { Prisma: { DbNull: "DbNull", PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} } },
});

const orgId = "org";
const draftId = "10000000-0000-4000-8000-000000000001";
const otherDraftId = "10000000-0000-4000-8000-000000000002";

function turn(index, status = "queued") {
  return {
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    instruction: `Revise the caption ${index}.`,
    status,
  };
}

function threadBody(turns) {
  return { version: 1, draftId, turns };
}

test("captionThreadId is stable and looks like a UUID", () => {
  const first = thread.captionThreadId(orgId, draftId);
  const second = thread.captionThreadId(orgId, draftId);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, thread.captionThreadId(orgId, otherDraftId));
});

test("a 13th turn is rejected, or trimTurns keeps 12", () => {
  const turns = Array.from({ length: 13 }, (_, index) => turn(index));
  if (typeof thread.trimTurns === "function") {
    // append keeps 12: trimTurns is the pure function that drops the oldest turn.
    const kept = thread.trimTurns(turns);
    const list = Array.isArray(kept) ? kept : kept.turns;
    assert.equal(list.length, 12);
    assert.deepEqual(list, turns.slice(-12));
    return;
  }
  assert.equal(thread.captionThreadSchema.safeParse(threadBody(turns)).success, false);
  assert.equal(thread.captionThreadSchema.safeParse(threadBody(turns.slice(0, 12))).success, true);
  for (const status of ["queued", "ready", "failed"]) {
    assert.equal(thread.captionThreadSchema.safeParse(threadBody([turn(0, status)])).success, true);
  }
  assert.equal(thread.captionThreadSchema.safeParse(threadBody([turn(0, "running")])).success, false);
});

test("an instruction longer than 400 characters fails", () => {
  const tooLong = threadBody([{ ...turn(0), instruction: "x".repeat(401) }]);
  assert.equal(thread.captionThreadSchema.safeParse(tooLong).success, false);
  const boundary = threadBody([{ ...turn(0), instruction: "x".repeat(400) }]);
  assert.equal(thread.captionThreadSchema.safeParse(boundary).success, true);
});

test("settling a queued turn replaces that row", () => {
  const waiting = { ...turn(1), instruction: "Talk about the grass." };
  const older = turn(0);
  const settled = thread.nextCaptionTurns(
    [older, waiting],
    { ...turn(2), instruction: "Talk about the grass.", status: "ready" },
    true,
  );
  assert.equal(settled.length, 2);
  assert.equal(settled[1].status, "ready");
  assert.equal(settled[0].instruction, older.instruction);
  const failed = thread.nextCaptionTurns(
    [waiting],
    { ...turn(3), instruction: "Talk about the grass.", status: "failed", error: "The local model did not change the caption." },
    true,
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0].error, "The local model did not change the caption.");
});

test("approved true is not a field the schema accepts", () => {
  const body = threadBody([turn(0)]);
  assert.equal(thread.captionThreadSchema.safeParse(body).success, true);
  assert.equal(thread.captionThreadSchema.safeParse({ ...body, approved: true }).success, false);
});

test("local caption revision does not transcribe or attach images", () => {
  const source = readFileSync(new URL("./local-caption-revision.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(source.includes("transcribe"), false);
  assert.equal(source.includes("inspectSubmission"), false);
  assert.equal(source.includes("images:"), false);
});
