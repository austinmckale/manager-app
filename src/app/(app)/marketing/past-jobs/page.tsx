import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { listPastJobs, websiteThumb } from "@/lib/past-jobs";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { websiteProjectCatalog } from "@/lib/website-project-catalog";
import { PastJobsList } from "@/components/past-jobs-list";

export const dynamic = "force-dynamic";

export default async function PastJobsPage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Past jobs are available to the owner and admins.</p>;
  const demo = isDemoMode();
  const jobs = demo
    ? websiteProjectCatalog.map((project) => ({ ...project, draftId: null, status: "new" as const, coverUrl: project.images[0] ? websiteThumb(project.images[0].src) : "" }))
    : await listPastJobs(prisma, auth.orgId);
  const items = jobs.map(({ slug, title, location, service, description, coverUrl, images, draftId, status }) => ({ slug, title, location, service, description, coverUrl, photoCount: images.length, draftId, status }));
  const made = items.filter((item) => item.status !== "new").length;
  return <div className="space-y-4">
    <div>
      <p className="text-xs uppercase tracking-widest text-teal-700">Something true to post between new jobs</p>
      <h2 className="mt-2 text-2xl font-semibold">Past jobs</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">The {items.length} projects on rhipros.com. Make a post from one and the app copies its website photos and published description into a marketing pack, then the AI checks the captions against the photos. You review and approve it like any other post. Nothing is posted automatically.</p>
      <p className="mt-1 text-sm text-slate-600">{made} of {items.length} have a pack.</p>
    </div>
    {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Preview only. Packs are made in the connected app.</p> : null}
    <PastJobsList items={items} demo={demo} />
  </div>;
}
