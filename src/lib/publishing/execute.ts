import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readPublishingEnv } from "@/lib/publishing/config";
import { toSecret } from "@/lib/publishing/connection-store";
import { publishOrganic, type DeliveryStore, type PreparedMedia } from "@/lib/publishing/deliver";
import { ingestExpiresAt, ingestObjectPath, publicIngestUrl } from "@/lib/publishing/public-media";
import { createFacebookPublisher } from "@/lib/publishing/providers/facebook";
import { createGoogleBusinessPublisher } from "@/lib/publishing/providers/google-business";
import { createInstagramPublisher } from "@/lib/publishing/providers/instagram";
import { createMockPublisher } from "@/lib/publishing/providers/mock";
import { refreshGoogleAccessToken } from "@/lib/publishing/oauth";
import type { DeliveryRecord, OrganicDestination, OwnedAsset, SecretConnection } from "@/lib/publishing/types";
import { isMissingRelation } from "@/lib/publishing/http";
import { loadApprovedPublishingDraft } from "@/lib/publishing/approval";
import { approvedText, contentHash } from "@/lib/publishing/content";
import { isMockPostId } from "@/lib/publishing/deliver";
import { PublishRejection } from "@/lib/publishing/types";
import { facebookRetryBlocker } from "@/lib/publishing/providers/facebook-state";
import { publishingStatus } from "@/lib/publishing/status";

const PRIVATE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
const PUBLIC_BUCKET = "site-public";

function toRecord(row: {
  id: string;
  orgId: string;
  jobId: string;
  draftId: string;
  destination: string;
  assetIds: string[];
  idempotencyKey: string;
  contentHash: string;
  status: DeliveryRecord["status"];
  providerPostId: string | null;
  containerId: string | null;
  attemptCount: number;
  lastError: string | null;
  acceptedAt: Date | null;
  publishedAt: Date | null;
}): DeliveryRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    jobId: row.jobId,
    draftId: row.draftId,
    destination: row.destination as OrganicDestination,
    assetIds: row.assetIds,
    idempotencyKey: row.idempotencyKey,
    contentHash: row.contentHash,
    status: row.status,
    providerPostId: row.providerPostId,
    containerId: row.containerId,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function deliveryStore(): DeliveryStore {
  return {
    async findByKey(orgId, key) {
      const row = await prisma.marketingDelivery.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } } });
      return row ? toRecord(row) : null;
    },
    async insert(record) {
      try {
        const row = await prisma.marketingDelivery.create({
          data: {
            id: record.id,
            orgId: record.orgId,
            jobId: record.jobId,
            draftId: record.draftId,
            destination: record.destination,
            assetIds: record.assetIds,
            idempotencyKey: record.idempotencyKey,
            contentHash: record.contentHash,
            status: record.status,
            providerPostId: record.providerPostId,
            containerId: record.containerId,
            attemptCount: record.attemptCount,
            lastError: record.lastError,
            acceptedAt: record.acceptedAt ? new Date(record.acceptedAt) : null,
            publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
          },
        });
        return toRecord(row);
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") return "conflict";
        throw error;
      }
    },
    async update(id, patch, expectedAttemptCount) {
      const data = {
        status: patch.status,
        providerPostId: patch.providerPostId,
        containerId: patch.containerId,
        attemptCount: patch.attemptCount,
        lastError: patch.lastError,
        acceptedAt: patch.acceptedAt ? new Date(patch.acceptedAt) : undefined,
        publishedAt: patch.publishedAt ? new Date(patch.publishedAt) : undefined,
        assetIds: patch.assetIds,
      };
      if (expectedAttemptCount !== undefined) {
        const updated = await prisma.marketingDelivery.updateMany({ where: { id, attemptCount: expectedAttemptCount }, data });
        if (updated.count !== 1) throw new PublishRejection("Another request owns this delivery. Check its current status.", 409);
        const row = await prisma.marketingDelivery.findUnique({ where: { id } });
        if (!row) throw new PublishRejection("That delivery is no longer available.", 404);
        return toRecord(row);
      }
      const row = await prisma.marketingDelivery.update({ where: { id }, data });
      return toRecord(row);
    },
    async claimRetry(record, now) {
      const claimed = await prisma.marketingDelivery.updateMany({
        where: { id: record.id, orgId: record.orgId, status: record.status, attemptCount: record.attemptCount, acceptedAt: record.acceptedAt ? new Date(record.acceptedAt) : null, containerId: record.containerId, providerPostId: record.providerPostId },
        data: { status: "ACCEPTED", lastError: null, acceptedAt: new Date(now), attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      const row = await prisma.marketingDelivery.findUnique({ where: { id: record.id } });
      return row && row.attemptCount === record.attemptCount + 1 ? toRecord(row) : null;
    },
  };
}

async function connectionFor(orgId: string, provider: OrganicDestination) {
  const row = await prisma.marketingConnection.findUnique({ where: { orgId_provider: { orgId, provider } } });
  return row ? toSecret(row) : null;
}

export async function executePublish(input: {
  orgId: string;
  userId: string;
  jobId: string;
  draftId: string;
  assetIds: string[];
  destinations: OrganicDestination[];
  retry?: { deliveryId: string; contentHash: string; idempotencyKey: string };
}) {
  if (new Set(input.assetIds).size !== input.assetIds.length) {
    return { error: "Each photo can be selected once.", status: 400 as const };
  }
  const env = readPublishingEnv(process.env);
  const loadedAssets = new Map<string, OwnedAsset>();
  const results = await publishOrganic(
    { orgId: input.orgId, jobId: input.jobId, draftId: input.draftId, assetIds: input.assetIds, destinations: input.destinations, retry: input.retry },
    {
      now: new Date(),
      env,
      loadApprovedDraft: loadApprovedPublishingDraft,
      async loadAssets(orgId, jobId, assetIds) {
        const rows = await prisma.fileAsset.findMany({
          where: { id: { in: assetIds }, type: "PHOTO", job: { id: jobId, orgId } },
        });
        const assets = rows.map((row) => ({
          id: row.id,
          orgId,
          jobId: row.jobId,
          mimeType: row.mimeType,
          fileName: row.fileName,
          fileSize: row.fileSize,
          storageKey: row.storageKey,
        }));
        for (const asset of assets) loadedAssets.set(asset.id, asset);
        return assets;
      },
      loadConnection: connectionFor,
      async refresh(connection) {
        const row = await prisma.marketingConnection.findUnique({
          where: { orgId_provider: { orgId: input.orgId, provider: connection.provider } },
        });
        if (!row) return null;
        const refreshed = await refreshStoredGoogleToken(input.orgId, input.userId, toSecret(row));
        return refreshed;
      },
      async markStatus(destination, status, note) {
        await prisma.marketingConnection.updateMany({
          where: { orgId: input.orgId, provider: destination },
          data: status === "ERROR" ? { status, lastError: note } : { status, approvalNote: note, lastError: status === "EXPIRED" ? note : null },
        });
      },
      publisherFor(destination, connection) {
        if (!connection.accessToken) {
          return { async publish() { return { outcome: "failed" as const, message: "Reconnect this account.", retryable: false }; } };
        }
        if (env.publishMode !== "live") return createMockPublisher(destination);
        if (destination === "FACEBOOK_PAGE") {
          return createFacebookPublisher(fetch, env.graphVersion, async (assetId) => {
            const asset = loadedAssets.get(assetId);
            if (!asset) throw new Error("Photo unavailable.");
            const downloaded = await supabaseAdmin.storage.from(PRIVATE_BUCKET).download(asset.storageKey);
            if (downloaded.error || !downloaded.data) throw new Error("Photo unavailable.");
            return {
              bytes: new Uint8Array(await downloaded.data.arrayBuffer()),
              mimeType: asset.mimeType ?? "image/jpeg",
              fileName: asset.fileName,
            };
          });
        }
        if (destination === "INSTAGRAM") return createInstagramPublisher(fetch, env.graphVersion);
        return createGoogleBusinessPublisher(fetch);
      },
      prepareMedia: (assets) => prepareIngestMedia(input.orgId, assets, env.publishMode),
      releaseMedia,
      store: deliveryStore(),
    },
  );
  return { results, mode: env.publishMode };
}

async function refreshStoredGoogleToken(orgId: string, userId: string, connection: SecretConnection) {
  if (connection.provider !== "GOOGLE_BUSINESS" && connection.provider !== "GOOGLE_ADS") return null;
  if (!connection.refreshToken) return null;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const refreshed = await refreshGoogleAccessToken({ fetchImpl: fetch, clientId, clientSecret, refreshToken: connection.refreshToken }).catch(() => null);
  if (!refreshed) return null;
  const { seal } = await import("@/lib/publishing/connection-store");
  await prisma.marketingConnection.update({
    where: { orgId_provider: { orgId, provider: connection.provider } },
    data: {
      accessTokenCipher: seal(refreshed.accessToken),
      tokenExpiresAt: new Date(refreshed.expiresAt),
      status: "CONNECTED",
      connectedById: userId,
    },
  });
  return { ...connection, accessToken: refreshed.accessToken, tokenExpiresAt: refreshed.expiresAt, status: "CONNECTED" as const };
}

async function prepareIngestMedia(orgId: string, assets: OwnedAsset[], mode: "mock" | "live"): Promise<{ ok: true; media: PreparedMedia[] } | { ok: false; message: string }> {
  if (mode !== "live") {
    return { ok: true, media: assets.map((asset) => ({ id: asset.id, url: `https://example.test/mock/${asset.id}` })) };
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const media: PreparedMedia[] = [];
  try {
    for (const asset of assets) {
      const downloaded = await supabaseAdmin.storage.from(PRIVATE_BUCKET).download(asset.storageKey);
      if (downloaded.error || !downloaded.data) return { ok: false, message: "A selected photo could not be prepared for publishing." };
      const publicPath = ingestObjectPath(orgId, asset.id);
      const uploaded = await supabaseAdmin.storage.from(PUBLIC_BUCKET).upload(publicPath, await downloaded.data.arrayBuffer(), {
        contentType: asset.mimeType ?? "image/jpeg",
        upsert: false,
      });
      if (uploaded.error) return { ok: false, message: "A selected photo could not be prepared for publishing." };
      const url = publicIngestUrl(supabaseUrl, publicPath);
      const row = await prisma.marketingIngestMedia.create({
        data: { orgId, assetId: asset.id, publicPath, expiresAt: ingestExpiresAt(new Date()) },
      });
      media.push({ id: row.id, url });
    }
    return { ok: true, media };
  } catch (error) {
    await releaseMedia(media);
    if (isMissingRelation(error)) return { ok: false, message: "Apply the marketing publishing migration before posting to Instagram or Google." };
    return { ok: false, message: error instanceof Error ? "A selected photo could not be prepared for publishing." : "A selected photo could not be prepared for publishing." };
  }
}

async function releaseMedia(media: PreparedMedia[]) {
  if (!media.length) return;
  const ids = media.map((item) => item.id);
  const rows = await prisma.marketingIngestMedia.findMany({ where: { id: { in: ids }, removedAt: null } }).catch(() => []);
  if (!rows.length) return;
  await supabaseAdmin.storage.from(PUBLIC_BUCKET).remove(rows.map((row) => row.publicPath));
  await prisma.marketingIngestMedia.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { removedAt: new Date() } });
}

export async function presentedConnections(orgId: string) {
  return publishingStatus(orgId);
}

export async function pollDelivery(orgId: string, deliveryId: string) {
  const row = await prisma.marketingDelivery.findFirst({ where: { id: deliveryId, orgId } });
  if (!row) return null;
  if (row.status === "PUBLISHED" || row.status === "FAILED") return toRecord(row);
  if (row.destination === "FACEBOOK_PAGE" && facebookRetryBlocker(row.containerId)) return toRecord(row);
  const env = readPublishingEnv(process.env);
  // Status reads in mock mode must never refresh accounts or poll live APIs.
  if (env.publishMode !== "live" || isMockPostId(row.providerPostId)) return toRecord(row);
  const approved = await loadApprovedPublishingDraft(orgId, row.draftId);
  const hash = contentHash(row.destination as OrganicDestination, approvedText(approved.metadata, row.destination as OrganicDestination), row.assetIds, approved.approvalHash);
  if (approved.jobId !== row.jobId || hash !== row.contentHash) throw new PublishRejection("This delivery's approval or source evidence changed. Review the current version.", 409);
  const secret = await connectionFor(orgId, row.destination as OrganicDestination);
  if (!secret) return toRecord(row);
  const publisher =
    env.publishMode !== "live"
      ? createMockPublisher(row.destination as OrganicDestination)
      : row.destination === "INSTAGRAM"
        ? createInstagramPublisher(fetch, env.graphVersion)
        : row.destination === "GOOGLE_BUSINESS"
          ? createGoogleBusinessPublisher(fetch)
          : null;
  if (!publisher?.poll || !secret.accessToken || !secret.externalAccountId) return toRecord(row);
  const latest = await loadApprovedPublishingDraft(orgId, row.draftId);
  if (latest.approvalHash !== approved.approvalHash) throw new PublishRejection("Approval changed before checking the delivery.", 409);
  const outcome = await publisher.poll({
    destination: row.destination as OrganicDestination,
    text: "",
    assetIds: row.assetIds,
    mediaUrls: [],
    idempotencyKey: row.idempotencyKey,
    containerId: row.containerId,
    providerPostId: row.providerPostId,
    accessToken: secret.accessToken,
    externalAccountId: secret.externalAccountId,
  });
  const updated = await prisma.marketingDelivery.update({
    where: { id: row.id },
    data: {
      status: outcome.outcome === "published" ? "PUBLISHED" : outcome.outcome === "failed" ? "FAILED" : outcome.outcome === "processing" ? "PROCESSING" : "ACCEPTED",
      providerPostId: outcome.outcome === "failed" ? (outcome.providerPostId ?? row.providerPostId) : (outcome.providerPostId ?? row.providerPostId),
      containerId: outcome.containerId ?? row.containerId,
      lastError: outcome.outcome === "failed" ? outcome.message : null,
      publishedAt: outcome.outcome === "published" ? new Date() : row.publishedAt,
    },
  });
  return toRecord(updated);
}
