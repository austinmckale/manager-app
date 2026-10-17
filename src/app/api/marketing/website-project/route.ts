import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { draftFromWebsiteProject, rememberWebsiteProjects } from "@/lib/website-projects";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth(); } catch { return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email) || !canManageOrg(auth.role)) return NextResponse.json({ error: "Only an owner or admin can start a draft from a website project." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "This is a preview. Nothing has been saved." }, { status: 409 });
  const parsed = z.object({ jobId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a website project." }, { status: 400 });
  const { projects } = await rememberWebsiteProjects(auth.orgId);
  const project = projects.find((item) => item.jobId === parsed.data.jobId);
  if (!project?.jobId) return NextResponse.json({ error: "That project is not on the website." }, { status: 404 });
  const assets = await prisma.fileAsset.findMany({ where: { id: { in: project.assetIds }, type: "PHOTO", isPortfolio: true, jobId: project.jobId, job: { orgId: auth.orgId } }, select: { id: true } });
  if (assets.length !== project.assetIds.length) return NextResponse.json({ error: "That project is not on the website." }, { status: 404 });
  const draft = marketingDraftSchema.parse(draftFromWebsiteProject(project));
  const saved = await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId: project.jobId, action: DRAFT_SAVED_ACTION, metadata: { ...draft, source: "website-project" } } });
  revalidatePath("/marketing/connections");
  revalidatePath("/marketing/saved");
  return NextResponse.json({ ok: true, draftId: saved.id });
}
