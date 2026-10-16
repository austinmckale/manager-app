import type { AuthContext } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canPublishPhoto } from "@/lib/marketing";
import { ensureSitePublicBucket, publishToSiteBucket, unpublishFromSiteBucket } from "@/lib/portfolio-publish";
import { revalidateSitePortfolio } from "@/lib/revalidate-site";

export async function setPhotoPublication(auth: AuthContext, assetIds: string[], published: boolean) {
  if (!canManageOrg(auth.role)) throw new Error("Only an owner or admin can publish photos.");
  const assets = await prisma.fileAsset.findMany({ where: { id: { in: assetIds }, type: "PHOTO", job: { orgId: auth.orgId } }, include: { job: { select: { categoryTags: true } } } });
  if (!assets.length || assets.length !== new Set(assetIds).size) throw new Error("Some photos are unavailable. Refresh and try again.");
  if (published && assets.some((asset) => !canPublishPhoto(asset) || asset.job.categoryTags.includes("photo-dump"))) {
    throw new Error("Assign photos to a job, mark them as finished work, and use JPG, PNG or WebP before publishing.");
  }
  const failures: string[] = [];
  let completed = 0;
  if (published) await ensureSitePublicBucket();
  for (const asset of assets) {
    try {
      if (published && !await publishToSiteBucket(asset.storageKey)) throw new Error("Public photo copy failed.");
      // Update the feed only after a public file exists. Revalidate after DB commit.
      await prisma.$transaction([
        prisma.fileAsset.update({ where: { id: asset.id }, data: { isPortfolio: published } }),
        prisma.activityLog.create({ data: { orgId: auth.orgId, jobId: asset.jobId, actorId: auth.userId, action: published ? "file.portfolio.added" : "file.portfolio.removed", metadata: { fileAssetId: asset.id } } }),
      ]);
      if (!published) await unpublishFromSiteBucket(asset.storageKey);
      completed += 1;
    } catch {
      failures.push(asset.fileName);
    }
  }
  let warning = "";
  try {
    if (!await revalidateSitePortfolio()) warning = "Website refresh is not configured. The photo feed may take up to an hour to update.";
  } catch {
    warning = "Website refresh failed. The photo feed may take up to an hour to update.";
  }
  return { completed, failures, warning };
}
