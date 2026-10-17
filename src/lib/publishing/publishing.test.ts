import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { prepareMarketingDraft } from "@/lib/marketing";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { publishRequestSchema } from "@/lib/publishing/api-schema";
import { pausedCampaignReadiness } from "@/lib/publishing/campaigns";
import { readPublishingEnv, PROVIDER_CATALOG } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { encryptSecret, decryptSecret } from "@/lib/publishing/crypto";
import { publishOrganic, type DeliveryStore, type PublishDeps } from "@/lib/publishing/deliver";
import { encodeFacebookState } from "@/lib/publishing/providers/facebook-state";
import { createFacebookPublisher } from "@/lib/publishing/providers/facebook";
import { createOauthState, verifyOauthState } from "@/lib/publishing/oauth-state";
import { classifyMetaError } from "@/lib/publishing/provider-errors";
import { assertPausedGoogleCampaign, googleAdsPausedMutations } from "@/lib/publishing/providers/google-ads";
import { assertPausedMetaCampaign, metaPausedCampaignBody } from "@/lib/publishing/providers/meta-ads";
import { redactSecrets } from "@/lib/publishing/redact";
import { PublishRejection, type DeliveryRecord, type OrganicDestination, type OwnedAsset, type SecretConnection } from "@/lib/publishing/types";
import { buildWeeklyReport, metricDisplay } from "@/lib/marketing-reporting/report";
import { cronAuthorized, reportSendDecision, runWeeklyReport } from "@/lib/marketing-reporting/run";
import { reportingWeek } from "@/lib/marketing-reporting/week";

const orgId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const draftId = "10000000-0000-4000-8000-000000000003";
const assetId = "20000000-0000-4000-8000-000000000001";
const key = Buffer.alloc(32, 7).toString("base64");

function env(overrides: Record<string, string> = {}) {
  return readPublishingEnv({
    META_APP_ID: "app",
    META_APP_SECRET: "secret",
    GOOGLE_OAUTH_CLIENT_ID: "client",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    MARKETING_TOKEN_ENCRYPTION_KEY: key,
    GOOGLE_BUSINESS_API_ACCESS: "granted",
    GOOGLE_ADS_API_ACCESS: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    ...overrides,
  });
}

function connection(provider: SecretConnection["provider"], overrides: Partial<SecretConnection> = {}): SecretConnection {
  return {
    provider,
    status: "CONNECTED",
    accessToken: "token",
    refreshToken: provider === "GOOGLE_BUSINESS" || provider === "GOOGLE_ADS" ? "refresh" : null,
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    externalAccountId: provider === "GOOGLE_BUSINESS" ? "accounts/1/locations/2" : "111",
    externalAccountName: "RHI Pros",
    scopes: PROVIDER_CATALOG[provider].scopes,
    lastError: null,
    approvalNote: null,
    candidates: [],
    ...overrides,
  };
}

function asset(id = assetId, mimeType = "image/jpeg"): OwnedAsset {
  return { id, orgId, jobId, mimeType, fileName: "photo.jpg", fileSize: 1200, storageKey: "private/photo.jpg" };
}

function memoryStore(): DeliveryStore & { rows: DeliveryRecord[] } {
  const rows: DeliveryRecord[] = [];
  return {
    rows,
    async findByKey(org, idempotencyKey) {
      return rows.find((row) => row.orgId === org && row.idempotencyKey === idempotencyKey) ?? null;
    },
    async insert(record) {
      if (rows.some((row) => row.orgId === record.orgId && row.idempotencyKey === record.idempotencyKey)) return "conflict";
      rows.push(record);
      return record;
    },
    async update(id, patch, expectedAttemptCount) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error("missing delivery");
      if (expectedAttemptCount !== undefined && rows[index].attemptCount !== expectedAttemptCount) throw new PublishRejection("Delivery attempt changed.", 409);
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    },
    async claimRetry(record, now) {
      const current = rows.find((row) => row.id === record.id);
      if (!current || current.attemptCount !== record.attemptCount || current.status !== record.status || current.containerId !== record.containerId) return null;
      return this.update(record.id, { status: "ACCEPTED", lastError: null, acceptedAt: now, attemptCount: record.attemptCount + 1 });
    },
  };
}

function baseDeps(store: DeliveryStore, options: {
  publish?: (destination: OrganicDestination) => Promise<import("@/lib/publishing/types").ProviderOutcome>;
  poll?: (destination: OrganicDestination) => Promise<import("@/lib/publishing/types").ProviderOutcome>;
  draftOrgId?: string;
  refresh?: () => Promise<SecretConnection | null>;
  publishingEnv?: ReturnType<typeof env>;
} = {}) {
  const calls = { publish: [] as string[], poll: [] as string[], marked: [] as string[] };
  const publishingEnv = options.publishingEnv ?? env({ MARKETING_PUBLISH_MODE: "live" });
  return {
    calls,
    deps: {
      now: new Date(),
      env: publishingEnv,
      async loadApprovedDraft(requestOrg: string) {
        return { orgId: options.draftOrgId ?? requestOrg, jobId, draftId, approvalHash: "a".repeat(64), metadata: prepareMarketingDraft({ assetIds: [assetId], notes: ["Replaced the vanity."], area: "Bathroom" }) };
      },
      async loadAssets() {
        return [asset()];
      },
      async loadConnection(_org: string, destination: OrganicDestination) {
        return connection(destination);
      },
      async refresh(current: SecretConnection) {
        return options.refresh ? options.refresh() : current;
      },
      async markStatus(destination: OrganicDestination, status: string) {
        calls.marked.push(`${destination}:${status}`);
      },
      publisherFor(destination: OrganicDestination) {
        return {
          async publish() {
            calls.publish.push(destination);
            return options.publish ? options.publish(destination) : { outcome: "published" as const, providerPostId: `${destination}-post` };
          },
          async poll() {
            calls.poll.push(destination);
            return options.poll ? options.poll(destination) : { outcome: "published" as const, providerPostId: `${destination}-post` };
          },
        };
      },
      async prepareMedia(assets: OwnedAsset[]) {
        return { ok: true as const, media: assets.map((item) => ({ id: item.id, url: `https://example.test/mock/${item.id}` })) };
      },
      async releaseMedia() {},
      store,
      createId: () => crypto.randomUUID(),
    },
  };
}

test("workers cannot publish or connect accounts", () => {
  assert.equal(marketingAccessDenied(Role.WORKER), "Only an owner or admin can manage marketing connections.");
  assert.equal(marketingAccessDenied(Role.OWNER), null);
  assert.equal(marketingAccessDenied(Role.ADMIN), null);
});

test("oauth state rejects mismatch, expiry, and tampering", () => {
  const secret = "state-secret";
  const nonce = "nonce-1";
  const state = createOauthState({ orgId, userId: "user-1", flow: "meta_organic", nonce, now: 1_000 }, secret);
  assert.equal(verifyOauthState(state, secret, { nonce, orgId, userId: "user-1", now: 1_000 }).ok, true);
  assert.equal(verifyOauthState(state, secret, { nonce: "other", orgId, userId: "user-1", now: 1_000 }).ok, false);
  assert.equal(verifyOauthState(state, secret, { nonce, orgId: "other-org", userId: "user-1", now: 1_000 }).ok, false);
  const expired = verifyOauthState(state, secret, { nonce, orgId, userId: "user-1", now: 1_000 + 11 * 60 * 1000 });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "expired");
  const tampered = verifyOauthState(`${state.slice(0, -2)}aa`, secret, { nonce, orgId, userId: "user-1", now: 1_000 });
  assert.equal(tampered.ok, false);
  if (!tampered.ok) assert.equal(tampered.reason, "tampered");
});

test("tokens stay encrypted and out of error text", () => {
  const cipher = encryptSecret("page-token-value", key);
  assert.equal(cipher.includes("page-token-value"), false);
  assert.equal(decryptSecret(cipher, key), "page-token-value");
  assert.equal(redactSecrets("failed access_token=abc.def Bearer abc.def"), "failed access_token=redacted Bearer redacted");
});

test("publish requests reject remote image URLs", () => {
  const parsed = publishRequestSchema.safeParse({
    jobId,
    draftId,
    assetIds: [assetId],
    destinations: ["FACEBOOK_PAGE"],
    imageUrl: "https://evil.example/photo.jpg",
  });
  assert.equal(parsed.success, false);
});

test("a Facebook success does not hide a Google failure", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store, {
    publish(destination) {
      if (destination === "GOOGLE_BUSINESS") return Promise.resolve({ outcome: "failed", message: "Google location denied", retryable: true });
      return Promise.resolve({ outcome: "published", providerPostId: "fb-post-1" });
    },
  });
  const results = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE", "GOOGLE_BUSINESS"] }, deps);
  assert.equal(results.find((result) => result.destination === "FACEBOOK_PAGE")?.status, "PUBLISHED");
  assert.equal(results.find((result) => result.destination === "GOOGLE_BUSINESS")?.status, "FAILED");
  assert.deepEqual(calls.publish.sort(), ["FACEBOOK_PAGE", "GOOGLE_BUSINESS"]);
});

test("retrying a published post does not create another post", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store);
  const first = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  const second = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  assert.equal(first[0]?.status, "PUBLISHED");
  assert.equal(second[0]?.deduped, true);
  assert.equal(second[0]?.providerPostId, first[0]?.providerPostId);
  assert.deepEqual(calls.publish, ["FACEBOOK_PAGE"]);
});

test("concurrent retries claim a failed delivery once", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store, { publish: async () => calls.publish.length === 1 ? { outcome: "failed", message: "Retryable failure", retryable: true } : { outcome: "published", providerPostId: "confirmed-post" } });
  const command = { orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE" as const] };
  await publishOrganic(command, deps);
  const results = await Promise.all([publishOrganic(command, deps), publishOrganic(command, deps)]);
  assert.equal(calls.publish.length, 2);
  assert.equal(store.rows.length, 1); assert.equal(store.rows[0].attemptCount, 2);
  assert.ok(results.some(([result]) => result.deduped));
});

test("active Facebook uploads cannot be reclaimed just because a photo checkpoint exists", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store, { publish: async () => ({ outcome: "failed", message: "Upload interrupted", retryable: true }) });
  const command = { orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE" as const] };
  await publishOrganic(command, deps);
  store.rows[0] = { ...store.rows[0], status: "ACCEPTED", containerId: encodeFacebookState({ version: 1, fingerprint: "a".repeat(64), phase: "uploading", photos: [{ assetId, photoId: "photo-a" }] }) };
  const [result] = await publishOrganic(command, deps);
  assert.equal(result.status, "PROCESSING"); assert.equal(result.deduped, true); assert.equal(calls.publish.length, 1);
});

test("an uncertain Facebook feed outcome blocks retry before connection or provider access", async () => {
  const store = memoryStore();
  const marker = encodeFacebookState({ version: 1, fingerprint: "a".repeat(64), phase: "feed_pending", photos: [{ assetId, photoId: "photo-a" }] });
  const { deps, calls } = baseDeps(store, { publish: async () => ({ outcome: "failed", message: "Check the Page", retryable: false, containerId: marker }) });
  const command = { orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE" as const] };
  await publishOrganic(command, deps);
  deps.loadConnection = async () => { throw new Error("Must not reconnect or submit an uncertain delivery"); };
  const [result] = await publishOrganic(command, deps);
  assert.equal(result.requiresManualCheck, true); assert.equal(result.status, "FAILED"); assert.equal(calls.publish.length, 1);
  assert.equal(store.rows[0].attemptCount, 1);
});

test("a request that loses its delivery claim cannot checkpoint or submit a feed post", async () => {
  const store = memoryStore();
  const deps: PublishDeps = baseDeps(store).deps;
  let feedRequests = 0;
  deps.publisherFor = () => createFacebookPublisher(async (url) => {
    if (String(url).endsWith("/feed")) feedRequests++;
    // Another request reclaimed this attempt while its photo upload was pending.
    store.rows[0] = { ...store.rows[0], attemptCount: store.rows[0].attemptCount + 1 };
    return Response.json({ id: "photo-a" });
  }, "v-test", async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg", fileName: "photo.jpg" }));
  await assert.rejects(() => publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps), PublishRejection);
  assert.equal(feedRequests, 0); assert.equal(store.rows[0].status, "ACCEPTED");
});

test("losing the saved success after a Facebook submission cannot trigger a duplicate feed request", async () => {
  const store = memoryStore();
  const update = store.update.bind(store);
  store.update = async (id, patch, expectedAttemptCount) => {
    if (patch.status === "PUBLISHED") throw new Error("Database connection lost after Facebook responded");
    return update(id, patch, expectedAttemptCount);
  };
  const deps: PublishDeps = baseDeps(store).deps;
  let feedRequests = 0;
  deps.publisherFor = () => createFacebookPublisher(async (url) => {
    if (String(url).endsWith("/feed")) { feedRequests++; return Response.json({ id: "confirmed-post" }); }
    return Response.json({ id: "photo-a" });
  }, "v-test", async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg", fileName: "photo.jpg" }));
  const command = { orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE" as const] };
  const [first] = await publishOrganic(command, deps);
  assert.equal(first.status, "FAILED"); assert.equal(first.requiresManualCheck, true);
  const [retry] = await publishOrganic(command, deps);
  assert.equal(retry.requiresManualCheck, true); assert.equal(feedRequests, 1);
  assert.match(retry.error ?? "", /automatic retry is blocked/);
});

test("a failed delivery that already has a provider id is polled instead of posted again", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store, {
    publish: () => Promise.resolve({ outcome: "failed", message: "temporary", retryable: true, providerPostId: "post-1" }),
    poll: () => Promise.resolve({ outcome: "published", providerPostId: "post-1" }),
  });
  await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  const retried = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  assert.equal(retried[0]?.status, "PUBLISHED");
  assert.deepEqual(calls.publish, ["FACEBOOK_PAGE"]);
  assert.deepEqual(calls.poll, ["FACEBOOK_PAGE"]);
});

test("provider rate limits stay failed and are not treated as published", async () => {
  const store = memoryStore();
  const { deps } = baseDeps(store, {
    publish: () => Promise.resolve({ outcome: "failed", message: "The platform rate limit was reached. Try again later.", retryable: true, rateLimited: true }),
  });
  const [result] = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  assert.equal(result?.status, "FAILED");
  assert.match(result?.error ?? "", /rate limit/);
  const classified = classifyMetaError(429, { error: { code: 4, message: "Application request limit reached" } });
  assert.equal(classified.outcome, "failed");
  if (classified.outcome === "failed") assert.equal(classified.rateLimited, true);
});

test("an expired token is not used to publish", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store, { refresh: async () => null });
  deps.loadConnection = async (_org, destination) => connection(destination, { tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
  const [result] = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, deps);
  assert.equal(result?.status, "FAILED");
  assert.equal(calls.publish.length, 0);
  assert.equal(calls.marked[0], "FACEBOOK_PAGE:EXPIRED");
});

test("cross-organization drafts and photos outside the draft are rejected", async () => {
  const store = memoryStore();
  const otherOrg = baseDeps(store, { draftOrgId: "99999999-0000-4000-8000-000000000009" });
  await assert.rejects(
    () => publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["FACEBOOK_PAGE"] }, otherOrg.deps),
    (error: unknown) => error instanceof PublishRejection && error.status === 404,
  );
  const outside = baseDeps(store);
  await assert.rejects(
    () => publishOrganic({ orgId, jobId, draftId, assetIds: ["20000000-0000-4000-8000-000000000099"], destinations: ["FACEBOOK_PAGE"] }, outside.deps),
    (error: unknown) => error instanceof PublishRejection && error.status === 400,
  );
  assert.equal(otherOrg.calls.publish.length, 0);
});

test("Instagram rejects a non-JPEG before the provider is called", async () => {
  const store = memoryStore();
  const { deps, calls } = baseDeps(store);
  deps.loadAssets = async () => [asset(assetId, "image/png")];
  const [result] = await publishOrganic({ orgId, jobId, draftId, assetIds: [assetId], destinations: ["INSTAGRAM"] }, deps);
  assert.equal(result?.status, "FAILED");
  assert.match(result?.error ?? "", /JPEG/);
  assert.equal(calls.publish.length, 0);
});

test("weekly report runs once per organization and week", async () => {
  const saved = new Map<string, { preview: ReturnType<typeof sampleReport>; sendStatus: string }>();
  let sends = 0;
  const preview = sampleReport();
  const options = {
    orgId,
    weekStartIso: preview.period.start,
    now: new Date("2026-10-16T19:03:00.000Z"),
    decision: { send: true as const, recipient: "alivia@example.com", channel: "email" as const },
    build: async () => preview,
    store: {
      async find(id: string, week: string) {
        return saved.get(`${id}:${week}`) ?? null;
      },
      async create(row: { orgId: string; weekStartIso: string; preview: ReturnType<typeof sampleReport>; sendStatus: string }) {
        const keyId = `${row.orgId}:${row.weekStartIso}`;
        if (saved.has(keyId)) return "conflict" as const;
        saved.set(keyId, { preview: row.preview, sendStatus: row.sendStatus });
        return "created" as const;
      },
      async markSent(id: string, week: string, sendStatus: string) {
        const row = saved.get(`${id}:${week}`);
        if (row) row.sendStatus = sendStatus;
      },
    },
    deliver: async () => {
      sends += 1;
      return { sent: true };
    },
  };
  const first = await runWeeklyReport(options);
  const second = await runWeeklyReport(options);
  assert.equal(first.deduped, false);
  assert.equal(first.sent, true);
  assert.equal(second.deduped, true);
  assert.equal(sends, 1);
});

test("report sending stays off without an explicit recipient and channel", async () => {
  let sends = 0;
  const decision = reportSendDecision({});
  assert.equal(decision.send, false);
  const preview = sampleReport();
  const result = await runWeeklyReport({
    orgId,
    weekStartIso: preview.period.start,
    now: new Date(),
    decision,
    build: async () => preview,
    store: {
      async find() {
        return null;
      },
      async create() {
        return "created" as const;
      },
    },
    deliver: async () => {
      sends += 1;
      return { sent: true };
    },
  });
  assert.equal(result.sendStatus, "preview_only");
  assert.equal(sends, 0);
  assert.equal(cronAuthorized(null, null, ""), false);
  assert.equal(cronAuthorized("Bearer no", null, "secret"), false);
  assert.equal(cronAuthorized("Bearer secret", null, "secret"), true);
});

test("missing marketing metrics are not shown as zero", () => {
  const report = sampleReport();
  assert.equal(metricDisplay(report.phoneClickEvents), "Unavailable");
  assert.equal(metricDisplay(report.adSpend), "Not connected");
  assert.equal(metricDisplay(report.costPerQualifiedLead), "Not connected");
  assert.equal(JSON.stringify(report).includes("accessToken"), false);
});

test("the reporting week is the previous completed Monday through Sunday in Eastern time", () => {
  const friday = reportingWeek(new Date("2026-10-16T19:03:00.000Z"));
  assert.equal(friday.start.toISOString(), "2026-10-05T04:00:00.000Z");
  assert.equal(friday.end.toISOString(), "2026-10-12T04:00:00.000Z");
  assert.equal(friday.label, "Oct 5–11, 2026");
  const monday = reportingWeek(new Date("2026-10-12T14:00:00.000Z"));
  assert.equal(monday.start.toISOString(), friday.start.toISOString());
});

test("connections are not usable before permissions and platform access are granted", () => {
  const now = new Date();
  const missingScope = presentConnection("FACEBOOK_PAGE", connection("FACEBOOK_PAGE", { scopes: ["pages_show_list"] }), env(), now);
  assert.equal(missingScope.status, "PENDING_PLATFORM_APPROVAL");
  const gbp = presentConnection("GOOGLE_BUSINESS", connection("GOOGLE_BUSINESS"), env({ GOOGLE_BUSINESS_API_ACCESS: "" }), now);
  assert.equal(gbp.status, "PENDING_PLATFORM_APPROVAL");
  assert.match(gbp.note, /Basic API Access/);
});

test("ad campaign creation stays paused and blocked until the exact draft is approved", () => {
  const mutations = googleAdsPausedMutations({
    customerId: "1234567890",
    name: "RHI Pros",
    budgetAmountCents: 2500,
    startDate: "2026-10-20",
    endDate: "2026-10-27",
    budgetResourceName: "customers/1234567890/campaignBudgets/1",
  });
  assert.equal(mutations.campaign.operations[0]?.create.status, "PAUSED");
  assert.equal(JSON.stringify(mutations).includes("ENABLED"), false);
  assert.doesNotThrow(() => assertPausedGoogleCampaign(mutations.campaign));
  const meta = metaPausedCampaignBody({ name: "RHI Pros" });
  assert.equal(meta.status, "PAUSED");
  assert.equal(JSON.stringify(meta).includes("ACTIVE"), false);
  assert.doesNotThrow(() => assertPausedMetaCampaign(meta));
  const readiness = pausedCampaignReadiness({
    presented: presentConnection("GOOGLE_ADS", connection("GOOGLE_ADS"), env(), new Date()),
    provider: "GOOGLE_ADS",
    status: "DRAFT",
    approvedHash: "abc",
    currentHash: "abc",
    scheduleEnd: new Date("2026-12-01T00:00:00.000Z"),
    now: new Date("2026-10-16T00:00:00.000Z"),
  });
  assert.equal(readiness.ok, false);
  if (!readiness.ok) assert.match(readiness.missingStep, /Approve/);
});

function sampleReport() {
  const period = reportingWeek(new Date("2026-10-16T19:03:00.000Z"));
  return buildWeeklyReport({
    generatedAt: new Date("2026-10-16T19:03:00.000Z"),
    period,
    deliveriesAvailable: true,
    deliveries: [],
    quoteSubmissions: 0,
    attributableQuoteSubmissions: 0,
    loggedCalls: 0,
    bookedJobs: 0,
    providerMetrics: [{ kind: "missing", label: "Facebook Page metrics", state: "not_connected", source: "Connect Facebook." }],
    adSpend: { state: "not_connected", source: "Connect an ad account before spend can be read." },
  });
}
