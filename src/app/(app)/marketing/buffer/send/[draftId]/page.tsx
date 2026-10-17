import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { loadContentReview } from "@/lib/content-review-store";
import { approvedPublishingDraft } from "@/lib/publishing/approval";
import { activeBufferChannels, bufferDeliveries } from "@/lib/publishing/buffer-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BufferSend, BufferHistory } from "@/components/buffer-delivery";
import type { BufferChannel } from "@/lib/publishing/buffer";

export const dynamic = "force-dynamic";
export default async function BufferSendPage({ params }: { params: Promise<{ draftId: string }> }) {
  const auth = await requireAuth();
  const { draftId } = await params;
  if (isDemoMode() || !isDashboardOwnerEmail(auth.email) || !z.string().uuid().safeParse(draftId).success) notFound();
  const context = await loadContentReview(auth.orgId, draftId);
  if (!context) notFound();
  let approved = false;
  try { approvedPublishingDraft(auth.orgId, draftId, context); approved = true; } catch { /* Show the preview with sending disabled. */ }
  let channels: BufferChannel[] = [];
  let error = "";
  try { channels = await activeBufferChannels(auth.orgId); } catch { error = "Buffer channels could not be verified. Check your connection on the setup page."; }
  const signed = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").createSignedUrls(context.assets.map((a) => a.storageKey), 3600);
  const urls = new Map(signed.data?.map((item) => [item.path, item.signedUrl]) || []);
  const photos = context.draft.assetIds.map((id) => context.assets.find((a) => a.id === id)!).map((a) => ({ id: a.id, url: urls.get(a.storageKey) || "", description: a.description || "", fileName: a.fileName }));
  return <div className="space-y-5"><header><Link className="text-sm underline" href={`/marketing/review/${draftId}`}>← Review this version</Link><h1 className="mt-3 text-2xl font-semibold">Send approved posts to Buffer</h1><p className="mt-2">{context.draft.packName || "Marketing pack"}</p><p className="mt-2 text-sm text-slate-600">The approved text goes with the photos you choose below. Buffer handles social delivery after you add a post to its queue. Your PC does not need to stay on for Buffer publishing.</p><Link href="/marketing/buffer?check=1" className="mt-3 inline-block text-sm underline">Buffer connection & delivery history</Link></header>{error ? <p role="alert">{error}</p> : null}<BufferSend draftId={draftId} inputHash={context.inputHash} social={context.draft.social} googleBusiness={context.draft.googleBusiness} location={context.draft.publicLocation} approved={approved && photos.every((p) => !!p.url)} channels={channels} photos={photos} /><BufferHistory records={await bufferDeliveries(auth.orgId, draftId)} /></div>;
}
