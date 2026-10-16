import { Prisma, type MarketingProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION } from "@/lib/marketing";
import { candidateList } from "@/lib/publishing/connections";
import { decryptSecret, encryptSecret } from "@/lib/publishing/crypto";
import type { ConnectionStatus, MarketingProviderName, SecretConnection } from "@/lib/publishing/types";
import { isMissingRelation } from "@/lib/publishing/http";

export function encryptionKey() {
  const key = process.env.MARKETING_TOKEN_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("Missing configuration: MARKETING_TOKEN_ENCRYPTION_KEY.");
  return key;
}

export function seal(value: string | null | undefined) {
  if (!value) return null;
  return encryptSecret(value, encryptionKey());
}

export function openSeal(value: string | null) {
  if (!value) return null;
  try {
    return decryptSecret(value, encryptionKey());
  } catch {
    return null;
  }
}

export async function readConnections(orgId: string) {
  try {
    return await prisma.marketingConnection.findMany({ where: { orgId } });
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

export function toSecret(row: {
  provider: MarketingProvider;
  status: ConnectionStatus;
  externalAccountId: string | null;
  externalAccountName: string | null;
  scopes: string[];
  accessTokenCipher: string | null;
  refreshTokenCipher: string | null;
  tokenExpiresAt: Date | null;
  lastError: string | null;
  approvalNote: string | null;
  metadata: Prisma.JsonValue;
}): SecretConnection {
  return {
    provider: row.provider,
    status: row.status,
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName,
    scopes: row.scopes,
    accessToken: openSeal(row.accessTokenCipher),
    refreshToken: openSeal(row.refreshTokenCipher),
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    lastError: row.lastError,
    approvalNote: row.approvalNote,
    candidates: candidateList(row.metadata),
  };
}

export async function upsertConnection(input: {
  orgId: string;
  userId: string;
  provider: MarketingProviderName;
  status: ConnectionStatus;
  externalAccountId?: string | null;
  externalAccountName?: string | null;
  scopes: string[];
  accessToken?: string | null;
  refreshToken?: string | null;
  catalog?: string | null;
  tokenExpiresAt?: string | null;
  lastError?: string | null;
  approvalNote?: string | null;
  candidates: { id: string; name: string }[];
}) {
  const data = {
    status: input.status,
    externalAccountId: input.externalAccountId ?? null,
    externalAccountName: input.externalAccountName ?? null,
    scopes: input.scopes,
    accessTokenCipher: seal(input.accessToken),
    refreshTokenCipher: seal(input.refreshToken),
    accountCatalogCipher: seal(input.catalog),
    tokenExpiresAt: input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : null,
    lastError: input.lastError ?? null,
    approvalNote: input.approvalNote ?? null,
    metadata: { candidates: input.candidates } satisfies Prisma.InputJsonObject,
    connectedById: input.userId,
  };
  await prisma.marketingConnection.upsert({
    where: { orgId_provider: { orgId: input.orgId, provider: input.provider } },
    create: { orgId: input.orgId, provider: input.provider, ...data },
    update: data,
  });
}

export async function clearConnection(orgId: string, provider: MarketingProviderName, note: string) {
  await prisma.marketingConnection.updateMany({
    where: { orgId, provider },
    data: {
      status: "MISSING_CONFIGURATION",
      externalAccountId: null,
      externalAccountName: null,
      scopes: [],
      accessTokenCipher: null,
      refreshTokenCipher: null,
      accountCatalogCipher: null,
      tokenExpiresAt: null,
      lastError: null,
      approvalNote: note,
      metadata: { candidates: [] },
    },
  });
}

export async function loadSavedDraft(orgId: string, draftId: string) {
  const log = await prisma.activityLog.findFirst({
    where: { id: draftId, orgId, action: DRAFT_SAVED_ACTION },
    select: { id: true, orgId: true, jobId: true, metadata: true, createdAt: true },
  });
  if (!log?.jobId) return null;
  return { id: log.id, orgId: log.orgId, jobId: log.jobId, metadata: log.metadata, createdAt: log.createdAt };
}

export async function draftChoice(orgId: string, draftId: string) {
  const log = await loadSavedDraft(orgId, draftId);
  if (!log) return null;
  const job = await prisma.job.findFirst({ where: { id: log.jobId, orgId }, select: { jobName: true } });
  return { ...draftFields(log), jobName: job?.jobName ?? "Job" };
}

function draftFields(log: { id: string; jobId: string; createdAt: Date; metadata: Prisma.JsonValue }) {
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata) ? log.metadata : null;
  const assetIds = metadata && Array.isArray((metadata as { assetIds?: unknown }).assetIds)
    ? (metadata as { assetIds: unknown[] }).assetIds.filter((id): id is string => typeof id === "string")
    : [];
  return { id: log.id, jobId: log.jobId, createdAt: log.createdAt.toISOString(), assetIds };
}

export async function recentDrafts(orgId: string) {
  const logs = await prisma.activityLog.findMany({
    where: { orgId, action: DRAFT_SAVED_ACTION, jobId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, jobId: true, createdAt: true, metadata: true },
  });
  const jobIds = [...new Set(logs.flatMap((log) => (log.jobId ? [log.jobId] : [])))];
  const jobs = jobIds.length
    ? await prisma.job.findMany({ where: { orgId, id: { in: jobIds } }, select: { id: true, jobName: true } })
    : [];
  const names = new Map(jobs.map((job) => [job.id, job.jobName]));
  return logs.flatMap((log) => {
    if (!log.jobId) return [];
    const jobId = log.jobId;
    return [{ ...draftFields({ id: log.id, jobId, createdAt: log.createdAt, metadata: log.metadata }), jobName: names.get(jobId) ?? "Job" }];
  });
}
