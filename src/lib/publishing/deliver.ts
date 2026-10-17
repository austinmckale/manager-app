import { randomUUID } from "node:crypto";
import { presentConnection } from "@/lib/publishing/connections";
import { approvedText, assertAssetSubset, contentHash, idempotencyKey, mediaProblem, parseSavedDraft } from "@/lib/publishing/content";
import type { PublishingEnv } from "@/lib/publishing/config";
import type { ApprovedPublishingDraft } from "@/lib/publishing/approval";
import { createMockPublisher } from "@/lib/publishing/providers/mock";
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
  retry?: { deliveryId: string; contentHash: string; idempotencyKey: string };
};

export type DestinationResult = {
  destination: OrganicDestination;
  status: DeliveryStatus | "SIMULATED";
  providerPostId: string | null;
  error: string | null;
  attemptCount: number;
  deduped: boolean;
  mock: boolean;
  deliveryId: string;
  simulation?: { draftId: string; approvalHash: string; text: string; photos: { id: string; fileName: string; mimeType: string | null }[] };
};

export type PublishDeps = {
  now: Date;
  env: PublishingEnv;
  loadApprovedDraft: (orgId: string, draftId: string) => Promise<ApprovedPublishingDraft | null>;
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

function resultOf(record: DeliveryRecord, deduped: boolean, simulation?: DestinationResult["simulation"]): DestinationResult {
  const mock = isMockPostId(record.providerPostId);
  return {
    destination: record.destination,
    status: mock && record.status !== "FAILED" ? "SIMULATED" : record.status,
    providerPostId: mock ? null : record.providerPostId,
    error: record.lastError,
    attemptCount: record.attemptCount,
    deduped,
    mock,
    deliveryId: record.id,
    ...(simulation ? { simulation } : {}),
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
      publishedAt: isMockPostId(outcome.providerPostId) ? null : record.publishedAt,
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

  const draftRecord = await deps.loadApprovedDraft(command.orgId, command.draftId);
  if (!draftRecord || draftRecord.draftId !== command.draftId || draftRecord.orgId !== command.orgId || draftRecord.jobId !== command.jobId) {
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
      publishOne(destination, command, draftRecord, draft, assets, deps).catch((error) => {
        if (error instanceof PublishRejection) throw error;
        return failedShell(destination, command, "This destination could not be saved. Try again.");
      }),
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
  approved: ApprovedPublishingDraft,
  draft: NonNullable<ReturnType<typeof parseSavedDraft>>,
  assets: OwnedAsset[],
  deps: PublishDeps,
): Promise<DestinationResult> {
  const text = approvedText(draft, destination);
  const hash = contentHash(destination, text, command.assetIds, approved.approvalHash);
  const key = idempotencyKey({
    orgId: command.orgId,
    draftId: command.draftId,
    destination,
    assetIds: command.assetIds,
    contentHash: hash,
    mode: deps.env.publishMode,
  });
  if (command.retry && (command.destinations.length !== 1 || command.retry.contentHash !== hash || command.retry.idempotencyKey !== key)) {
    throw new PublishRejection("This delivery belongs to a different approved version or publishing mode. Review the current version and start a new delivery.", 409);
  }
  const simulation = deps.env.publishMode === "mock" ? { draftId: command.draftId, approvalHash: approved.approvalHash, text, photos: command.assetIds.map((id) => { const asset = assets.find((item) => item.id === id)!; return { id, fileName: asset.fileName, mimeType: asset.mimeType }; }) } : undefined;
  const result = (record: DeliveryRecord, deduped: boolean) => resultOf(record, deduped, simulation);
  const existing = await deps.store.findByKey(command.orgId, key);
  if (command.retry && existing?.id !== command.retry.deliveryId) throw new PublishRejection("That delivery is no longer available for retry.", 409);
  if (existing?.status === "PUBLISHED" || (existing && isMockPostId(existing.providerPostId) && existing.status !== "FAILED")) return result(existing, true);
  if (existing && inFlight(existing, deps.now)) return result({ ...existing, status: "PROCESSING" }, true);

  const problem = mediaProblem(destination, assets);
  if (problem) return result(await writeFailure(deps, command, destination, key, hash, existing, problem), false);

  if (simulation) {
    const claimed = await claim(deps, command, destination, key, hash, existing);
    if (!claimed.owned) return result(claimed.record, true);
    try {
      await assertStillApproved(command, approved, deps);
      const outcome = await createMockPublisher(destination).publish({ destination, text, assetIds: command.assetIds, mediaUrls: [], idempotencyKey: key, containerId: null, providerPostId: null, accessToken: "", externalAccountId: "" });
      return result(await applyOutcome(deps, claimed.record, outcome), false);
    } catch (error) {
      await deps.store.update(claimed.record.id, { status: "FAILED", lastError: "The approved simulation could not complete. Check approval and try again." });
      throw error;
    }
  }

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
      return result({ ...existing, lastError: presented.note }, false);
    }
    if (presented.status === "PENDING_PLATFORM_APPROVAL") await deps.markStatus(destination, "PENDING_PLATFORM_APPROVAL", presented.note);
    if (presented.status === "EXPIRED") await deps.markStatus(destination, "EXPIRED", presented.note);
    return result(await writeFailure(deps, command, destination, key, hash, existing, presented.note), false);
  }

  const publisher = deps.publisherFor(destination, connection);
  if (existing?.providerPostId) {
    if (!publisher.poll) return result(existing, false);
    return result(await pollExisting(existing, publisher, deps, command, approved), false);
  }
  if (existing?.containerId && publisher.poll && existing.status !== "FAILED") {
    return result(await pollExisting(existing, publisher, deps, command, approved), false);
  }

  const claimed = await claim(deps, command, destination, key, hash, existing);
  if (!claimed.owned) {
    if (claimed.record.status === "PUBLISHED") return result(claimed.record, true);
    if (claimed.record.providerPostId || claimed.record.containerId) {
      return result(await pollExisting(claimed.record, publisher, deps, command, approved), true);
    }
    return result({ ...claimed.record, status: "PROCESSING" }, true);
  }
  const owned = claimed.record;

  let media: PreparedMedia[] = [];
  try {
    await assertStillApproved(command, approved, deps);
    if (destination !== "FACEBOOK_PAGE") {
      const prepared = await deps.prepareMedia(assets);
      if (!prepared.ok) {
        const failed = await deps.store.update(owned.id, { status: "FAILED", lastError: prepared.message });
        return result(failed, false);
      }
      media = prepared.media;
    }
    await assertStillApproved(command, approved, deps);
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
    return result(saved, false);
  } catch (error) {
    const saved = await deps.store.update(owned.id, {
      status: "FAILED",
      lastError: "The destination did not accept the post. Try again.",
    });
    await deps.releaseMedia(media);
    if (error instanceof PublishRejection) throw error;
    return result(saved, false);
  }
}

async function assertStillApproved(command: PublishCommand, expected: ApprovedPublishingDraft, deps: PublishDeps) {
  const current = await deps.loadApprovedDraft(command.orgId, command.draftId);
  if (!current || current.orgId !== command.orgId || current.jobId !== command.jobId || current.approvalHash !== expected.approvalHash) throw new PublishRejection("Approval or source evidence changed. Review the current version before publishing.", 409);
}

async function pollExisting(record: DeliveryRecord, publisher: OrganicPublisher, deps: PublishDeps, command: PublishCommand, approved: ApprovedPublishingDraft) {
  if (!publisher.poll || (!record.providerPostId && !record.containerId)) return record;
  const connection = await deps.loadConnection(record.orgId, record.destination);
  if (!connection?.accessToken || !connection.externalAccountId) return record;
  try {
    await assertStillApproved(command, approved, deps);
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
  } catch (error) {
    if (error instanceof PublishRejection) throw error;
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
