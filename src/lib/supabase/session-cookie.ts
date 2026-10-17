const AUTH_TOKEN = /^sb-[^-]+-auth-token(?:\.(\d+))?$/;

type SessionCookie = { name: string; value: string };

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

function sessionPayload(raw: string) {
  const json = raw.startsWith("base64-") ? decodeBase64Url(raw.slice("base64-".length)) : raw;
  const parsed = JSON.parse(json) as { expires_at?: number; access_token?: string };
  if (typeof parsed.expires_at === "number") return parsed.expires_at;
  if (!parsed.access_token) return null;
  const payload = parsed.access_token.split(".")[1];
  if (!payload) return null;
  const claims = JSON.parse(decodeBase64Url(payload)) as { exp?: number };
  return typeof claims.exp === "number" ? claims.exp : null;
}

export function sessionNeedsRefresh(cookies: SessionCookie[], now = Date.now()) {
  const tokens = cookies.filter((cookie) => AUTH_TOKEN.test(cookie.name));
  if (!tokens.length) return false;
  const whole = tokens.find((cookie) => !AUTH_TOKEN.exec(cookie.name)?.[1]);
  const raw = whole
    ? whole.value
    : tokens
        .slice()
        .sort((a, b) => Number(AUTH_TOKEN.exec(a.name)?.[1] ?? 0) - Number(AUTH_TOKEN.exec(b.name)?.[1] ?? 0))
        .map((cookie) => cookie.value)
        .join("");
  try {
    const expiresAt = sessionPayload(raw);
    if (!expiresAt) return true;
    return expiresAt * 1000 <= now + 60_000;
  } catch {
    return true;
  }
}
