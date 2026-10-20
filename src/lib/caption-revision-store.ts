import { Prisma, type PrismaClient } from "@prisma/client";
import { CAPTION_REVISION_ACTION, captionRevisionId, captionRevisionSchema, emptyRevision, type CaptionValues } from "./caption-revision";

type Revision = ReturnType<typeof captionRevisionSchema.parse>;
type Social = Revision["social"];
type GoogleBusiness = Revision["googleBusiness"];
type Row = { id: string; metadata: Prisma.JsonValue | null };

const MAX_ATTEMPTS = 5;

function toJson(revision: Revision): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(revision));
}

function parseRevision(metadata: Prisma.JsonValue | null): Revision | null {
  const parsed = captionRevisionSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

// Compare-and-set guard: the write only lands if the stored metadata is still exactly what we read.
function metadataIs(metadata: Prisma.JsonValue | null): Prisma.JsonNullableFilter {
  return { equals: metadata === null ? Prisma.DbNull : (metadata as Prisma.InputJsonValue) };
}

// Approval and publishing are never granted by this store.
function assertNotApproving(patch: { approved?: boolean; published?: boolean }) {
  if (patch.approved === true || patch.published === true) {
    throw new Error("Caption revisions cannot be approved or published by the revision store.");
  }
}

async function readRow(store: PrismaClient, id: string): Promise<Row | null> {
  const row = await store.activityLog.findFirst({ where: { id, action: CAPTION_REVISION_ACTION } });
  return row ? { id: row.id, metadata: row.metadata } : null;
}

async function casUpdate(store: PrismaClient, row: Row, next: Revision): Promise<boolean> {
  assertNotApproving(next);
  const result = await store.activityLog.updateMany({
    where: { id: row.id, action: CAPTION_REVISION_ACTION, metadata: metadataIs(row.metadata) },
    data: { metadata: toJson(next) },
  });
  return result.count === 1;
}

/** Read the row, let `change` produce the next revision (or null to refuse), and CAS it. Retries on races. */
async function transition(
  store: PrismaClient,
  id: string,
  change: (current: Revision) => Revision | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const row = await readRow(store, id);
    if (!row) return false;
    const current = parseRevision(row.metadata);
    if (!current) return false;
    const next = change(current);
    if (!next) return false;
    if (await casUpdate(store, row, next)) return true;
  }
  return false;
}

export async function queueCaptionRevision(
  store: PrismaClient,
  orgId: string,
  actorId: string | null,
  jobId: string | null,
  draftId: string,
  inputHash: string,
  instruction: string,
  social: Social,
  googleBusiness: GoogleBusiness,
  regenerate?: { locked: CaptionValues; apply?: boolean },
): Promise<{ id: string; status: Revision["status"]; deduped: boolean; approved: false }> {
  // A different set of kept captions is a different request.
  const id = captionRevisionId(orgId, draftId, inputHash, instruction, regenerate ? JSON.stringify(regenerate.locked) : "");
  const queued = (base: Revision): Revision => {
    const next = {
      ...base,
      draftId,
      inputHash,
      instruction,
      status: "queued",
      social,
      googleBusiness,
      ...(regenerate ? { mode: "regenerate", locked: regenerate.locked, proposal: {}, remaining: null, apply: regenerate.apply ?? false } : {}),
      requestedAt: new Date().toISOString(),
      approved: false,
      published: false,
      error: null,
    };
    return captionRevisionSchema.parse(next);
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const row = await readRow(store, id);

    if (!row) {
      const created = queued(emptyRevision(draftId, inputHash, instruction));
      try {
        await store.activityLog.create({
          data: { id, orgId, actorId, jobId, action: CAPTION_REVISION_ACTION, metadata: toJson(created) },
        });
        return { id, status: created.status, deduped: false, approved: false };
      } catch (error) {
        // Another worker created it first: loop and treat it as an existing row.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }

    const current = parseRevision(row.metadata);
    if (current?.status === "running") {
      return { id, status: current.status, deduped: true, approved: false };
    }

    const next = queued(current ?? emptyRevision(draftId, inputHash, instruction));
    if (await casUpdate(store, row, next)) {
      return { id, status: next.status, deduped: false, approved: false };
    }
  }

  throw new Error("Could not queue the caption revision because it kept changing. Try again.");
}

export async function readCaptionRevision(
  store: PrismaClient,
  orgId: string,
  draftId: string,
  inputHash: string,
): Promise<Revision | null> {
  // Regenerate requests have their own reader; this one serves the Facebook/Google rewrite panel.
  const rows = await store.activityLog.findMany({
    where: {
      orgId,
      action: CAPTION_REVISION_ACTION,
      AND: [
        { metadata: { path: ["draftId"], equals: draftId } },
        { metadata: { path: ["inputHash"], equals: inputHash } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  for (const row of rows) {
    const parsed = parseRevision(row.metadata);
    if (parsed && parsed.mode !== "regenerate") return parsed;
  }
  return null;
}

/** Newest finished suggestion for this saved version, even when a later ask is still waiting. */
export async function readLatestReadyCaptionRevision(
  store: PrismaClient,
  orgId: string,
  draftId: string,
  inputHash: string,
): Promise<Revision | null> {
  const rows = await store.activityLog.findMany({
    where: {
      orgId,
      action: CAPTION_REVISION_ACTION,
      AND: [
        { metadata: { path: ["draftId"], equals: draftId } },
        { metadata: { path: ["inputHash"], equals: inputHash } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  for (const row of rows) {
    const parsed = parseRevision(row.metadata);
    if (parsed?.status === "ready" && parsed.mode !== "regenerate" && (parsed.social.trim() || parsed.googleBusiness.trim())) return parsed;
  }
  return null;
}

export async function listQueuedCaptionRevisions(
  store: PrismaClient,
  orgId: string,
): Promise<Array<Revision & { id: string }>> {
  const rows = await store.activityLog.findMany({
    where: { orgId, action: CAPTION_REVISION_ACTION, metadata: { path: ["status"], equals: "queued" } },
    orderBy: { createdAt: "asc" },
    // Enough to find the owner's own request behind a Pick posts backlog.
    take: 50,
  });
  const revisions: Array<Revision & { id: string }> = [];
  for (const row of rows) {
    const parsed = parseRevision(row.metadata);
    if (parsed) revisions.push({ ...parsed, id: row.id });
  }
  return revisions;
}

/** The request to run next: the owner's own asks before Pick posts' background rewrites, oldest first. */
export function nextCaptionRevision<T extends { apply: boolean }>(waiting: readonly T[]): T | undefined {
  return waiting.find((item) => !item.apply) ?? waiting[0];
}

/** Compare-and-set queued -> running. True only for the single worker that wins the claim. */
export async function claimCaptionRevision(store: PrismaClient, id: string): Promise<boolean> {
  const row = await readRow(store, id);
  if (!row) return false;
  const current = parseRevision(row.metadata);
  if (!current || current.status !== "queued") return false;
  const next = captionRevisionSchema.parse({ ...current, status: "running", approved: false, published: false });
  // No retry: if the metadata changed under us, another worker (or a requeue) got there first.
  return casUpdate(store, row, next);
}

export async function saveCaptionProposal(
  store: PrismaClient,
  id: string,
  social: Social,
  googleBusiness: GoogleBusiness,
): Promise<boolean> {
  const patch = { status: "ready", social, googleBusiness, approved: false, published: false, error: null };
  assertNotApproving(patch);
  return transition(store, id, (current) =>
    current.status === "running" ? captionRevisionSchema.parse({ ...current, ...patch }) : null,
  );
}

export async function failCaptionRevision(store: PrismaClient, id: string, error: string): Promise<boolean> {
  return transition(store, id, (current) =>
    captionRevisionSchema.parse({ ...current, status: "failed", error: error.slice(0, 200), approved: false }),
  );
}

export async function markCaptionRevisionStale(store: PrismaClient, id: string): Promise<boolean> {
  return transition(store, id, (current) =>
    captionRevisionSchema.parse({ ...current, status: "stale", approved: false }),
  );
}

/** Newest "regenerate unlocked captions" request for this saved version, by when it was last asked. */
export async function readLatestRegenerate(store: PrismaClient, orgId: string, draftId: string, inputHash: string): Promise<(Revision & { id: string }) | null> {
  const rows = await store.activityLog.findMany({
    where: {
      orgId,
      action: CAPTION_REVISION_ACTION,
      AND: [
        { metadata: { path: ["draftId"], equals: draftId } },
        { metadata: { path: ["inputHash"], equals: inputHash } },
        { metadata: { path: ["mode"], equals: "regenerate" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const parsed = rows.flatMap((row) => { const revision = parseRevision(row.metadata); return revision ? [{ ...revision, id: row.id }] : []; });
  return parsed.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
}

export async function saveRegenerateProposal(store: PrismaClient, id: string, proposal: CaptionValues, remaining: number): Promise<boolean> {
  return transition(store, id, (current) =>
    current.status === "running" && current.mode === "regenerate"
      ? captionRevisionSchema.parse({ ...current, status: "ready", proposal, remaining, social: proposal.social ?? current.social, googleBusiness: proposal.googleBusiness ?? current.googleBusiness, error: null, approved: false, published: false })
      : null,
  );
}
