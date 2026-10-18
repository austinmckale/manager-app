import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, imports, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); }, Response, Request, URL, Buffer, crypto, process: { env: {} }, console: { error() {} }, ...globals }, { filename: file });
  return exports;
}
const marketing = load("src/lib/marketing.ts", { zod: require("zod") });
const assetId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000001";
const auth = { userId: "owner", orgId: "org-one", role: "OWNER" };
const photo = { id: assetId, jobId, fileName: "job.jpg", storageKey: "org-one/job/job.jpg", stage: "AFTER", mimeType: "image/jpeg", tags: [], isPortfolio: false, job: { categoryTags: ["bathroom-remodeling"] } };
const manage = { canManageOrg: (role) => role === "OWNER" || role === "ADMIN" };

function routeHarness(options = {}) {
  const changes = [];
  const api = load("src/app/api/marketing/route.ts", {
    "next/server": { NextResponse: Response }, "next/cache": { revalidatePath() {} }, zod: require("zod"),
    "@/lib/auth": { requireAuth: async () => { if (options.unauthenticated) throw new Error("Unauthorized"); return { ...auth, role: options.role ?? "OWNER" }; } },
    "@/lib/permissions": manage, "@/lib/demo": { isDemoMode: () => Boolean(options.demo) }, "@/lib/marketing": marketing,
    "@/lib/marketing-review": { setPhotoPublication: async (...args) => { changes.push(["publish", ...args]); return { completed: 1, failures: [], warning: "" }; } },
    "@/lib/prisma": { prisma: {
      fileAsset: { findMany: async (query) => { assert.equal(query.where.job.orgId, "org-one"); return options.assets ?? [photo]; }, update: async (query) => changes.push(["update", query]), updateMany: async (query) => changes.push(["updateMany", query]) },
      job: { findFirst: async () => options.destination ?? { id: jobId } },
      activityLog: { create: async (query) => { changes.push(["log", query]); return { id: crypto.randomUUID() }; } },
      $transaction: async (ops) => Promise.all(ops),
    } },
  });
  return { changes, post: (body, origin = "http://localhost:3107") => api.POST(new Request("http://localhost:3107/api/marketing", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) })) };
}

test("draft starting points use supplied notes and respect platform text limits", () => {
  const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Installed the shower tile.", "Installed the shower tile."] });
  assert.equal(marketing.marketingDraftSchema.safeParse(draft).success, true);
  assert.equal(draft.sourceNotes.includes("Installed the shower tile."), true);
  assert.equal(draft.social.includes("Installed"), false);
  assert.doesNotMatch(draft.social, /insurance|warranty|Reading|customer|quartz/i);
  const privateDraft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Customer Jane at 12 Oak Street, 610-555-0100."] });
  assert.equal(privateDraft.sourceNotes.includes("Jane"), true);
  assert.equal(privateDraft.social.includes("Jane"), false);
  assert.equal(privateDraft.social.includes("610-555-0100"), false);
  const large = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["a".repeat(24000)] });
  assert.equal(marketing.marketingDraftSchema.safeParse(large).success, true);
  assert.equal(marketing.marketingDraftSchema.safeParse({ ...draft, googleHeadlines: ["x".repeat(31), "two", "three"] }).success, false);
  assert.equal(marketing.marketingDraftSchema.safeParse({ ...draft, landingUrl: "javascript:alert(1)" }).success, false);
});
test("only finished, browser-friendly, unarchived photos are website candidates", () => {
  assert.equal(marketing.canPublishPhoto(photo), true);
  for (const extra of [{ stage: "BEFORE" }, { stage: "DURING" }, { mimeType: "image/heic" }, { tags: [marketing.ARCHIVED_PHOTO_TAG] }]) assert.equal(marketing.canPublishPhoto({ ...photo, ...extra }), false);
});
test("marketing rejects cross-origin, unauthenticated and worker mutations", async () => {
  for (const [options, expected] of [[{ unauthenticated: true }, 401], [{ role: "WORKER" }, 403]]) {
    const h = routeHarness(options); assert.equal((await h.post({ action: "archive", assetIds: [assetId] })).status, expected); assert.equal(h.changes.length, 0);
  }
  const h = routeHarness(); assert.equal((await h.post({ action: "archive", assetIds: [assetId] }, "https://unrelated.example")).status, 403); assert.equal(h.changes.length, 0);
});
test("publish requires explicit public-use clearance", async () => {
  const h = routeHarness(); assert.equal((await h.post({ action: "publish", assetIds: [assetId] })).status, 400); assert.equal(h.changes.length, 0);
});
test("a missing or other-org asset prevents every mutation", async () => {
  const h = routeHarness({ assets: [] }); assert.equal((await h.post({ action: "publish", assetIds: [assetId], clearedForPublicUse: true })).status, 404); assert.equal(h.changes.length, 0);
});
test("demo mutations never pretend to save or publish", async () => {
  const h = routeHarness({ demo: true }); assert.equal((await h.post({ action: "archive", assetIds: [assetId] })).status, 409); assert.equal(h.changes.length, 0);
});
test("drafts cannot combine photos from another job", async () => {
  const h = routeHarness(); const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: [] });
  assert.equal((await h.post({ action: "saveDraft", jobId: secondId, draft })).status, 400); assert.equal(h.changes.length, 0);
});
test("valid drafts persist selected photos and approved text under the owner's org", async () => {
  const h = routeHarness(); const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Real job note"] });
  assert.equal((await h.post({ action: "saveDraft", jobId, draft })).status, 200);
  const record = h.changes[0][1].data; assert.equal(record.orgId, auth.orgId); assert.equal(record.jobId, jobId); assert.equal(record.metadata.social, draft.social);
});
test("saving a second pack version keeps the previous inputs and returns separate saved IDs", async () => {
  const h = routeHarness();
  const draft = { ...marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Built the pavilion."], location: "Reading, PA", packName: "Pavilion", area: "Patio" }), photoNotes: [{ assetId, description: "Finished pavilion", area: "Patio", stage: "AFTER" }] };
  const first = await (await h.post({ action: "saveDraft", jobId, draft })).json();
  const second = await (await h.post({ action: "saveDraft", jobId, draft: { ...draft, social: "A different post.", packName: "Pavilion repost" } })).json();
  assert.notEqual(first.draftId, second.draftId);
  assert.equal(h.changes.length, 2);
  const original = h.changes[0][1].data.metadata;
  assert.equal(original.packName, "Pavilion"); assert.equal(original.sourceNotes, "Built the pavilion."); assert.equal(original.publicLocation, "Reading, PA"); assert.equal(original.photoNotes[0].description, "Finished pavilion");
  assert.notEqual(original.social, h.changes[1][1].data.metadata.social);
});
test("older saved drafts gain empty input fields without losing their existing captions", () => {
  const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Original text"] });
  for (const key of ["packName", "sourceNotes", "publicLocation", "service", "photoNotes"]) delete draft[key];
  const parsed = marketing.marketingDraftSchema.parse(draft);
  assert.equal(parsed.social, draft.social); assert.equal(parsed.sourceNotes, ""); assert.equal(parsed.photoNotes.length, 0);
});
test("browser preview packs retain distinct immutable copies and tolerate invalid stored data", () => {
  const storage = new Map();
  const saved = load("src/lib/saved-marketing.ts", { zod: require("zod"), "@/lib/marketing": marketing }, { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, window: { dispatchEvent() {} }, Event });
  const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Original input"], location: "Reading, PA" });
  saved.saveDemoPack({ id: assetId, jobId, jobName: "Pavilion", createdAt: "2026-10-16T19:00:00Z", draft });
  draft.social = "Repost version";
  saved.saveDemoPack({ id: secondId, jobId, jobName: "Pavilion", createdAt: "2026-10-16T19:05:00Z", draft });
  const packs = saved.readDemoPacks(); assert.equal(packs.length, 2); assert.equal(packs[0].draft.social, "Repost version"); assert.notEqual(packs[1].draft.social, "Repost version");
  storage.set(saved.DEMO_PACK_KEY, "invalid-json"); assert.equal(saved.readDemoPacks().length, 0);
});
test("website example has platform-valid text, factual job inputs and its own project URL", () => {
  const example = load("src/lib/marketing-example.ts", { "@/lib/marketing": marketing });
  assert.equal(marketing.marketingDraftSchema.safeParse(example.exampleDraft).success, true);
  assert.match(example.exampleDraft.landingUrl, /reading-paver-patio-buildout$/);
  assert.equal(example.exampleDraft.publicLocation, "Reading, PA"); assert.equal(example.examplePhotos.length, 2);
});
test("published photos cannot be silently moved, archived or edited", async () => {
  for (const body of [{ action: "assign", jobId, assetIds: [assetId] }, { action: "archive", assetIds: [assetId] }, { action: "updatePhoto", assetIds: [assetId], description: "new", stage: "BEFORE" }]) {
    const h = routeHarness({ assets: [{ ...photo, isPortfolio: true }] }); assert.equal((await h.post(body)).status, 400); assert.equal(h.changes.length, 0);
  }
});

function publicationHarness(options = {}) {
  const events = [];
  const service = load("src/lib/marketing-review.ts", {
    "@/lib/permissions": manage, "@/lib/marketing": marketing,
    "@/lib/prisma": { prisma: {
      fileAsset: { findMany: async (query) => { assert.equal(query.where.job.orgId, auth.orgId); return options.assets ?? [photo]; }, update: async (query) => { events.push(["db", query.data.isPortfolio]); } },
      activityLog: { create: async () => events.push(["audit"]) }, $transaction: async (ops) => Promise.all(ops),
    } },
    "@/lib/portfolio-publish": { ensureSitePublicBucket: async () => events.push(["bucket"]), publishToSiteBucket: async (key) => { events.push(["copy", key]); return !options.copyFails && key !== "bad"; }, unpublishFromSiteBucket: async () => events.push(["remove"]) },
    "@/lib/revalidate-site": { revalidateSitePortfolio: async () => { events.push(["refresh"]); if (options.refreshFails) throw new Error("offline"); return true; } },
  });
  return { events, set: (publish = true, user = auth) => service.setPhotoPublication(user, (options.assets ?? [photo]).map((asset) => asset.id), publish) };
}
test("website publishes only after the public copy exists, then refreshes after DB update", async () => {
  const h = publicationHarness(); assert.equal((await h.set()).completed, 1);
  const names = h.events.map((event) => event[0]); assert.ok(names.indexOf("copy") < names.indexOf("db")); assert.ok(names.indexOf("db") < names.indexOf("refresh"));
});
test("copy failure never turns on portfolio and partial failure is visible", async () => {
  const h = publicationHarness({ copyFails: true }); const failed = await h.set(); assert.equal(failed.completed, 0); assert.equal(failed.failures.length, 1); assert.equal(h.events.some((event) => event[0] === "db"), false);
  const mixed = publicationHarness({ assets: [photo, { ...photo, id: secondId, storageKey: "bad" }] }); const result = await mixed.set(); assert.equal(result.completed, 1); assert.equal(result.failures.length, 1);
});
test("website unpublishing removes feed flag before deleting the public file", async () => {
  const h = publicationHarness(); await h.set(false); assert.equal(h.events[0][0], "db"); assert.equal(h.events[0][1], false); assert.ok(h.events.findIndex((event) => event[0] === "remove") < h.events.findIndex((event) => event[0] === "refresh"));
});
test("refresh failure is reported without claiming photo publishing failed", async () => {
  const h = publicationHarness({ refreshFails: true }); const result = await h.set(); assert.equal(result.completed, 1); assert.match(result.warning, /refresh failed/i);
});
test("publication service independently blocks workers and unfinished/unsorted photos", async () => {
  const h = publicationHarness(); await assert.rejects(() => h.set(true, { ...auth, role: "WORKER" }), /owner or admin/); assert.equal(h.events.length, 0);
  for (const asset of [{ ...photo, stage: "DURING" }, { ...photo, job: { categoryTags: ["photo-dump"] } }]) { const guard = publicationHarness({ assets: [asset] }); await assert.rejects(() => guard.set(), /Assign photos/); assert.equal(guard.events.length, 0); }
});

test("lost upload responses can be retried without creating or publishing another photo", async () => {
  let saved = null;
  let uploaded = 0;
  let created = 0;
  const api = load("src/app/api/uploads/route.ts", {
    "node:buffer": { Buffer }, "@prisma/client": require("@prisma/client"), "next/server": { NextResponse: Response }, zod: require("zod"),
    "@/lib/auth": { requireAuth: async () => auth }, "@/lib/demo": { isDemoMode: () => false },
    "@/lib/joist-document": { combineDescriptions: (note) => note, extractJoistDocumentFromFileName() {}, extractJoistDocumentFromText() {} },
    "@/lib/pdf-parse-server": { extractPdfText() { throw new Error("Not a PDF"); } },
    "@/lib/supabase/admin": { supabaseAdmin: { storage: { from: () => ({ upload: async () => { uploaded++; return { error: null }; } }) } } },
    "@/lib/prisma": { prisma: {
      job: { findFirst: async (query) => { assert.equal(query.where.orgId, auth.orgId); return { id: jobId }; } },
      fileAsset: { findFirst: async () => saved, create: async ({ data }) => { created++; saved = data; return data; } },
      activityLog: { create: async () => ({}) },
    } },
  });
  const body = { id: assetId, jobId, fileName: "job.jpg", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/", fileType: "PHOTO", stage: "AFTER", tags: [], isPortfolio: true };
  const request = () => new Request("http://localhost/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await api.POST(request())).status, 200);
  assert.equal((await api.POST(request())).status, 200);
  assert.equal(created, 1); assert.equal(uploaded, 1); assert.equal(saved.id, assetId); assert.equal(saved.isPortfolio, false);
});

function inviteHarness(options = {}) {
  const queries = [];
  const service = load("src/lib/field-intake.ts", {
    "node:crypto": require("node:crypto"), zod: require("zod"), "@/lib/permissions": manage,
    "@/lib/prisma": { prisma: { activityLog: { findFirst: async (query) => {
      queries.push(query);
      if (query.where.action === "field.invite.revoked") return options.revoked ? { id: secondId } : null;
      return { id: assetId, orgId: auth.orgId, job: { id: jobId, orgId: options.wrongOrg ? "other-org" : auth.orgId }, metadata: { label: "Crew", expiresAt: options.expired ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z" } };
    } } } },
  }, { process: { env: { FIELD_INTAKE_SECRET: "test-only-strong-secret-never-production" } } });
  return { ...service, queries };
}
test("upload links require a valid signature and reject expiry, revocation and mismatched orgs", async () => {
  const h = inviteHarness(); const token = h.uploadInviteToken(assetId);
  assert.equal((await h.resolveUploadInvite(token)).jobId, jobId);
  const requests = h.queries.length;
  assert.equal(await h.resolveUploadInvite(`${assetId}.${"a".repeat(43)}`), null);
  assert.equal(await h.resolveUploadInvite(`${assetId}.${"☃".repeat(43)}`), null);
  assert.equal(h.queries.length, requests);
  for (const options of [{ expired: true }, { revoked: true }, { wrongOrg: true }]) { const guard = inviteHarness(options); assert.equal(await guard.resolveUploadInvite(guard.uploadInviteToken(assetId)), null); }
});
test("intake rejects non-photo bytes and excessive image payloads", () => {
  const h = inviteHarness(); assert.equal(h.decodeIntakePhoto("data:image/jpeg;base64,/9j/").length, 3);
  assert.throws(() => h.decodeIntakePhoto("data:image/jpeg;base64,PHNjcmlwdD4="), /valid photo/);
  const large = Buffer.alloc(3 * 1024 * 1024, 0xff); large[1] = 0xd8;
  assert.throws(() => h.decodeIntakePhoto(`data:image/jpeg;base64,${large.toString("base64")}`), /valid photo/);
});
function crewRouteHarness(options = {}) {
  let record = null; const calls = [];
  const actual = inviteHarness();
  const route = load("src/app/api/field-intake/route.ts", {
    "@/lib/marketing-alerts": { notifyIntakeReceived: async () => undefined },
    "next/server": { NextResponse: Response }, "next/cache": { revalidatePath() {} }, "@/lib/demo": { isDemoMode: () => Boolean(options.demo) },
    "@/lib/field-intake": { ...actual, resolveUploadInvite: async () => options.invalid ? null : { id: assetId, jobId, orgId: auth.orgId } },
    "@/lib/supabase/admin": { supabaseAdmin: { storage: { from: () => ({ upload: async () => { calls.push("storage"); return { error: options.storageFails ? new Error("offline") : null }; } }) } } },
    "@/lib/prisma": { prisma: { fileAsset: {
      findFirst: async (query) => { assert.equal(query.where.job.orgId, auth.orgId); return record; }, count: async () => options.full ? 300 : 0,
      create: async ({ data }) => { calls.push("db"); record = data; return data; },
    }, activityLog: { create: async (query) => { calls.push("audit"); assert.equal(query.data.orgId, auth.orgId); } }, $transaction: (ops) => Promise.all(ops) } },
  });
  const body = { token: "valid-test-token", id: secondId, submissionId: jobId, location: "Reading, PA", description: "Built the pavilion.", stage: null, fileName: "photo.jpg", dataUrl: "data:image/jpeg;base64,/9j/", orgId: "malicious-other-org", jobId: "malicious-other-job" };
  return { calls, get record() { return record; }, post: (origin = "http://localhost:3107") => route.POST(new Request("http://localhost:3107/api/field-intake", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) })) };
}
test("crew submissions use only the invite's inbox and stay unpublished, with retry deduplication", async () => {
  const h = crewRouteHarness(); assert.equal((await h.post()).status, 200); assert.equal((await h.post()).status, 200);
  assert.equal(h.record.jobId, jobId); assert.equal(h.record.isPortfolio, false); assert.equal(h.record.isClientVisible, false); assert.equal(h.record.stage, null);
  assert.match(h.record.description, /Reading, PA/); assert.equal(h.calls.filter((call) => call === "db").length, 1);
});
test("invalid, full, preview and cross-origin upload links never write photo data", async () => {
  for (const [options, status] of [[{ invalid: true }, 403], [{ full: true }, 429], [{ demo: true }, 409]]) { const h = crewRouteHarness(options); assert.equal((await h.post()).status, status); assert.equal(h.calls.length, 0); }
  const h = crewRouteHarness(); assert.equal((await h.post("https://other.example")).status, 403); assert.equal(h.calls.length, 0);
});
test("failed photo storage never creates an inbox photo or reports success", async () => {
  const h = crewRouteHarness({ storageFails: true }); assert.equal((await h.post()).status, 503); assert.equal(h.record, null); assert.equal(h.calls.includes("db"), false);
});
