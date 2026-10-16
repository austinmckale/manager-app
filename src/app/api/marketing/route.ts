import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { ARCHIVED_PHOTO_TAG, DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { setPhotoPublication } from "@/lib/marketing-review";

const ids = z.array(z.string().uuid()).min(1).max(24);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveDraft"), jobId: z.string().uuid(), draft: marketingDraftSchema }),
  z.object({ action: z.literal("publish"), assetIds: ids, clearedForPublicUse: z.literal(true) }),
  z.object({ action: z.literal("unpublish"), assetIds: ids }),
  z.object({ action: z.literal("archive"), assetIds: ids }),
  z.object({ action: z.literal("restore"), assetIds: ids }),
  z.object({ action: z.literal("assign"), assetIds: ids, jobId: z.string().uuid() }),
  z.object({ action: z.literal("updatePhoto"), assetIds: z.array(z.string().uuid()).length(1), description: z.string().max(3000), stage: z.enum(["BEFORE", "DURING", "AFTER"]) }),
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth(); } catch { return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 }); }
  if (!canManageOrg(auth.role)) return NextResponse.json({ error: "Only an owner or admin can review marketing photos." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the selected photos and text lengths, then try again." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ error: "This is a preview. Nothing has been saved or published." }, { status: 409 });
  const body = parsed.data;
  try {
    let savedDraftId: string | undefined;
    const assetIds = body.action === "saveDraft" ? body.draft.assetIds : body.assetIds;
    const assets = await prisma.fileAsset.findMany({ where: { id: { in: assetIds }, type: "PHOTO", job: { orgId: auth.orgId } } });
    if (assets.length !== new Set(assetIds).size) return NextResponse.json({ error: "Some photos are unavailable." }, { status: 404 });
    if (body.action === "publish" || body.action === "unpublish") {
      const result = await setPhotoPublication(auth, assetIds, body.action === "publish");
      revalidatePath("/marketing");
      revalidatePath("/portfolio");
      return NextResponse.json({ ok: result.failures.length === 0, ...result, error: result.failures.length ? `Could not finish ${result.failures.length} photo(s): ${result.failures.join(", ")}. Please retry.` : undefined });
    }
    if (body.action === "saveDraft") {
      if (assets.some((asset) => asset.jobId !== body.jobId)) return NextResponse.json({ error: "Choose photos from one job for each draft." }, { status: 400 });
      const savedDraft = await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId: body.jobId, action: DRAFT_SAVED_ACTION, metadata: body.draft } });
      savedDraftId = savedDraft.id;
    } else if (body.action === "assign") {
      if (assets.some((asset) => asset.isPortfolio)) throw new Error("Remove photos from the website before moving them to another job.");
      const job = await prisma.job.findFirst({ where: { id: body.jobId, orgId: auth.orgId, NOT: { categoryTags: { has: "photo-dump" } } } });
      if (!job) return NextResponse.json({ error: "Choose an available job." }, { status: 404 });
      await prisma.$transaction([
        prisma.fileAsset.updateMany({ where: { id: { in: assetIds }, job: { orgId: auth.orgId } }, data: { jobId: job.id } }),
        prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId: job.id, action: "marketing.photos.assigned", metadata: { assetIds } } }),
      ]);
    } else if (body.action === "updatePhoto") {
      if (assets[0].isPortfolio) throw new Error("Remove this photo from the website before changing its description or stage.");
      await prisma.fileAsset.update({ where: { id: assets[0].id }, data: { description: body.description, stage: body.stage, tags: [...assets[0].tags.filter((tag) => !tag.startsWith("stage:")), `stage:${body.stage.toLowerCase()}`] } });
    } else {
      if (body.action === "archive" && assets.some((asset) => asset.isPortfolio)) throw new Error("Remove photos from the website before archiving them.");
      await prisma.$transaction(assets.map((asset) => prisma.fileAsset.update({ where: { id: asset.id }, data: { tags: body.action === "archive" ? [...new Set([...asset.tags, ARCHIVED_PHOTO_TAG])] : asset.tags.filter((tag) => tag !== ARCHIVED_PHOTO_TAG) } })));
    }
    revalidatePath("/marketing");
    revalidatePath("/portfolio");
    revalidatePath("/marketing/saved");
    for (const asset of assets) revalidatePath(`/jobs/${asset.jobId}/photos`);
    return NextResponse.json({ ok: true, draftId: savedDraftId });
  } catch (error) {
    console.error("[marketing] action failed", body.action);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not complete this action. Please retry." }, { status: 400 });
  }
}
