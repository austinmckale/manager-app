import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const orgId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const draftId = "10000000-0000-4000-8000-000000000003";
const assetId = "20000000-0000-4000-8000-000000000001";
const inviteId = "30000000-0000-4000-8000-000000000001";
const submissionId = "40000000-0000-4000-8000-000000000001";
type Row = { id: string; orgId: string; jobId: string; action: string; metadata: Record<string, unknown>; createdAt: Date; job?: { jobName: string } };
type Query = { id?: string; orgId?: string; jobId?: string; action?: string | { in: string[] }; AND?: Query[]; metadata?: { path: string[]; equals: unknown } };

// Run the real routes, executor, approval store and mock provider against memory.
// Every network, account and storage operation throws if the dry run touches it.
function fixture() {
  const activity: Row[] = [];
  const deliveries: Record<string, unknown>[] = [];
  const env: Record<string, string> = {};
  const calls = { network: 0, connection: 0, storage: 0 };
  let authenticated = true;
  let email = "austinmck17@gmail.com";
  let beforeInsert: (() => void) | undefined;
  const photo = { id: assetId, jobId, type: "PHOTO", description: "Finished pavilion", stage: "AFTER", updatedAt: new Date("2026-10-17T12:00:00Z"), tags: [`intake:${inviteId}`, `submission:${submissionId}`], fileName: "pavilion-finished.jpg", mimeType: "image/jpeg", fileSize: 1200, storageKey: "private/original.jpg" };
  function matches(row: Row, where: Query): boolean {
    for (const key of ["id", "orgId", "jobId"] as const) if (where[key] && row[key] !== where[key]) return false;
    if (typeof where.action === "string" && row.action !== where.action) return false;
    if (typeof where.action === "object" && !where.action.in.includes(row.action)) return false;
    if (where.AND && !where.AND.every((item) => matches(row, item))) return false;
    if (where.metadata && row.metadata[where.metadata.path[0]] !== where.metadata.equals) return false;
    return true;
  }
  const prisma = {
    activityLog: { findFirst: async ({ where }: { where: Query }) => activity.find((row) => matches(row, where)) || null, findMany: async ({ where }: { where: Query }) => activity.filter((row) => matches(row, where)) },
    fileAsset: { findMany: async ({ where }: { where: { id: { in: string[] }; jobId?: string; job?: { orgId: string; id?: string } } }) => where.id.in.includes(assetId) && (!where.jobId || where.jobId === jobId) && (!where.job || where.job.orgId === orgId) ? [photo] : [] },
    marketingConnection: { findUnique: async () => { calls.connection++; throw new Error("Account access forbidden in mock mode"); } },
    marketingDelivery: {
      findUnique: async ({ where }: { where: { orgId_idempotencyKey: { orgId: string; idempotencyKey: string } } }) => deliveries.find((row) => row.orgId === where.orgId_idempotencyKey.orgId && row.idempotencyKey === where.orgId_idempotencyKey.idempotencyKey) || null,
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => deliveries.find((row) => row.id === where.id && row.orgId === where.orgId) || null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { ...data }; deliveries.push(row); beforeInsert?.(); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = deliveries.find((item) => item.id === where.id)!; Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); return row; },
    },
  };
  const forbiddenNetwork = () => { calls.network++; throw new Error("External requests forbidden in the approved dry run"); };
  const mocks: Record<string, unknown> = {
    "@/lib/prisma": { prisma },
    "@/lib/supabase/admin": { supabaseAdmin: { storage: { from() { calls.storage++; throw new Error("Private media must remain private in mock mode"); } } } },
    "@/lib/field-intake": { PHOTO_RECEIVED: "field.photo.received" },
    "@/lib/auth": { requireAuth: async (options: { allowFallback: boolean }) => { assert.equal(options.allowFallback, false); if (!authenticated) throw new Error("Unauthorized"); return { orgId, userId: "owner", email, role: "OWNER" }; } },
    "@/lib/demo": { isDemoMode: () => false },
    "next/server": { NextResponse: Response },
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    const file = path.endsWith(".ts") ? path : `${path}.ts`;
    if (cache.has(file)) return cache.get(file)!;
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, require(id: string) { if (id in mocks) return mocks[id]; if (id.startsWith("@/")) return load(resolve(root, id.slice(2))); if (id.startsWith(".")) return load(resolve(dirname(file), id)); return require(id); }, Date, Set, Map, Buffer, URL, Request, Response, Headers, AbortSignal, setTimeout, clearTimeout, process: { env }, fetch: forbiddenNetwork }, { filename: file });
    return exports;
  }
  const marketing = load(resolve(root, "lib/marketing")) as typeof import("@/lib/marketing");
  const review = load(resolve(root, "lib/content-review")) as typeof import("@/lib/content-review");
  const store = load(resolve(root, "lib/content-review-store")) as typeof import("@/lib/content-review-store");
  const draft = marketing.prepareMarketingDraft({ assetIds: [assetId], notes: ["Built a pavilion in Reading."], area: "Outdoor space" });
  activity.push({ id: draftId, orgId, jobId, action: marketing.DRAFT_SAVED_ACTION, metadata: draft, createdAt: new Date(), job: { jobName: "Reading pavilion" } });
  activity.push({ id: "receipt", orgId, jobId, action: "field.photo.received", metadata: { inviteId, submissionId, location: "Reading", description: "Built a pavilion." }, createdAt: new Date() });
  activity.push({ id: "audio", orgId, jobId, action: "field.audio.received", metadata: { inviteId, submissionId, storageKey: `${orgId}/private/voice.m4a`, mimeType: "audio/mp4", status: "transcribed", transcript: "We built a pavilion in Reading." }, createdAt: new Date() });
  async function approve() {
    const context = await store.loadContentReview(orgId, draftId);
    assert.ok(context);
    activity.push({ id: context.reviewId, orgId, jobId, action: review.REVIEW_REQUEST, metadata: { draftId, inputHash: context.inputHash, requestedAt: new Date().toISOString(), status: "completed", result: { summary: "Synthetic test review passed.", findings: [] } }, createdAt: new Date() });
    activity.push({ id: `approval-${activity.length}`, orgId, jobId, action: review.REVIEW_APPROVAL, metadata: { draftId, inputHash: context.inputHash }, createdAt: new Date() });
    return context.inputHash;
  }
  function request(path: "publish" | "retry", body: unknown, origin = "https://app.rhipros.com") {
    const route = load(resolve(root, `app/api/publishing/${path}/route`)) as { POST: (request: Request) => Promise<Response> };
    return route.POST(new Request(`https://app.rhipros.com/api/publishing/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  }
  const command = { jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] };
  return { activity, deliveries, photo, draft, env, calls, approve, command, request, load, authenticate(value: boolean) { authenticated = value; }, setEmail(value: string) { email = value; }, beforeInsert(fn: () => void) { beforeInsert = fn; }, review };
}

test("direct publishing API rejects a missing owner approval and ignores forged approval flags", async () => {
  const f = fixture();
  assert.equal((await f.request("publish", f.command)).status, 409);
  assert.equal((await f.request("publish", { ...f.command, approved: true })).status, 400);
  assert.equal(f.deliveries.length, 0); assert.equal(f.calls.network, 0);
});

test("publishing requires the authenticated dashboard owner and same-origin requests", async () => {
  const f = fixture(); await f.approve();
  f.authenticate(false); assert.equal((await f.request("publish", f.command)).status, 401);
  f.authenticate(true); f.setEmail("rhisolutions316@gmail.com"); assert.equal((await f.request("publish", f.command)).status, 403);
  f.setEmail("austinmck17@gmail.com"); assert.equal((await f.request("publish", f.command, "https://other.example")).status, 403);
  assert.equal(f.deliveries.length, 0);
});

test("DEMONSTRATION: approved Facebook dry run shows exact copy/photos without external requests", async (t) => {
  const f = fixture(); const hash = await f.approve();
  const response = await f.request("publish", f.command); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true); assert.equal(result.mode, "mock");
  const delivery = result.results[0];
  assert.equal(delivery.status, "SIMULATED"); assert.equal(delivery.mock, true); assert.equal(delivery.providerPostId, null);
  assert.equal(delivery.simulation.approvalHash, hash); assert.equal(delivery.simulation.text, f.draft.social);
  assert.equal(delivery.simulation.photos[0].id, assetId); assert.equal(delivery.simulation.photos[0].fileName, f.photo.fileName);
  assert.equal(f.deliveries[0].status, "ACCEPTED"); assert.equal(f.deliveries[0].publishedAt, null);
  assert.equal(f.calls.network + f.calls.storage + f.calls.connection, 0);
  assert.ok(!JSON.stringify(result).includes("storageKey"));
  const again = await (await f.request("publish", f.command)).json();
  assert.equal(again.results[0].deduped, true); assert.equal(f.deliveries.length, 1);
  t.diagnostic(JSON.stringify({ mode: result.mode, status: delivery.status, providerPostId: delivery.providerPostId, caption: delivery.simulation.text, photos: delivery.simulation.photos, externalRequests: f.calls.network, publishedAt: f.deliveries[0].publishedAt }));
});

test("editing draft copy, receipt notes, photo evidence or raw transcripts invalidates approval", async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.draft.social = "Different unapproved public copy."; },
    (f: ReturnType<typeof fixture>) => { f.activity.find((row) => row.id === "receipt")!.metadata.description = "Changed source notes."; },
    (f: ReturnType<typeof fixture>) => { f.photo.description = "Changed photo evidence."; },
    (f: ReturnType<typeof fixture>) => { f.activity.find((row) => row.id === "audio")!.metadata.transcript = "Changed raw transcript."; },
  ];
  for (const change of changes) {
    const f = fixture(); await f.approve(); change(f);
    assert.equal((await f.request("publish", f.command)).status, 409); assert.equal(f.deliveries.length, 0); assert.equal(f.calls.network, 0);
  }
});

test("superseded drafts and photos outside the approved selection are rejected", async () => {
  const f = fixture(); await f.approve();
  assert.equal((await f.request("publish", { ...f.command, assetIds: ["20000000-0000-4000-8000-000000000099"] })).status, 400);
  f.activity.push({ id: "superseded", orgId, jobId, action: f.review.REVIEW_SUPERSEDED, metadata: { draftId }, createdAt: new Date() });
  assert.equal((await f.request("publish", f.command)).status, 409); assert.equal(f.deliveries.length, 0);
});

test("retry API refuses stale evidence even after that evidence is separately re-approved", async () => {
  const f = fixture(); await f.approve();
  const first = await (await f.request("publish", f.command)).json();
  f.photo.description = "Owner corrected the photo evidence.";
  assert.equal((await f.request("retry", { deliveryId: first.results[0].deliveryId })).status, 409);
  await f.approve();
  assert.equal((await f.request("retry", { deliveryId: first.results[0].deliveryId })).status, 409);
  assert.equal(f.deliveries.length, 1); assert.equal(f.calls.network, 0);
});

test("retry cannot change a simulation into a live publishing attempt", async () => {
  const f = fixture(); await f.approve();
  const first = await (await f.request("publish", f.command)).json();
  f.env.MARKETING_PUBLISH_MODE = "live";
  assert.equal((await f.request("retry", { deliveryId: first.results[0].deliveryId })).status, 409);
  assert.equal(f.calls.connection + f.calls.network + f.calls.storage, 0);
});

test("approval is rechecked after the delivery claim and before the mock provider runs", async () => {
  const f = fixture(); await f.approve();
  f.beforeInsert(() => { f.photo.description = "Source changed during the request."; });
  assert.equal((await f.request("publish", f.command)).status, 409);
  assert.equal(f.deliveries[0].status, "FAILED"); assert.equal(f.deliveries[0].providerPostId, null); assert.equal(f.calls.network, 0);
});

test("retry remains scoped to its organization and unchanged approved simulations deduplicate", async () => {
  const f = fixture(); await f.approve();
  const first = await (await f.request("publish", f.command)).json();
  const retry = await (await f.request("retry", { deliveryId: first.results[0].deliveryId })).json();
  assert.equal(retry.results[0].status, "SIMULATED"); assert.equal(retry.results[0].deduped, true);
  f.deliveries[0].orgId = "another-organization";
  assert.equal((await f.request("retry", { deliveryId: first.results[0].deliveryId })).status, 404);
});
