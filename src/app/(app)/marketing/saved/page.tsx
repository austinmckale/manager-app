import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { DRAFT_SAVED_ACTION } from "@/lib/marketing";
import { parseSavedPack } from "@/lib/saved-marketing";
import { SavedMarketingPacks } from "@/components/saved-marketing-packs";

export default async function SavedPacksPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Saved marketing packs are available to the owner and admins.</p>;
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const demo = isDemoMode();
  const records = demo ? [] : await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: DRAFT_SAVED_ACTION }, include: { job: { select: { jobName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 21 });
  const packs = records.slice(0, 20).map(parseSavedPack).filter((pack) => pack !== null);
  return <div className="space-y-4">
    <div><p className="text-xs uppercase tracking-widest text-teal-700">Your content library</p><h2 className="mt-2 text-2xl font-semibold">Saved marketing packs</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Keep the photos, original notes, public town, service, captions, headlines and website link together. Reopen a pack, change the angle or offer, then save a new version. Saving and reusing never publishes a post.</p></div>
    <Link href="/marketing" className="inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm">Back to review & create</Link>
    {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Preview packs are stored only in this browser on this device. In the connected app, saved packs belong to your account’s organization. <Link className="underline" href="/marketing?example=1">Try the real website-photo example</Link>.</p> : null}
    <SavedMarketingPacks packs={packs} demo={demo} />
    <nav aria-label="Saved pack pages" className="flex justify-between text-sm">{page > 1 ? <Link className="underline" href={`/marketing/saved?page=${page - 1}`}>Previous packs</Link> : <span />}{records.length > 20 ? <Link className="underline" href={`/marketing/saved?page=${page + 1}`}>More packs</Link> : null}</nav>
  </div>;
}
