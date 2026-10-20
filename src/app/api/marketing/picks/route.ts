import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { fillPicks, skipPick } from "@/lib/post-picks";

export const dynamic = "force-dynamic";
// Making a past-job pack copies its website photos, a few seconds each. One request does about 40 seconds of that.
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fill") }).strict(),
  z.object({ action: z.literal("skip"), draftId: z.string().uuid() }).strict(),
]);

/** Fill my picks, and Skip. Nothing here approves, queues to Buffer or posts. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing was saved." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose what to do." }, { status: 400 });
  try {
    const result = parsed.data.action === "fill" ? await fillPicks(prisma, auth) : await skipPick(prisma, auth, parsed.data.draftId);
    revalidatePath("/marketing/picks");
    return NextResponse.json({ ok: true, ...result, approved: false, published: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "That did not work. Try again." }, { status: 502 });
  }
}
