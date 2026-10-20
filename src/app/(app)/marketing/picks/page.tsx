import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { exampleDraft, examplePhotos } from "@/lib/marketing-example";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { websiteProjectCatalog } from "@/lib/website-project-catalog";
import { PostPicks, type PickCard } from "@/components/post-picks";
import type { PickChannel } from "@/lib/post-picks-rules";

export const dynamic = "force-dynamic";

/** Demo mode has no database: three example cards show how the page looks. */
function demoCards(): PickCard[] {
  const base = { inputHash: "0".repeat(64), source: "past" as const, title: exampleDraft.packName, createdAt: new Date().toISOString(), social: exampleDraft.social, googleBusiness: exampleDraft.googleBusiness, assetIds: examplePhotos.map((photo) => photo.id), photos: examplePhotos.map(({ id, url, description }) => ({ id, url, description })), photoCount: examplePhotos.length, notes: [], lastSentAt: null };
  return [
    { ...base, draftId: "30000000-0000-4000-8000-000000000001", status: "ready" },
    { ...base, draftId: "30000000-0000-4000-8000-000000000002", status: "look", notes: ["The Google Business update repeats the Facebook post."] },
    { ...base, draftId: "30000000-0000-4000-8000-000000000003", status: "preparing", source: "new", title: "Ryan's newest upload" },
  ];
}

export default async function PickPostsPage() {
  const auth = await requireAuth();
  const demo = isDemoMode();
  if (!canManageOrg(auth.role) || (!demo && !isDashboardOwnerEmail(auth.email))) return <p>Pick posts is for the owner.</p>;
  let cards: PickCard[] = demoCards();
  let channels: PickChannel[] = [{ id: "demo-facebook", service: "facebook", name: "RHI Pros Facebook" }, { id: "demo-google", service: "googlebusiness", name: "RHI Pros Google Business" }];
  let channelError = "";
  let unmadePastJobs = websiteProjectCatalog.length;
  if (!demo) {
    const [{ listPicks }, { listPastJobs }, { savedBufferChannels }, { supabaseAdmin }] = await Promise.all([import("@/lib/post-picks"), import("@/lib/past-jobs"), import("@/lib/publishing/buffer-store"), import("@/lib/supabase/admin")]);
    const [picks, pastJobs, saved] = await Promise.all([listPicks(prisma, auth.orgId), listPastJobs(prisma, auth.orgId), savedBufferChannels(auth.orgId).catch(() => null)]);
    // Saved channels only: the send itself checks with Buffer that each one is still connected.
    channels = (saved ?? []).filter((channel) => ["facebook", "googlebusiness"].includes(channel.service)).map((channel) => ({ id: channel.id, service: channel.service, name: channel.displayName || channel.name }));
    if (!saved) channelError = "Your saved Buffer channels could not be read. Check the Buffer page.";
    unmadePastJobs = pastJobs.filter((job) => job.status === "new").length;
    const keys = [...new Set(picks.flatMap((pick) => pick.photos.slice(0, 3).map((photo) => photo.storageKey)))];
    const signed = keys.length ? await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").createSignedUrls(keys, 3600) : { data: [] };
    const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    cards = picks.map((pick) => ({
      draftId: pick.draftId, inputHash: pick.inputHash, source: pick.source, title: pick.title, createdAt: pick.createdAt, social: pick.social, googleBusiness: pick.googleBusiness,
      assetIds: pick.assetIds, status: pick.status, notes: pick.notes, lastSentAt: pick.lastSentAt, photoCount: pick.photos.length,
      photos: pick.photos.slice(0, 3).map((photo) => ({ id: photo.id, url: urls.get(photo.storageKey) ?? "", description: photo.description })),
    }));
  }
  return <div className="space-y-4">
    <div>
      <p className="text-xs uppercase tracking-widest text-teal-700">Your posts, ready to go</p>
      <h2 className="mt-2 text-2xl font-semibold">Pick posts</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">Every post here was written and checked by the AI on your PC, from Ryan&apos;s uploads and the website&apos;s past jobs. Picking one is your approval and sends it to Buffer. Nothing posts otherwise, and a job sent in the last 90 days is not offered again.</p>
    </div>
    {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Example only. Filling, approving and sending are off.</p> : null}
    <PostPicks cards={cards} channels={channels} channelError={channelError} unmadePastJobs={unmadePastJobs} demo={demo} />
  </div>;
}
