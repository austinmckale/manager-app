import { randomUUID } from "node:crypto";
import { presentConnection } from "@/lib/publishing/connections";
import { approvedText, assertAssetSubset, contentHash, idempotencyKey, mediaProblem, parseSavedDraft } from "@/lib/publishing/content";
import type { PublishingEnv } from "@/lib/publishing/config";
import {
  ORGANIC_DESTINATIONS,
  PublishRejection,
  type DeliveryRecord,
  type DeliveryStatus,
  type OrganicDestination,
  type OrganicPublisher,
  type OwnedAsset,
  type ProviderOutcome,
  type SecretConnection,
} from "@/lib/publishing/types";

const IN_FLIGHT_MS = 120_000;

export type DeliveryStore = {
  findByKey: (orgId: string, key: string) => Promise<DeliveryRecord | null>;
  insert: (record: DeliveryRecord) => Promise<DeliveryRecord | "conflict">;
  update: (id: string, patch: Partial<DeliveryRecord>) => Promise<DeliveryRecord>;
};

export type PreparedMedia = { id: string; url: string };

export type PublishCommand = {
  orgId: string;
  jobId: string;
  draftId: string;
  assetIds: string[];
  destinations: OrganicDestination[];
};

export type DestinationResult = {
  destination: OrganicDestination;
  status: DeliveryStatus;
  providerPostId: string | null;
  error: string | null;
  attemptCount: number;
  deduped: boolean;
  mock: boolean;
  deliveryId: string;
};

export type PublishDeps = {
  now: Date;
  env: PublishingEnv;
  loadDraft: (orgId: string, draftId: string) => Promise<{ orgId: string; jobId: string; metadata: unknown } | null>;
  loadAssets: (orgId: string, jobId: string, assetIds: string[]) => Promise<OwnedAsset[]>;
  loadConnection: (orgId: string, destination: OrganicDestination) => Promise<SecretConnection | null>;
  refresh: (connection: SecretConnection) => Promise<SecretConnection | null>;
  markStatus: (destination: OrganicDestination, status: SecretConnection["status"], note: string) => Promise<void>;
  publisherFor: (destination: OrganicDestination, connection: SecretConnection) => OrganicPublisher;
  prepareMedia: (assets: OwnedAsset[]) => Promise<{ ok: true; media: PreparedMedia[] } | { ok: false; message: string }>;
  releaseMedia: (media: PreparedMedia[]) => Promise<void>;
  store: DeliveryStore;
  createId?: () => string;
};

export function isMockPostId(id: string | null | undefined) {
  return typeof id === "string" && id.startsWith("mock:");
}

function resultOf(record: DeliveryRecord, deduped: boolean): DestinationResult {
  return {
    destination: record.destination,
    status: record.status,
    providerPostId: record.providerPostId,
    error: record.lastError,
    attemptCount: record.attemptCount,
    deduped,
    mock: isMockPostId(record.providerPostId),
    deliveryId: record.id,
  };
}

function inFlight(record: DeliveryRecord, now: Date) {
  if (record.providerPostId || record.containerId) return false;
  if (record.status !== "ACCEPTED" && record.status !== "PROCESSING") return false;
  if (!record.acceptedAt) return false;
  return now.getTime() - Date.parse(record.acceptedAt) < IN_FLIGHT_MS;
}

function patchFromOutcome(record: DeliveryRecord, outcome: ProviderOutcome, now: string): Partial<DeliveryRecord> {
  if (outcome.outcome === "published") {
    return {
      status: "PUBLISHED",
      providerPostId: outcome.providerPostId,
      containerId: outcome.containerId ?? record.containerId,
      lastError: null,
      publishedAt: now,
    };
  }
  if (outcome.outcome === "processing" || outcome.outcome === "accepted") {
    return {
      status: outcome.outcome === "processing" ? "PROCESSING" : "ACCEPTED",
      providerPostId: outcome.providerPostId ?? record.providerPostId,
      containerId: outcome.containerId ?? record.containerId,
      lastError: null,
    };
  }
  return {
    status: "FAILED",
    lastError: outcome.message,
    providerPostId: outcome.providerPostId ?? record.providerPostId,
    containerId: outcome.containerId ?? record.containerId,
  };
}

export async function publishOrganic(command: PublishCommand, deps: PublishDeps): Promise<DestinationResult[]> {
  if (
    command.destinations.length === 0 ||
    command.destinations.some((destination) => !ORGANIC_DESTINATIONS.includes(destination)) ||
    new Set(command.destinations).size !== command.destinations.length
  ) {
    throw new PublishRejection("Choose Facebook, Instagram, Google Business Profile, or a combination of them.", 400);
  }

  const draftRecord = await deps.loadDraft(command.orgId, command.draftId);
  if (!draftRecord || draftRecord.orgId !== command.orgId || draftRecord.jobId !== command.jobId) {
    throw new PublishRejection("That saved draft is not available for this job.", 404);
  }
  const draft = parseSavedDraft(draftRecord.metadata);
  if (!draft) {
    throw new PublishRejection("The saved draft could not be read. Save it again from the marketing page.", 400);
  }
  assertAssetSubset(draft, command.assetIds);

  const assets = await deps.loadAssets(command.orgId, command.jobId, command.assetIds);
  const uniqueCount = new Set(command.assetIds).size;
  if (assets.length !== uniqueCount || assets.some((asset) => asset.orgId !== command.orgId || asset.jobId !== command.jobId)) {
    throw new PublishRejection("Some photos are unavailable.", 404);
  }

  return Promise.all(
    command.destinations.map((destination) =>
      publishOne(destination, command, draft, assets, deps).catch(() =>
        failedShell(destination, command, "This destination could not be saved. Try again."),
      ),
    ),
  );
}

function failedShell(destination: OrganicDestination, command: PublishCommand, message: string): DestinationResult {
  return {
    destination,
    status: "FAILED",
    providerPostId: null,
    error: message,
    attemptCount: 0,
    deduped: false,
    mock: false,
    deliveryId: "",
  };
}

async function publishOne(
  destination: OrganicDestination,
  command: PublishCommand,
  draft: NonNullable<ReturnType<typeof parseSavedDraft>>,
  assets: OwnedAsset[],
  deps: PublishDeps,
): Promise<DestinationResult> {
  const text = approvedText(draft, destination);
  const hash = contentHash(destination, text, command.assetIds);
  const key = idempotencyKey({
    orgId: command.orgId,
    draftId: command.draftId,
    destination,
    assetIds: command.assetIds,
    contentHash: hash,
  });
  const existing = await deps.store.findByKey(command.orgId, key);
  if (existing?.status === "PUBLISHED") return resultOf(existing, true);
  if (existing && inFlight(existing, deps.now)) return resultOf({ ...existing, status: "PROCESSING" }, true);

  const problem = mediaProblem(destination, assets);
  if (problem) return resultOf(await writeFailure(deps, command, destination, key, hash, existing, problem), false);

  let connection = await deps.loadConnection(command.orgId, destination);
  if (connection?.accessToken && connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= deps.now.getTime() + 120_000) {
    const refreshed = await deps.refresh(connection);
    if (refreshed?.accessToken) {
      connection = refreshed;
    } else {
      await deps.markStatus(destination, "EXPIRED", "Expired authorization. Reconnect this account.");
      connection = { ...connection, status: "EXPIRED", tokenExpiresAt: new Date(deps.now.getTime() - 1000).toISOString() };
    }
  }

  const presented = presentConnection(destination, connection, deps.env, deps.now);
  if (presented.status !== "CONNECTED" || !connection?.accessToken || !connection.externalAccountId) {
    if (existing?.providerPostId || existing?.containerId) {
      return resultOf({ ...existing, lastError: presented.note }, false);
    }
    if (presented.status === "PENDING_PLATFORM_APPROVAL") await deps.markStatus(destination, "PENDING_PLATFORM_APPROVAL", presented.note);
    if (presented.status === "EXPIRED") await deps.markStatus(destination, "EXPIRED", presented.note);
    return resultOf(await writeFailure(deps, command, destination, key, hash, existing, presented.note), false);
  }

  const publisher = deps.publisherFor(destination, connection);
  if (existing?.providerPostId) {
    if (!publisher.poll) return resultOf(existing, false);
    return resultOf(await pollExisting(existing, publisher, deps), false);
  }
  if (existing?.containerId && publisher.poll && existing.status !== "FAILED") {
    return resultOf(await pollExisting(existing, publisher, deps), false);
  }

  const claimed = await claim(deps, command, destination, key, hash, existing);
  if (!claimed.owned) {
    if (claimed.record.status === "PUBLISHED") return resultOf(claimed.record, true);
    if (claimed.record.providerPostId || claimed.record.containerId) {
      return resultOf(await pollExisting(claimed.record, publisher, deps), true);
    }
    return resultOf({ ...claimed.record, status: "PROCESSING" }, true);
  }
  const owned = claimed.record;

  let media: PreparedMedia[] = [];
  try {
    if (destination !== "FACEBOOK_PAGE") {
      const prepared = await deps.prepareMedia(assets);
      if (!prepared.ok) {
        const failed = await deps.store.update(owned.id, { status: "FAILED", lastError: prepared.message });
        return resultOf(failed, false);
      }
      media = prepared.media;
    }
    const outcome = await publisher.publish({
      destination,
      text,
      assetIds: command.assetIds,
      mediaUrls: media.map((item) => item.url),
      idempotencyKey: key,
      containerId: owned.containerId,
      providerPostId: owned.providerPostId,
      accessToken: connection.accessToken,
      externalAccountId: connection.externalAccountId,
    });
    const saved = await applyOutcome(deps, owned, outcome);
    if (saved.status === "PUBLISHED" || saved.status === "FAILED") await deps.releaseMedia(media);
    return resultOf(saved, false);
  } catch {
    const saved = await deps.store.update(owned.id, {
      status: "FAILED",
      lastError: "The destination did not accept the post. Try again.",
    });
    await deps.releaseMedia(media);
    return resultOf(saved, false);
  }
}

async function pollExisting(record: DeliveryRecord, publisher: OrganicPublisher, deps: PublishDeps) {
  if (!publisher.poll || (!record.providerPostId && !record.containerId)) return record;
  const connection = await deps.loadConnection(record.orgId, record.destination);
  if (!connection?.accessToken || !connection.externalAccountId) return record;
  try {
    const outcome = await publisher.poll({
      destination: record.destination,
      text: "",
      assetIds: record.assetIds,
      mediaUrls: [],
      idempotencyKey: record.idempotencyKey,
      containerId: record.containerId,
      providerPostId: record.providerPostId,
      accessToken: connection.accessToken,
      externalAccountId: connection.externalAccountId,
    });
    return applyOutcome(deps, record, outcome);
  } catch {
    return deps.store.update(record.id, { status: "FAILED", lastError: "The destination could not be checked. Try again." });
  }
}

async function applyOutcome(deps: PublishDeps, record: DeliveryRecord, outcome: ProviderOutcome) {
  if (outcome.outcome === "failed" && outcome.expired) {
    await deps.markStatus(record.destination, "EXPIRED", outcome.message);
  }
  if (outcome.outcome === "failed" && outcome.approvalPending) {
    await deps.markStatus(record.destination, "PENDING_PLATFORM_APPROVAL", outcome.message);
  }
  return deps.store.update(record.id, patchFromOutcome(record, outcome, deps.now.toISOString()));
}

async function writeFailure(
  deps: PublishDeps,
  command: PublishCommand,
  destination: OrganicDestination,
  key: string,
  hash: string,
  existing: DeliveryRecord | null,
  message: string,
) {
  if (existing) {
    return deps.store.update(existing.id, {
      status: "FAILED",
      lastError: message,
      attemptCount: existing.attemptCount + 1,
    });
  }
  const inserted = await deps.store.insert(blank(deps, command, destination, key, hash, "FAILED", message));
  if (inserted !== "conflict") return inserted;
  const winner = await deps.store.findByKey(command.orgId, key);
  if (!winner) throw new PublishRejection("The delivery could not be saved.", 500);
  if (winner.status === "PUBLISHED") return winner;
  return deps.store.update(winner.id, { status: "FAILED", lastError: message });
}

async function claim(
  deps: PublishDeps,
  command: PublishCommand,
  destination: OrganicDestination,
  key: string,
  hash: string,
  existing: DeliveryRecord | null,
): Promise<{ record: DeliveryRecord; owned: boolean }> {
  const now = deps.now.toISOString();
  if (!existing) {
    const inserted = await deps.store.insert(blank(deps, command, destination, key, hash, "ACCEPTED", null));
    if (inserted !== "conflict") return { record: inserted, owned: true };
    const winner = await deps.store.findByKey(command.orgId, key);
    if (!winner) throw new PublishRejection("The delivery could not be saved.", 500);
    return { record: winner, owned: false };
  }
  return {
    record: await deps.store.update(existing.id, {
      status: "ACCEPTED",
      lastError: null,
      acceptedAt: now,
      attemptCount: existing.attemptCount + 1,
    }),
    owned: true,
  };
}

function blank(
  deps: PublishDeps,
  command: PublishCommand,
  destination: OrganicDestination,
  key: string,
  hash: string,
  status: DeliveryStatus,
  message: string | null,
): DeliveryRecord {
  const now = deps.now.toISOString();
  return {
    id: (deps.createId ?? randomUUID)(),
    orgId: command.orgId,
    jobId: command.jobId,
    draftId: command.draftId,
    destination,
    assetIds: [...command.assetIds],
    idempotencyKey: key,
    contentHash: hash,
    status,
    providerPostId: null,
    containerId: null,
    attemptCount: 1,
    lastError: message,
    acceptedAt: now,
    publishedAt: null,
  };
}
