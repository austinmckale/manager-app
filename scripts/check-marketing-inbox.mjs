import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
function load(file, imports) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); }, URL, Buffer, crypto, console: { error() {} } }, { filename: file });
  return exports;
}
const marketing = load("src/lib/marketing.ts", { zod: nodeRequire("zod") });
const inbox = load("src/lib/marketing-inbox.ts", { zod: nodeRequire("zod"), "@/lib/marketing": marketing });

const photoA = "20000000-0000-4000-8000-000000000001";
const photoB = "20000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000001";
const submissionA = "30000000-0000-4000-8000-000000000001";
const submissionB = "30000000-0000-4000-8000-000000000002";
const draftId = "40000000-0000-4000-8000-000000000001";

function photo(overrides) {
  return { id: photoA, jobId, jobName: "Kitchen remodel", unsorted: false, createdAt: "2026-10-17T15:00:00.000Z", description: "Town / job: Reading, PA\n\nReplaced the vanity.", tags: [`submission:${submissionA}`], onWebsite: false, ...overrides };
}
function draft(assetIds = [photoA]) {
  return marketing.prepareMarketingDraft({ assetIds, notes: ["Replaced the vanity."], location: "Reading, PA" });
}

test("stored action names still match the inbox view model", () => {
  const sources = {
    "src/lib/field-intake.ts": "field.photo.received",
    "src/lib/intake-audio.ts": "field.audio.received",
    "src/lib/marketing-evidence.ts": "marketing.generation.job",
    "src/lib/marketing.ts": "marketing.draft.saved",
    "src/lib/content-review.ts": "marketing.content.approved",
    "src/lib/intake-delivery.ts": "marketing.intake.pack.ready",
  };
  const inboxSource = readFileSync(new URL("../src/lib/marketing-inbox.ts", import.meta.url), "utf8");
  for (const [file, action] of Object.entries(sources)) {
    assert.match(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), new RegExp(action.replaceAll(".", "\\.")));
    assert.match(inboxSource, new RegExp(action.replaceAll(".", "\\.")));
  }
  assert.match(readFileSync(new URL("../src/lib/content-review.ts", import.meta.url), "utf8"), /marketing\.content\.superseded/);
});

test("one card per submission, with test notes hidden by the caller and website photos not treated as published posts", () => {
  const cards = inbox.buildInboxCards([
    photo({}),
    photo({ id: photoB, createdAt: "2026-10-17T16:00:00.000Z", description: "Town / job: Allentown, PA\n\nTEST microphone check", tags: [`submission:${submissionB}`], onWebsite: true }),
  ], []);
  assert.equal(cards.length, 2);
  const real = cards.find((card) => card.id === submissionA);
  const testCard = cards.find((card) => card.id === submissionB);
  assert.equal(real.test, false);
  assert.equal(real.place, "Reading, PA");
  assert.match(real.summary, /vanity/);
  assert.equal(real.status, "received");
  assert.equal(testCard.test, true);
  assert.equal(testCard.websitePhotoCount, 1);
  assert.notEqual(testCard.status, "ready_to_schedule");
  assert.equal(cards.filter((card) => !card.test).map((card) => card.id).includes(submissionB), false);
});

test("a saved draft is review work until an approval exists, and a superseded approval is not ready", () => {
  const saved = { id: draftId, action: "marketing.draft.saved", createdAt: "2026-10-17T17:00:00.000Z", metadata: draft() };
  const unapproved = inbox.buildInboxCards([photo({})], [saved]);
  assert.equal(unapproved[0].status, "needs_review");
  assert.equal(unapproved[0].action, "review");
  assert.equal(unapproved[0].draftId, draftId);
  const approved = inbox.buildInboxCards([photo({ onWebsite: false })], [saved, { id: "approval", action: "marketing.content.approved", createdAt: "2026-10-17T18:00:00.000Z", metadata: { draftId } }]);
  assert.equal(approved[0].status, "ready_to_schedule");
  assert.match(approved[0].detail, /not a scheduled or published post/);
  const replaced = inbox.buildInboxCards([photo({})], [saved, { id: "approval", action: "marketing.content.approved", createdAt: "2026-10-17T18:00:00.000Z", metadata: { draftId } }, { id: "old", action: "marketing.content.superseded", createdAt: "2026-10-17T19:00:00.000Z", metadata: { draftId } }]);
  assert.equal(replaced[0].status, "needs_review");
});

test("website visibility and an in-progress generation do not become approval", () => {
  const cards = inbox.buildInboxCards([
    photo({ onWebsite: true }),
  ], [
    { id: "job", action: "marketing.generation.job", createdAt: "2026-10-17T17:00:00.000Z", metadata: { submissionId: submissionA, status: "queued" } },
  ]);
  assert.equal(cards[0].status, "processing");
  assert.equal(cards[0].websitePhotoCount, 1);
  assert.notEqual(cards[0].statusLabel, "Published");
});

test("held generation, missing notes, and failed voice are needs-details; actionable work sorts first", () => {
  const held = inbox.buildInboxCards([photo({})], [{ id: "held", action: "marketing.generation.job", createdAt: "2026-10-17T17:00:00.000Z", metadata: { submissionId: submissionA, status: "held" } }]);
  assert.equal(held[0].status, "needs_details");
  const empty = inbox.buildInboxCards([photo({ description: "Town / job: Reading, PA" })], []);
  assert.equal(empty[0].status, "needs_details");
  assert.equal(empty[0].action, "notes");
  const failedVoice = inbox.buildInboxCards([photo({})], [{ id: "audio", action: "field.audio.received", createdAt: "2026-10-17T17:00:00.000Z", metadata: { submissionId: submissionA, status: "failed", transcript: "" } }]);
  assert.equal(failedVoice[0].status, "needs_details");
  const pendingVoice = inbox.buildInboxCards([photo({})], [{ id: "audio", action: "field.audio.received", createdAt: "2026-10-17T17:00:00.000Z", metadata: { submissionId: submissionA, status: "queued", transcript: "" } }]);
  assert.equal(pendingVoice[0].status, "processing");
  const ranked = inbox.buildInboxCards([
    photo({ id: photoA, createdAt: "2026-10-17T12:00:00.000Z" }),
    photo({ id: photoB, createdAt: "2026-10-17T18:00:00.000Z", description: "", tags: [`submission:${submissionB}`] }),
  ], [
    { id: draftId, action: "marketing.draft.saved", createdAt: "2026-10-17T17:00:00.000Z", metadata: draft([photoA]) },
  ]);
  assert.equal(ranked.map((card) => `${card.id}:${card.status}`).join(","), `${submissionB}:needs_details,${submissionA}:needs_review`);
});

test("an explicit test flag is remembered even when the note has no TEST prefix", () => {
  const cards = inbox.buildInboxCards([photo({})], [{ id: "pack", action: "marketing.intake.pack.ready", createdAt: "2026-10-17T17:00:00.000Z", metadata: { submissionId: submissionA, isTest: true } }]);
  assert.equal(cards[0].test, true);
  assert.equal(inbox.isMarkedTestText("Finished the patio"), false);
  assert.equal(inbox.isMarkedTestText("TEST microphone"), true);
});
