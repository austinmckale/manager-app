import type { ProviderOutcome } from "@/lib/publishing/types";
import { redactSecrets } from "@/lib/publishing/redact";

const META_RATE_CODES = new Set([4, 17, 32, 613]);

function metaCode(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  return typeof error?.code === "number" ? error.code : null;
}

export function classifyMetaError(status: number, body: unknown): ProviderOutcome {
  const code = metaCode(body);
  if (status === 429 || (code !== null && META_RATE_CODES.has(code))) {
    return {
      outcome: "failed",
      message: "The platform rate limit was reached. Try again later.",
      retryable: true,
      rateLimited: true,
    };
  }
  if (code === 190) {
    return { outcome: "failed", message: "Expired authorization. Reconnect the account.", retryable: false, expired: true };
  }
  if (code === 10 || code === 200) {
    return {
      outcome: "failed",
      message: "Pending platform approval. Meta has not granted this permission for the connected account.",
      retryable: false,
      approvalPending: true,
    };
  }
  const raw = body && typeof body === "object" && "error" in body ? (body as { error?: { message?: unknown } }).error?.message : "";
  const safe = typeof raw === "string" ? redactSecrets(raw).slice(0, 180) : "";
  return {
    outcome: "failed",
    message: safe ? `The platform rejected the request (${code ?? status}). ${safe}` : `The platform rejected the request (${code ?? status}).`,
    retryable: status >= 500,
  };
}

export function classifyGoogleError(status: number, body: unknown): ProviderOutcome {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: { status?: unknown; message?: unknown } }).error : undefined;
  const googleStatus = typeof error?.status === "string" ? error.status : "";
  if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
    return {
      outcome: "failed",
      message: "The platform rate limit was reached. Try again later.",
      retryable: true,
      rateLimited: true,
    };
  }
  if (status === 401 || googleStatus === "UNAUTHENTICATED") {
    return { outcome: "failed", message: "Expired authorization. Reconnect the account.", retryable: false, expired: true };
  }
  if (status === 403 || googleStatus === "PERMISSION_DENIED") {
    return {
      outcome: "failed",
      message: "Pending platform approval. Google has not granted this API access for the project.",
      retryable: false,
      approvalPending: true,
    };
  }
  const raw = typeof error?.message === "string" ? redactSecrets(error.message).slice(0, 180) : "";
  return {
    outcome: "failed",
    message: raw ? `The platform rejected the request (${status}). ${raw}` : `The platform rejected the request (${status}).`,
    retryable: status >= 500,
  };
}
