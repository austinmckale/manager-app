import { approvalBlocker, missingCredentialNames, PROVIDER_CATALOG, type PublishingEnv } from "@/lib/publishing/config";
import type { ConnectionStatus, MarketingProviderName, SecretConnection } from "@/lib/publishing/types";

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  CONNECTED: "Connected",
  MISSING_CONFIGURATION: "Missing configuration",
  PENDING_PLATFORM_APPROVAL: "Pending platform approval",
  EXPIRED: "Expired authorization",
  ERROR: "Error",
};

export type PresentedConnection = {
  provider: MarketingProviderName;
  label: string;
  status: ConnectionStatus;
  statusLabel: string;
  externalAccountId: string | null;
  externalAccountName: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  note: string;
  candidates: { id: string; name: string }[];
};

export function presentConnection(
  provider: MarketingProviderName,
  record: SecretConnection | null,
  env: PublishingEnv,
  now: Date,
): PresentedConnection {
  const spec = PROVIDER_CATALOG[provider];
  const base = {
    provider,
    label: spec.label,
    externalAccountId: record?.externalAccountId ?? null,
    externalAccountName: record?.externalAccountName ?? null,
    scopes: record?.scopes ?? [],
    tokenExpiresAt: record?.tokenExpiresAt ?? null,
    candidates: record?.candidates ?? [],
  };
  const finish = (status: ConnectionStatus, note: string): PresentedConnection => ({
    ...base,
    status,
    statusLabel: CONNECTION_STATUS_LABEL[status],
    note,
  });

  const missing = missingCredentialNames(provider, env);
  if (missing.length > 0) {
    return finish("MISSING_CONFIGURATION", `Missing configuration: ${missing.join(", ")}.`);
  }

  if (!record?.accessToken) {
    const approval = approvalBlocker(provider, env);
    if (approval) return finish("PENDING_PLATFORM_APPROVAL", approval);
    return finish("MISSING_CONFIGURATION", `Connect the ${spec.label} account to continue.`);
  }

  if (record.tokenExpiresAt && Date.parse(record.tokenExpiresAt) <= now.getTime()) {
    return finish("EXPIRED", "Expired authorization. Reconnect this account.");
  }

  const missingScopes = spec.scopes.filter((scope) => !record.scopes.includes(scope));
  if (missingScopes.length > 0) {
    return finish(
      "PENDING_PLATFORM_APPROVAL",
      `Pending platform approval. The authorization did not include: ${missingScopes.join(", ")}.`,
    );
  }

  const approval = approvalBlocker(provider, env);
  if (approval) return finish("PENDING_PLATFORM_APPROVAL", approval);

  if (!record.externalAccountId) {
    return finish("MISSING_CONFIGURATION", "Choose the Page, Instagram account, location, or ad account to use.");
  }

  if (record.status === "ERROR" && record.lastError) {
    return finish("ERROR", record.lastError);
  }

  return finish("CONNECTED", record.approvalNote || spec.connectedNote);
}

export function candidateList(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("candidates" in metadata)) return [];
  const candidates = (metadata as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const id = "id" in candidate && typeof candidate.id === "string" ? candidate.id : "";
    const name = "name" in candidate && typeof candidate.name === "string" ? candidate.name : "";
    if (!id || !name) return [];
    return [{ id, name }];
  });
}
