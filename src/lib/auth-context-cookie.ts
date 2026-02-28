import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "@/lib/auth";

export const AUTH_CONTEXT_COOKIE_NAME = "ff_auth_ctx";
export const AUTH_CONTEXT_TTL_SECONDS = Number(process.env.AUTH_CONTEXT_TTL_SECONDS ?? 600);

type StoredAuthContext = AuthContext & {
  exp: number;
  v: 1;
};

function getSigningSecret() {
  return (
    process.env.AUTH_CONTEXT_SIGNING_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function signPayload(payloadBase64: string) {
  const secret = getSigningSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isRole(value: unknown): value is AuthContext["role"] {
  return value === "OWNER" || value === "ADMIN" || value === "WORKER";
}

export function createAuthContextCookieValue(context: AuthContext) {
  if (!getSigningSecret()) return null;

  const payload: StoredAuthContext = {
    ...context,
    exp: Date.now() + AUTH_CONTEXT_TTL_SECONDS * 1000,
    v: 1,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(payloadBase64);
  if (!signature) return null;
  return `${payloadBase64}.${signature}`;
}

export function parseAuthContextCookieValue(value: string | undefined | null): AuthContext | null {
  if (!value || !getSigningSecret()) return null;

  const [payloadBase64, signature] = value.split(".");
  if (!payloadBase64 || !signature) return null;

  const expected = signPayload(payloadBase64);
  if (!expected || !safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as Partial<StoredAuthContext>;
    if (
      typeof parsed?.userId !== "string" ||
      typeof parsed?.orgId !== "string" ||
      !isRole(parsed?.role) ||
      typeof parsed?.fullName !== "string" ||
      typeof parsed?.email !== "string" ||
      typeof parsed?.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;

    return {
      userId: parsed.userId,
      orgId: parsed.orgId,
      role: parsed.role,
      fullName: parsed.fullName,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

export function getAuthContextCookieOptions(maxAge: number = AUTH_CONTEXT_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

