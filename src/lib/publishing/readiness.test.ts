import assert from "node:assert/strict";
import test from "node:test";
import { readPublishingEnv, PROVIDER_CATALOG } from "@/lib/publishing/config";
import { facebookReadiness } from "@/lib/publishing/readiness";
import type { SecretConnection } from "@/lib/publishing/types";

const now = new Date("2026-10-17T20:00:00Z");
const configured = { META_APP_ID: "synthetic-app", META_APP_SECRET: "synthetic-secret", MARKETING_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MARKETING_PUBLISH_MODE: "live" };
const connection: SecretConnection = { provider: "FACEBOOK_PAGE", status: "CONNECTED", accessToken: "synthetic-token", refreshToken: null, tokenExpiresAt: "2026-10-18T20:00:00Z", externalAccountId: "synthetic-page", externalAccountName: "Test Page", scopes: PROVIDER_CATALOG.FACEBOOK_PAGE.scopes, lastError: null, approvalNote: null, candidates: [] };
const ready = () => ({ env: readPublishingEnv(configured), tables: { connections: true, deliveries: true }, connection, approval: { state: "APPROVED" as const, draftId: "synthetic-draft", approvalHash: "a".repeat(64) }, now });

test("readiness distinguishes a stored live connection from a simulation", () => {
  const live = facebookReadiness(ready());
  assert.equal(live.status, "READY_TO_POST"); assert.equal(live.canPublish, true); assert.equal(live.canSimulate, false);
  assert.equal(live.authorizationCheck, "stored_only");
  const mock = facebookReadiness({ ...ready(), env: readPublishingEnv({}) , connection: null });
  assert.equal(mock.status, "READY_FOR_SIMULATION"); assert.equal(mock.canSimulate, true); assert.equal(mock.canPublish, false);
  assert.ok(mock.liveBlockers.some((item) => item.code === "SIMULATION_MODE"));
  assert.equal(JSON.stringify(live).includes("synthetic-token"), false);
  assert.equal(JSON.stringify(live).includes("synthetic-secret"), false);
});

test("either missing publishing table blocks readiness even for an approved simulation", () => {
  for (const tables of [{ connections: false, deliveries: true }, { connections: true, deliveries: false }]) {
    const result = facebookReadiness({ ...ready(), env: readPublishingEnv({}), tables });
    assert.equal(result.canPublish, false); assert.equal(result.canSimulate, false); assert.equal(result.status, "SETUP_REQUIRED");
  }
});

test("missing configuration returns names only and blocks live publishing", () => {
  const result = facebookReadiness({ ...ready(), env: readPublishingEnv({ MARKETING_PUBLISH_MODE: "live" }) });
  assert.equal(result.canPublish, false);
  assert.deepEqual(result.missingConfiguration, ["META_APP_ID", "META_APP_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"]);
});

test("unselected, stale, and unavailable approval cannot report readiness", () => {
  for (const state of ["NOT_SELECTED", "REVIEW_REQUIRED", "UNAVAILABLE"] as const) {
    const result = facebookReadiness({ ...ready(), approval: { state, draftId: null } });
    assert.equal(result.canPublish, false); assert.equal(result.canSimulate, false); assert.equal(result.status, "APPROVAL_REQUIRED");
  }
});

test("a missing account or Page, missing scopes, expiry and connection errors block live readiness", () => {
  for (const patch of [{ accessToken: null }, { externalAccountId: null }, { scopes: ["pages_show_list"] }, { tokenExpiresAt: now.toISOString() }, { tokenExpiresAt: "invalid" }, { tokenExpiresAt: new Date(now.getTime() + 60_000).toISOString() }, { status: "ERROR" as const }, { status: "EXPIRED" as const }]) {
    const result = facebookReadiness({ ...ready(), connection: { ...connection, ...patch } });
    assert.equal(result.canPublish, false); assert.equal(result.status, "ACCOUNT_REQUIRED");
  }
});
