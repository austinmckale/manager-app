import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidateSitePortfolio } from "@/lib/revalidate-site";

const PRIVATE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
const PUBLIC_BUCKET = "site-public";

/**
 * Copy a photo from the private job-assets bucket to the public
 * site-public bucket. This ensures only explicitly published images
 * are ever accessible from the marketing site.
 */
export async function publishToSiteBucket(storageKey: string): Promise<string | null> {
  try {
    const { data: fileData, error: dlError } = await supabaseAdmin.storage
      .from(PRIVATE_BUCKET)
      .download(storageKey);

    if (dlError || !fileData) {
      console.error("[portfolio-publish] download failed:", dlError?.message);
      return null;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const { error: upError } = await supabaseAdmin.storage
      .from(PUBLIC_BUCKET)
      .upload(storageKey, arrayBuffer, {
        contentType: fileData.type || "image/jpeg",
        upsert: true,
      });

    if (upError) {
      console.error("[portfolio-publish] upload to site-public failed:", upError.message);
      return null;
    }

    return storageKey;
  } catch (err) {
    console.error("[portfolio-publish] unexpected error:", err);
    return null;
  }
}

/**
 * Remove a photo from the public site-public bucket when it is
 * un-flagged from portfolio.
 */
export async function unpublishFromSiteBucket(storageKey: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(PUBLIC_BUCKET).remove([storageKey]);
  if (error) throw new Error("Photo was removed from the feed, but its public file could not be removed. Please retry.");
}

/**
 * Full publish flow: copy to public bucket + revalidate the site cache.
 */
export async function onPortfolioPublish(assetId: string, storageKey: string) {
  await ensureSitePublicBucket();
  const published = await publishToSiteBucket(storageKey);
  if (!published) throw new Error(`Could not publish photo ${assetId}. Please retry.`);
  return revalidateSitePortfolio();
}

/**
 * Full unpublish flow: remove from public bucket + revalidate.
 */
export async function onPortfolioUnpublish(storageKey: string) {
  await unpublishFromSiteBucket(storageKey);
  return revalidateSitePortfolio();
}

/**
 * Ensure the site-public bucket exists. Call once at startup or via setup script.
 */
export async function ensureSitePublicBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === PUBLIC_BUCKET);
  if (!exists) {
    const { error } = await supabaseAdmin.storage.createBucket(PUBLIC_BUCKET, {
      public: true,
      fileSizeLimit: 20 * 1024 * 1024,
    });
    if (error) {
      console.error("[portfolio-publish] bucket creation failed:", error.message);
      throw new Error("Website photo storage is unavailable. Please retry.");
    } else {
      console.log("[portfolio-publish] created site-public bucket");
    }
  }
}
