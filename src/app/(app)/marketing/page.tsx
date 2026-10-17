import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ARCHIVED_PHOTO_TAG, DRAFT_SAVED_ACTION, marketingDraftSchema } from "@/lib/marketing";
import { MarketingJobReview } from "@/components/marketing-job-review";
import { exampleDraft, exampleJobId, examplePhotos } from "@/lib/marketing-example";
import { parseSavedPack } from "@/lib/saved-marketing";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; jobId?: string; example?: string; draftId?: string; demoDraft?: string }> }) {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p className="rounded-xl bg-slate-50 p-4">Photo review and marketing drafts are available to the owner and admins. <Link href="/capture" className="underline">Add job photos</Link></p>;
  const params = await searchParams;
  const demo = isDemoMode();
  const savedRecord = !demo && /^[0-9a-f-]{36}$/i.test(params.draftId ?? "") ? await prisma.activityLog.findFirst({ where: { id: params.draftId, orgId: auth.orgId, action: DRAFT_SAVED_ACTION }, include: { job: { select: { jobName: true } } } }) : null;
  const savedPack = savedRecord ? parseSavedPack(savedRecord) : null;
  const view = savedPack ? "all" : ["published", "archived", "all"].includes(params.view ?? "") ? params.view! : "unpublished";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const jobId = savedPack?.jobId ?? (/^[0-9a-f-]{36}$/i.test(params.jobId ?? "") ? params.jobId : undefined);
  const websiteConfigured = Boolean(process.env.SITE_REVALIDATE_URL && process.env.SITE_REVALIDATE_SECRET);
  const weekStart = new Date();
  weekStart.setTime(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekly = demo ? [0, 0, 0] : await Promise.all([
    prisma.fileAsset.count({ where: { job: { orgId: auth.orgId }, type: "PHOTO", createdAt: { gte: weekStart } } }),
    prisma.fileAsset.count({ where: { job: { orgId: auth.orgId }, type: "PHOTO", isPortfolio: true, updatedAt: { gte: weekStart } } }),
    prisma.lead.count({ where: { orgId: auth.orgId, utmCampaign: { startsWith: "job-" }, createdAt: { gte: weekStart } } }),
  ]);
  const where = {
    job: { orgId: auth.orgId }, type: "PHOTO" as const,
    ...(jobId ? { jobId } : {}),
    ...(savedPack ? { id: { in: savedPack.draft.assetIds } } : {}),
    ...(view === "published" ? { isPortfolio: true } : {}),
    ...(view === "unpublished" ? { isPortfolio: false, NOT: { tags: { has: ARCHIVED_PHOTO_TAG } } } : {}),
    ...(view === "archived" ? { tags: { has: ARCHIVED_PHOTO_TAG } } : {}),
  };
  const [assets, total, jobs] = demo ? [[], 0, []] as const : await Promise.all([
    prisma.fileAsset.findMany({ where, include: { job: { select: { id: true, jobName: true, categoryTags: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: savedPack ? 0 : (page - 1) * 24, take: 24 }),
    prisma.fileAsset.count({ where }),
    prisma.job.findMany({ where: { orgId: auth.orgId }, select: { id: true, jobName: true, categoryTags: true }, orderBy: { updatedAt: "desc" }, take: 250 }),
  ]);
  const grouped = new Map<string, typeof assets[number][]>();
  for (const asset of assets) {
    const submission = asset.tags.find((tag) => tag.startsWith("submission:"));
    const group = submission ? `${asset.jobId}|${submission}` : asset.jobId;
    grouped.set(group, [...(grouped.get(group) ?? []), asset]);
  }
  const logs = demo || !assets.length ? [] : await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: DRAFT_SAVED_ACTION, jobId: { in: [...new Set(assets.map((asset) => asset.jobId))] } }, orderBy: { createdAt: "desc" }, distinct: ["jobId"], take: 24 });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets";
  const signed = assets.length ? await supabaseAdmin.storage.from(bucket).createSignedUrls(assets.map((asset) => asset.storageKey), 3600) : null;
  const signedUrls = new Map(signed?.data?.map((item) => [item.path, item.signedUrl]) ?? []);
  const pageLink = (number: number) => `/marketing?${new URLSearchParams({ view, page: String(number), ...(jobId ? { jobId } : {}) })}`;
  return <div className="space-y-5">
    <section className="rounded-2xl bg-teal-900 p-5 text-white">
      <p className="text-xs uppercase tracking-widest text-teal-200">Your marketing workspace</p>
      <h2 className="mt-2 text-2xl font-semibold">One upload. More places to show your work.</h2>
      <p className="mt-2 max-w-xl text-sm text-teal-50">Upload the photos you receive, choose the best ones, and prepare your website update, social posts and ads together.</p>
      <Link href="/capture" className="mt-4 inline-flex rounded-xl bg-white px-4 py-3 text-sm font-semibold text-teal-900">Upload photos</Link>
      <Link href="/marketing/delivery" className="ml-4 mt-4 inline-flex underline">AI processing & submissions needing context</Link>
      <Link href="/marketing/buffer" className="ml-4 mt-4 inline-flex underline">Connect Buffer</Link>
    </section>
    <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">Website: {websiteConfigured ? "refresh connection configured" : "photo feed available; instant refresh not configured"}. <Link href="/marketing/connections" className="underline">Post an approved draft to Facebook</Link>, and open <Link href="/marketing/results" className="underline">weekly results</Link>. Export stays available while a platform is waiting on approval.</div>
    <section aria-label="Past seven days" className="rounded-2xl border border-slate-200 p-4"><h3 className="text-sm font-medium">Past 7 days</h3><div className="mt-3 grid grid-cols-3 gap-3">{[[weekly[0], "Photos uploaded"], [weekly[1], "Website photos updated"], [weekly[2], "Leads from tracked packs"]].map(([value, label]) => <div key={String(label)}><p className="text-2xl font-semibold text-teal-800">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}</div><p className="mt-3 text-xs text-slate-500">Tracked leads are quote requests with a marketing-pack campaign link. Ad spend, phone calls and booked revenue are not included.</p></section>
    {demo ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Preview mode. Example packs can be saved in this browser; uploading and publishing require the connected app database. <Link href="/marketing?example=1" className="underline">Try our patio and pavilion website photos</Link>.</p> : null}
    {params.draftId && !savedPack ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This saved pack is unavailable. Open your <Link href="/marketing/saved" className="underline">saved packs</Link> to choose another.</p> : null}
    {savedPack ? <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">Reusing “{savedPack.draft.packName || savedPack.jobName}”. The saved original stays unchanged; saving creates a new version. Review time-sensitive wording before reposting.</p> : null}
    {demo && params.example === "1" ? <MarketingJobReview key={params.demoDraft ?? "website-example"} jobId={exampleJobId} jobName="Reading patio and pavilion · website example" unsorted={false} jobs={[]} photos={examplePhotos} initialDraft={exampleDraft} demo demoDraftId={params.demoDraft} /> : null}
    <form method="get" className="flex flex-wrap gap-2">
      <select aria-label="Photo status" name="view" defaultValue={view} className="rounded-xl border border-slate-300 p-2 text-sm"><option value="unpublished">Unpublished</option><option value="published">On website</option><option value="archived">Archived</option><option value="all">All photos</option></select>
      <select aria-label="Filter by job" name="jobId" defaultValue={jobId ?? ""} className="min-w-0 max-w-full rounded-xl border border-slate-300 p-2 text-sm"><option value="">All jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.categoryTags.includes("photo-dump") ? "Unsorted photos" : job.jobName}</option>)}</select>
      <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Show photos</button>
    </form>
    <p className="text-sm text-slate-500">{total} photos · {assets.length ? `Showing ${(page - 1) * 24 + 1}–${Math.min(page * 24, total)}` : "None in this view"}</p>
    {[...grouped.entries()].map(([group, items]) => {
      const id = items[0].jobId;
      const isCrewBatch = group.includes("|submission:");
      const batchLocation = isCrewBatch ? items[0].description?.match(/^Town \/ job: (.+)/)?.[1] : undefined;
      const stored = marketingDraftSchema.safeParse(savedPack?.draft ?? logs.find((log) => log.jobId === id)?.metadata);
      const samePhotos = stored.success && (savedPack || stored.data.assetIds.every((assetId) => items.some((asset) => asset.id === assetId)));
      return <MarketingJobReview key={`${savedPack?.id ?? group}-${view}-${page}`} jobId={id} jobName={isCrewBatch ? `Ryan’s photos${batchLocation ? ` · ${batchLocation}` : ""}` : items[0].job.jobName} batchLabel={isCrewBatch ? `Ryan’s photos${batchLocation ? ` · ${batchLocation}` : ""}` : undefined} unsorted={items[0].job.categoryTags.includes("photo-dump")} jobs={jobs.filter((job) => !job.categoryTags.includes("photo-dump"))} initialDraft={stored.success && samePhotos ? stored.data : undefined} savedPackId={savedPack?.id} photos={items.map((asset) => ({ id: asset.id, fileName: asset.fileName, url: signedUrls.get(asset.storageKey) ?? "", description: asset.description ?? "", stage: asset.stage, mimeType: asset.mimeType, area: asset.area, tags: asset.tags, published: asset.isPortfolio, updatedAt: asset.updatedAt.toISOString() }))} />;
    })}
    {savedPack && !assets.length ? <MarketingJobReview jobId={savedPack.jobId} jobName={savedPack.jobName} unsorted={false} jobs={[]} photos={[]} initialDraft={savedPack.draft} savedPackId={savedPack.id} /> : null}
    {!assets.length ? <section className="rounded-2xl border border-dashed border-slate-300 p-8 text-center"><h3 className="font-semibold">{view === "unpublished" ? "Your next marketing project starts with photos." : "No photos in this view."}</h3><p className="mt-2 text-sm text-slate-500">Upload several photos at once. Add a note about the work so your drafts start with the facts.</p><Link href="/capture" className="mt-4 inline-block rounded-xl bg-teal-700 px-4 py-3 text-sm text-white">Upload photos</Link></section> : null}
    <div className="flex justify-between text-sm">{page > 1 ? <Link href={pageLink(page - 1)} className="underline">Previous</Link> : <span />}{page * 24 < total ? <Link href={pageLink(page + 1)} className="underline">Next photos</Link> : null}</div>
  </div>;
}
