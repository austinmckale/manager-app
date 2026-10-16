import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OauthFlow } from "@/lib/publishing/types";

export const OAUTH_STATE_COOKIE = "rhi_mkt_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

type StatePayload = {
  v: 1;
  orgId: string;
  userId: string;
  flow: OauthFlow;
  nonce: string;
  exp: number;
};

export type OauthStateFailure = "mismatch" | "expired" | "tampered";

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createOauthNonce() {
  return randomBytes(24).toString("base64url");
}

export function createOauthState(
  input: { orgId: string; userId: string; flow: OauthFlow; nonce: string; now?: number },
  secret: string,
) {
  const payload: StatePayload = {
    v: 1,
    orgId: input.orgId,
    userId: input.userId,
    flow: input.flow,
    nonce: input.nonce,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyOauthState(
  state: string,
  secret: string,
  expected: { nonce: string; orgId: string; userId: string; now?: number },
): { ok: true; flow: OauthFlow } | { ok: false; reason: OauthStateFailure } {
  const [body, signature] = state.split(".");
  if (!body || !signature || !safeEqual(signature, sign(body, secret))) {
    return { ok: false, reason: "tampered" };
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return { ok: false, reason: "tampered" };
  }
  if (payload.v !== 1 || payload.exp <= (expected.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }
  if (payload.nonce !== expected.nonce || payload.orgId !== expected.orgId || payload.userId !== expected.userId) {
    return { ok: false, reason: "mismatch" };
  }
  if (
    payload.flow !== "meta_organic" &&
    payload.flow !== "meta_ads" &&
    payload.flow !== "google_business" &&
    payload.flow !== "google_ads"
  ) {
    return { ok: false, reason: "tampered" };
  }
  return { ok: true, flow: payload.flow };
}
