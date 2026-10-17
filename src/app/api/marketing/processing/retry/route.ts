import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only." }, { status: 409 });
  const parsed = z.object({ audioId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a failed recording." }, { status: 400 });
  try {
    const row = await prisma.activityLog.findFirst({ where: { id: parsed.data.audioId, orgId: auth.orgId, action: AUDIO_RECEIVED } });
    const meta = row?.metadata as Record<string, unknown> | null;
    if (!row || meta?.status !== "failed") return NextResponse.json({ error: "This recording is unavailable or already queued. Refresh the page." }, { status: 409 });
    const result = await prisma.activityLog.updateMany({ where: { id: row.id, orgId: auth.orgId, action: AUDIO_RECEIVED, metadata: { path: ["status"], equals: "failed" } }, data: { metadata: JSON.parse(JSON.stringify({ ...meta, status: "queued", previousTranscriptionAttempts: meta.transcriptionAttempts, transcriptionAttempts: 0, nextRetryAt: null, retryRequestedAt: new Date().toISOString(), retryRequestedBy: auth.userId })) } });
    if (result.count !== 1) return NextResponse.json({ error: "The recording changed. Refresh the page." }, { status: 409 });
    return NextResponse.json({ ok: true, queued: true });
  } catch { return NextResponse.json({ error: "Could not queue the recording. Try again." }, { status: 503 }); }
}
