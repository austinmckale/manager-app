import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { createUploadInvite, INVITE_CREATED, INVITE_REVOKED } from "@/lib/field-intake";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth(); } catch { return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 }); }
  if (!canManageOrg(auth.role)) return NextResponse.json({ error: "Only an owner or admin can manage upload links." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Create the shareable link in the live app. The local preview cannot receive real photos." }, { status: 409 });
  const body = z.discriminatedUnion("action", [z.object({ action: z.literal("create") }), z.object({ action: z.literal("revoke"), id: z.string().uuid() })]).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.data.action === "revoke") {
    const invite = await prisma.activityLog.findFirst({ where: { id: body.data.id, orgId: auth.orgId, action: INVITE_CREATED } });
    if (!invite) return NextResponse.json({ error: "Link not found." }, { status: 404 });
    await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, action: INVITE_REVOKED, metadata: { inviteId: invite.id } } });
    revalidatePath("/marketing/intake");
    return NextResponse.json({ ok: true });
  }
  try {
    const invite = await createUploadInvite(auth);
    revalidatePath("/marketing/intake");
    return NextResponse.json({ ok: true, url: new URL(`/send-photos/${invite.token}`, request.url).toString(), expiresAt: invite.expiresAt });
  } catch {
    return NextResponse.json({ error: "Could not create the upload link. Check the app’s storage configuration and retry." }, { status: 503 });
  }
}
