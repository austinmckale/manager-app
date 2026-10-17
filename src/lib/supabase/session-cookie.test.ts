import assert from "node:assert/strict";
import test from "node:test";
import { sessionNeedsRefresh } from "./session-cookie";

function token(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.sig`;
}

test("a current session does not need a refresh", () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(sessionNeedsRefresh([{ name: "sb-abc-auth-token", value: JSON.stringify({ expires_at: expiresAt }) }]), false);
});

test("an expired or unreadable session needs a refresh", () => {
  const expiresAt = Math.floor(Date.now() / 1000) - 10;
  assert.equal(sessionNeedsRefresh([{ name: "sb-abc-auth-token", value: JSON.stringify({ access_token: token(expiresAt) }) }]), true);
  assert.equal(sessionNeedsRefresh([{ name: "sb-abc-auth-token", value: "base64-" + Buffer.from("{").toString("base64url") }]), true);
});

test("chunked session cookies are read in order", () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const raw = JSON.stringify({ expires_at: expiresAt });
  assert.equal(
    sessionNeedsRefresh([
      { name: "sb-abc-auth-token.1", value: raw.slice(4) },
      { name: "sb-abc-auth-token.0", value: raw.slice(0, 4) },
      { name: "sb-abc-auth-token-code-verifier", value: "ignore" },
    ]),
    false,
  );
});

test("visitors without a session cookie are left alone", () => {
  assert.equal(sessionNeedsRefresh([]), false);
});
