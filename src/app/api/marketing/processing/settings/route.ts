import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { PROCESSING_SETTINGS, processingId, processingSettings, processingSettingsSchema } from "@/lib/marketing-processing";

const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("save"), enabled: z.boolean(), mode: z.enum(["hybrid", "local", "manual"]), dailyCallLimit: z.number().int().min(1).max(500) }), z.object({ action: z.literal("test") })]);
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only." }, { status: 409 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Check the processing settings." }, { status: 400 });
  try {
    const current = await processingSettings(prisma, auth.orgId);
    const metadata = processingSettingsSchema.parse(body.data.action === "save" ? { ...current, ...body.data, enabled: body.data.mode === "manual" ? false : body.data.enabled, testRequestedAt: null, testDraftId: null, testSubmissionId: null } : { ...current, testRequestedAt: new Date().toISOString(), testDraftId: null, testSubmissionId: null });
    const id = processingId(auth.orgId, "settings");
    await prisma.activityLog.upsert({ where: { id }, create: { id, orgId: auth.orgId, actorId: auth.userId, action: PROCESSING_SETTINGS, metadata }, update: { metadata, actorId: auth.userId } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not save processing settings." }, { status: 503 }); }
}
