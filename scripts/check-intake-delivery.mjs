import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, imports) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import ${name}`); }, Date, Set, Buffer, Response, URL, process: { env: {} } }, { filename: file });
  return exports;
}
const marketing = load("src/lib/marketing.ts", { zod: require("zod") });
const photoId = "20000000-0000-4000-8000-000000000001";
const packId = "30000000-0000-4000-8000-000000000001";
const inviteId = "40000000-0000-4000-8000-000000000001";
const submissionId = "50000000-0000-4000-8000-000000000001";
const draft = { ...marketing.prepareMarketingDraft({ assetIds: [photoId], notes: ["private source note"] }), photoNotes: [{ assetId: photoId, description: "private annotation", area: null, stage: null }] };
const metadata = { inviteId, submissionId, deliverAt: "2026-10-17T12:00:00.000Z", draft, generator: "codex" };
const now = new Date("2026-10-17T12:00:00.000Z");
function harness(options = {}) {
  const queries = [];
  const assets = options.missingPhoto ? [] : [{ id: photoId, fileName: "photo.jpg", mimeType: "image/jpeg", storageKey: "private/original.jpg" }];
  const record = { id: packId, jobId: "job", metadata: { ...metadata, ...options.metadata } };
  const mod = load("src/lib/intake-delivery.ts", {
    "node:crypto": require("node:crypto"), zod: require("zod"), "@/lib/marketing": marketing,
    "@/lib/field-intake": { resolveUploadInvite: async () => options.invalidInvite ? null : { id: inviteId, orgId: "org", jobId: "job" } },
    "@/lib/prisma": { prisma: {
      activityLog: { findFirst: async (query) => { queries.push(query); return options.otherOrg ? null : record; }, findMany: async (query) => { queries.push(query); return [record]; } },
      fileAsset: { findMany: async (query) => { queries.push(query); return assets; } },
    } },
  });
  return { ...mod, queries };
}
test("delivery dates accept only the 10–42 hour window", () => {
  const h = harness();
  assert.equal(h.deliveryDate(now, 600), "2026-10-17T22:00:00.000Z");
  assert.equal(h.deliveryDate(now, 2520), "2026-10-19T06:00:00.000Z");
  for (const invalid of [599, 2521, -1, 600.5, NaN]) assert.throws(() => h.deliveryDate(now, invalid));
});
test("submission IDs are stable, scoped by org/invite, and distinct for notifications", () => {
  const h = harness(); const id = h.deliveryId("org", inviteId, submissionId);
  assert.equal(id, h.deliveryId("org", inviteId, submissionId));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, h.deliveryId("other", inviteId, submissionId));
  assert.notEqual(id, h.deliveryId("org", "other", submissionId));
  assert.notEqual(id, h.deliveryId("org", inviteId, submissionId, "email"));
});
test("unreleased, mismatched, invalid and missing-photo packs cannot be opened", async () => {
  for (const options of [{ invalidInvite: true }, { otherOrg: true }, { missingPhoto: true }, { metadata: { isTest: true } }, { metadata: { inviteId: "40000000-0000-4000-8000-000000000002" } }, { metadata: { deliverAt: "2026-10-17T12:00:01.000Z" } }, { metadata: { draft: null } }]) assert.equal(await harness(options).readIntakePack("token", packId, now), null);
  assert.equal(await harness().readIntakePack("token", "invalid-id", now), null);
});
test("available packs require their own active invite and a reached delivery time", async () => {
  assert.equal((await harness().availableIntakePacks("token", now)).length, 1);
  assert.equal((await harness({ invalidInvite: true }).availableIntakePacks("token", now)).length, 0);
  assert.equal((await harness({ metadata: { deliverAt: "2026-10-17T12:00:01.000Z" } }).availableIntakePacks("token", now)).length, 0);
});
test("pack reads scope DB and photos, preserve public copy, and redact internal notes", async () => {
  const h = harness(); const result = await h.readIntakePack("token", packId, now);
  assert.equal(result.draft.social, draft.social);
  assert.equal(result.draft.sourceNotes, "");
  assert.equal(result.draft.photoNotes.length, 0);
  assert.equal(result.photos[0].id, photoId);
  assert.equal(h.queries[0].where.orgId, "org");
  assert.equal(h.queries[1].where.job.orgId, "org");
  assert.equal(h.queries[1].where.tags.has, `intake:${inviteId}`);
});
test("photo endpoint never reads storage for an unavailable pack or unselected photo", async () => {
  let downloads = 0;
  for (const pack of [null, { photos: [{ id: "other" }] }]) {
    const route = load("src/app/send-photos/[token]/packs/[packId]/photos/[photoId]/route.ts", {
      "@/lib/intake-delivery": { readIntakePack: async () => pack },
      "@/lib/supabase/admin": { supabaseAdmin: { storage: { from() { downloads++; throw new Error("Must not read"); } } } },
    });
    assert.equal((await route.GET(new Request("https://example.com"), { params: Promise.resolve({ token: "token", packId, photoId }) })).status, 404);
  }
  assert.equal(downloads, 0);
});
const audioModule = load("src/lib/intake-audio.ts", { zod: require("zod") });
const wav = Buffer.alloc(44); wav.write("RIFF"); wav.write("WAVE", 8);
const voiceBody = { token: "private-token", id: photoId, submissionId, mimeType: "audio/wav", dataUrl: `data:audio/wav;base64,${wav.toString("base64")}` };
test("voice notes check container signature, MIME type and file size", () => {
  assert.equal(audioModule.decodeAudioNote(voiceBody).length, 44);
  for (const body of [{ ...voiceBody, mimeType: "audio/mp4" }, { ...voiceBody, dataUrl: "data:audio/wav;base64,YmFk" }, { ...voiceBody, dataUrl: `data:audio/wav;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")}` }]) assert.throws(() => audioModule.decodeAudioNote(body));
});
function audioHarness(options = {}) {
  const writes = [];
  const route = load("src/app/api/field-intake/audio/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/demo": { isDemoMode: () => !!options.demo }, "@/lib/intake-audio": audioModule,
    "@/lib/field-intake": { resolveUploadInvite: async () => options.expired ? null : { id: inviteId, orgId: "org", jobId: "job" } },
    "@/lib/prisma": { prisma: { activityLog: { findUnique: async () => options.existing || null, count: async () => options.full ? 300 : 0, create: async (query) => writes.push(["db", query]) } } },
    "@/lib/supabase/admin": { supabaseAdmin: { storage: { from: () => ({ upload: async (...args) => { writes.push(["storage", args]); return { error: options.storageFailure ? {} : null }; } }) } } },
  });
  return { writes, post: (body = voiceBody, origin = "https://app.example.com") => route.POST(new Request("https://app.example.com/api/field-intake/audio", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) })) };
}
test("public audio endpoint rejects preview, invalid, expired and full links before storage", async () => {
  for (const [options, status] of [[{ demo: true }, 409], [{ expired: true }, 403], [{ full: true }, 429]]) { const h = audioHarness(options); assert.equal((await h.post()).status, status); assert.equal(h.writes.length, 0); }
  const h = audioHarness(); assert.equal((await h.post(voiceBody, "https://other.example.com")).status, 403); assert.equal(h.writes.length, 0);
  assert.equal((await h.post({ ...voiceBody, mimeType: "text/html" })).status, 400);
});
test("voice notes are privately scoped from the invite and saved as queued, not transcribed", async () => {
  const h = audioHarness(); const response = await h.post({ ...voiceBody, orgId: "forged", jobId: "forged" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "queued");
  assert.match(h.writes[0][1][0], new RegExp(`^org/job/intake/${inviteId}/voice-`));
  assert.equal(h.writes[1][1].data.orgId, "org");
  assert.equal(h.writes[1][1].data.metadata.status, "queued");
});
test("audio retries deduplicate their own invite and cannot claim another invite's record", async () => {
  const h = audioHarness({ existing: { orgId: "org", action: audioModule.AUDIO_RECEIVED, metadata: { inviteId } } }); assert.equal((await h.post()).status, 200); assert.equal(h.writes.length, 0);
  const other = audioHarness({ existing: { orgId: "other-org", action: audioModule.AUDIO_RECEIVED, metadata: { inviteId } } }); assert.equal((await other.post()).status, 409); assert.equal(other.writes.length, 0);
});
test("failed voice storage does not create a queued transcription", async () => {
  const h = audioHarness({ storageFailure: true }); assert.equal((await h.post()).status, 503); assert.equal(h.writes.filter((item) => item[0] === "db").length, 0);
});
test("upload history requires a valid invite and scopes both receipts and photos to it", async () => {
  const queries = [];
  const imports = { "@/lib/prisma": { prisma: { activityLog: { findMany: async (query) => { queries.push(query); return [{ id: packId, action: "field.photo.received", createdAt: now, metadata: { submissionId, location: "Reading", description: "Our note" } }]; } }, fileAsset: { findMany: async (query) => { queries.push(query); return [{ id: photoId, tags: [`submission:${submissionId}`], fileName: "photo.jpg" }]; } } } }, "@/lib/field-intake": { PHOTO_RECEIVED: "field.photo.received", resolveUploadInvite: async () => ({ id: inviteId, orgId: "org", jobId: "job" }) }, "@/lib/intake-audio": audioModule, "@/lib/intake-delivery": harness(), zod: require("zod") };
  const mod = load("src/lib/intake-history.ts", imports);
  const batches = await mod.intakeHistory("private-token");
  assert.equal(batches.length, 1); assert.equal(batches[0].photos[0].id, photoId);
  assert.equal(queries[0].where.orgId, "org"); assert.equal(queries[0].where.metadata.equals, inviteId);
  assert.equal(queries[1].where.job.orgId, "org"); assert.equal(queries[1].where.tags.has, `intake:${inviteId}`);
  const invalid = load("src/lib/intake-history.ts", { ...imports, "@/lib/field-intake": { ...imports["@/lib/field-intake"], resolveUploadInvite: async () => null } });
  assert.equal(await invalid.intakeHistory("bad-token"), null); assert.equal(queries.length, 2);
});
test("job history media cannot read another invite's recording or bypass photo submission scope", async () => {
  let downloads = 0; const queries = [];
  const route = load("src/app/send-photos/[token]/jobs/[submissionId]/media/[mediaId]/route.ts", {
    zod: require("zod"), "@/lib/field-intake": { resolveUploadInvite: async () => ({ id: inviteId, orgId: "org", jobId: "job" }) }, "@/lib/intake-audio": audioModule,
    "@/lib/prisma": { prisma: { fileAsset: { findFirst: async (query) => { queries.push(query); return null; } }, activityLog: { findFirst: async (query) => { queries.push(query); return { metadata: { inviteId: "other", submissionId, storageKey: "other-secret", mimeType: "audio/mp4" } }; } } } },
    "@/lib/supabase/admin": { supabaseAdmin: { storage: { from() { downloads++; throw new Error("Must not read"); } } } },
  });
  const response = await route.GET(new Request("https://example.com"), { params: Promise.resolve({ token: "token", submissionId, mediaId: photoId }) });
  assert.equal(response.status, 404); assert.equal(downloads, 0);
  assert.equal(queries[0].where.job.orgId, "org"); assert.equal(queries[0].where.tags.hasEvery.join("|"), `intake:${inviteId}|submission:${submissionId}`);
  assert.equal(queries[1].where.orgId, "org");
});
