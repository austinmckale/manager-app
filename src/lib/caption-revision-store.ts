import { Prisma, type PrismaClient } from "@prisma/client";
import { CAPTION_REVISION_ACTION, captionRevisionId, captionRevisionSchema, emptyRevision } from "./caption-revision";

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
): Promise<{ id: string; status: Revision["status"]; deduped: boolean; approved: false }> {
  const id = captionRevisionId(orgId, draftId, inputHash, instruction);
  const queued = (base: Revision): Revision => {
    const next = {
      ...base,
      draftId,
      inputHash,
      instruction,
      status: "queued",
      social,
      googleBusiness,
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
  const row = await store.activityLog.findFirst({
    where: {
      orgId,
      action: CAPTION_REVISION_ACTION,
      AND: [
        { metadata: { path: ["draftId"], equals: draftId } },
        { metadata: { path: ["inputHash"], equals: inputHash } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? parseRevision(row.metadata) : null;
}

export async function listQueuedCaptionRevisions(
  store: PrismaClient,
  orgId: string,
): Promise<Array<Revision & { id: string }>> {
  const rows = await store.activityLog.findMany({
    where: { orgId, action: CAPTION_REVISION_ACTION, metadata: { path: ["status"], equals: "queued" } },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  const revisions: Array<Revision & { id: string }> = [];
  for (const row of rows) {
    const parsed = parseRevision(row.metadata);
    if (parsed) revisions.push({ ...parsed, id: row.id });
  }
  return revisions;
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
