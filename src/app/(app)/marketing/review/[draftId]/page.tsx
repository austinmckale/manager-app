import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { postedCopyChecks } from "@/lib/content-review";
import { loadContentReview } from "@/lib/content-review-store";
import { ContentReviewEditor } from "@/components/content-review-editor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exampleDraft, exampleJobId, examplePhotos } from "@/lib/marketing-example";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { captionLocksId, captionLocksSchema } from "@/lib/caption-revision";

export const dynamic = "force-dynamic";
export default async function ContentReviewPage({ params }: { params: Promise<{ draftId: string }> }) {
  const auth = await requireAuth();
  const { draftId } = await params;
  if (isDemoMode() && draftId === "example") return <ContentReviewEditor key="example" demo draftId={exampleJobId} jobId={exampleJobId} jobName="Reading patio and pavilion · example" inputHash={"0".repeat(64)} initialDraft={exampleDraft} photos={examplePhotos.map((photo) => ({ id: photo.id, fileName: photo.fileName, url: photo.url, description: photo.description || "" }))} audio={[]} review={null} copyFindings={postedCopyChecks(exampleDraft)} approvedAt={null} superseded={false} voicePending={false} />;
  if (!isDashboardOwnerEmail(auth.email) || !z.string().uuid().safeParse(draftId).success) notFound();
  const context = await loadContentReview(auth.orgId, draftId);
  if (!context) notFound();
  const locks = captionLocksSchema.safeParse((await prisma.activityLog.findUnique({ where: { id: captionLocksId(auth.orgId, context.draftId) }, select: { metadata: true } }))?.metadata);
  const signed = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").createSignedUrls(context.assets.map((asset) => asset.storageKey), 3600);
  const urls = new Map(signed.data?.map((item) => [item.path, item.signedUrl]) || []);
  return <ContentReviewEditor key={context.draftId} lockedFields={locks.success ? locks.data.fields : []} draftId={context.draftId} jobId={context.jobId} jobName={context.jobName} inputHash={context.inputHash} originalNotes={context.originals.receiptNotes.join("\n\n")} initialDraft={context.draft} photos={context.assets.map((asset) => ({ id: asset.id, fileName: asset.fileName, url: urls.get(asset.storageKey) || "", description: asset.description || "" }))} audio={context.audio.map(({ id, transcript, status }) => ({ id, transcript, status }))} review={context.review} copyFindings={postedCopyChecks(context.draft)} approvedAt={context.approvedAt} superseded={context.superseded} replacementDraftId={context.replacementDraftId} voicePending={context.voicePending} />;
}
