import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { POSTED_CAPTION_FIELDS, captionRegenerateBodySchema, captionRevisionBodySchema, regenerateInstruction } from "@/lib/caption-revision";
import { queueCaptionRevision, readCaptionRevision, readLatestReadyCaptionRevision, readLatestRegenerate } from "@/lib/caption-revision-store";
import { appendCaptionTurn, readCaptionThread } from "@/lib/caption-thread";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { loadContentReview } from "@/lib/content-review-store";
import { isDemoMode } from "@/lib/demo";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const captionRevisionQuerySchema = captionRevisionBodySchema.pick({
  draftId: true,
  inputHash: true,
});

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let auth;
  try {
    auth = await requireAuth({ allowFallback: false });
  } catch {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ error: "Preview only. Nothing was queued." }, { status: 409 });
  }

  const raw = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && (raw as { mode?: unknown }).mode === "regenerate") return regenerate(raw, auth);
  const parsed = captionRevisionBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a short change, up to 400 characters." }, { status: 400 });
  }

  const body = parsed.data;
  const context = await loadContentReview(auth.orgId, body.draftId);
  if (!context) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }
  if (context.inputHash !== body.inputHash || context.superseded) {
    return NextResponse.json({ error: "This version changed. Reload before asking again." }, { status: 409 });
  }

  try {
    const queued = await queueCaptionRevision(
      prisma,
      auth.orgId,
      auth.userId,
      context.jobId,
      context.draftId,
      context.inputHash,
      body.instruction,
      context.draft.social,
      context.draft.googleBusiness,
    );
    await appendCaptionTurn(prisma, auth.orgId, auth.userId, context.draftId, {
      at: new Date().toISOString(),
      instruction: body.instruction,
      status: "queued",
    });
    return NextResponse.json({
      ok: true,
      id: queued.id,
      status: queued.status,
      approved: false,
      published: false,
    });
  } catch {
    return NextResponse.json({ error: "Could not queue the revision. The draft is still saved." }, { status: 503 });
  }
}

async function regenerate(raw: unknown, auth: { orgId: string; userId: string }) {
  const parsed = captionRegenerateBodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Check the kept captions and keep the note under 300 characters." }, { status: 400 });
  const body = parsed.data;
  if (POSTED_CAPTION_FIELDS.every((field) => body.locked[field] !== undefined)) return NextResponse.json({ error: "Both posts are kept. Unlock one to rewrite it." }, { status: 400 });
  const context = await loadContentReview(auth.orgId, body.draftId);
  if (!context) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  if (context.inputHash !== body.inputHash || context.superseded) return NextResponse.json({ error: "This version changed. Reload before asking again." }, { status: 409 });
  try {
    const instruction = regenerateInstruction(body.note);
    const queued = await queueCaptionRevision(prisma, auth.orgId, auth.userId, context.jobId, context.draftId, context.inputHash, instruction, context.draft.social, context.draft.googleBusiness, { locked: body.locked });
    await appendCaptionTurn(prisma, auth.orgId, auth.userId, context.draftId, { at: new Date().toISOString(), instruction, status: "queued" });
    return NextResponse.json({ ok: true, id: queued.id, status: queued.status, approved: false, published: false });
  } catch {
    return NextResponse.json({ error: "Could not queue the request. The draft is still saved." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  let auth;
  try {
    auth = await requireAuth({ allowFallback: false });
  } catch {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ error: "Preview only. Nothing was queued." }, { status: 409 });
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = captionRevisionQuerySchema.safeParse({
    draftId: searchParams.get("draftId"),
    inputHash: searchParams.get("inputHash"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a saved version." }, { status: 400 });
  }

  if (searchParams.get("mode") === "regenerate") {
    try {
      const latest = await readLatestRegenerate(prisma, auth.orgId, parsed.data.draftId, parsed.data.inputHash);
      return NextResponse.json({ ok: true, regenerate: latest ? { status: latest.status, requestedAt: latest.requestedAt, locked: latest.locked, proposal: latest.proposal, remaining: latest.remaining, error: latest.error, approved: false, published: false } : null }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "Could not load the request." }, { status: 503 });
    }
  }

  try {
    const revision = await readCaptionRevision(
      prisma,
      auth.orgId,
      parsed.data.draftId,
      parsed.data.inputHash,
    );
    const readyRevision = await readLatestReadyCaptionRevision(
      prisma,
      auth.orgId,
      parsed.data.draftId,
      parsed.data.inputHash,
    );
    const proposal = revision
      ? { ...revision, approved: false as const, published: false as const }
      : null;
    const ready = readyRevision
      ? { ...readyRevision, approved: false as const, published: false as const }
      : null;
    const turns = (await readCaptionThread(prisma, auth.orgId, parsed.data.draftId)) ?? [];
    return NextResponse.json(
      { ok: true, proposal, ready, turns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not load the revision." }, { status: 503 });
  }
}
