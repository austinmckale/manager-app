import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { makePastJobPack } from "@/lib/past-jobs";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// Copying a project's website photos takes a few seconds per photo.
export const maxDuration = 60;

const bodySchema = z.object({ slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/) }).strict();

/** Makes the marketing pack for one website project. Nothing is approved or posted. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing was saved." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a project." }, { status: 400 });
  try {
    const result = await makePastJobPack(prisma, auth, parsed.data.slug);
    revalidatePath("/marketing/past-jobs");
    revalidatePath("/marketing/saved");
    return NextResponse.json({ ok: true, ...result, approved: false, published: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not make the pack. Try again." }, { status: 502 });
  }
}
