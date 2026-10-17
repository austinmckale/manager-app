import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { draftChoice, loadSavedDraft, recentDrafts } from "@/lib/publishing/connection-store";
import { presentedConnections } from "@/lib/publishing/execute";
import { CampaignDraftForm } from "@/components/publishing/campaign-draft-form";
import { ConnectionCard } from "@/components/publishing/connection-card";
import { FacebookPublishScreen } from "@/components/publishing/facebook-publish-screen";
import { WebsiteProjectList } from "@/components/publishing/website-project-list";
import type { FacebookDraft } from "@/components/publishing/facebook-publish";
import type { MarketingProviderName } from "@/lib/publishing/types";
import { marketingDraftSchema } from "@/lib/marketing";
import { canApproveContent, copyChecks } from "@/lib/content-review";
import { loadContentReview } from "@/lib/content-review-store";
import { prisma } from "@/lib/prisma";
import { catalogProjects, pickShuffledProject, rememberWebsiteProjects, websiteCaption } from "@/lib/website-projects";
import { WEBSITE_ORIGIN } from "@/lib/website-project-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RESULT_COPY: Record<string, string> = {
  connected: "The account authorization was saved.",
  "choose-account": "Choose the Page, Instagram account, location, or ad account to use.",
  "missing-configuration": "Add the missing app configuration before connecting.",
  "oauth-denied": "The connection was cancelled.",
  "oauth-mismatch": "The connection attempt could not be verified. Start it again.",
  "oauth-error": "The account could not be connected. Start it again.",
  preview: "This is a preview. Nothing has been connected or published.",
};

const PROVIDERS: MarketingProviderName[] = ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS", "GOOGLE_ADS", "META_ADS"];

async function facebookDraftPreviews(orgId: string, choices: { id: string; jobId: string; jobName: string; createdAt: string; assetIds: string[] }[]): Promise<FacebookDraft[]> {
  return Promise.all(choices.map(async (choice) => {
    const saved = await loadSavedDraft(orgId, choice.id).catch(() => null);
    const parsed = marketingDraftSchema.safeParse(saved?.metadata);
    const caption = parsed.success ? parsed.data.social : "";
    let approval: FacebookDraft["approval"] = "unavailable";
    let approvalDetail = "Owner approval could not be confirmed. Refresh the draft before posting.";
    try {
      const review = await loadContentReview(orgId, choice.id);
      if (review?.superseded) {
        approval = "superseded";
        approvalDetail = "This draft was replaced. Approve the current version before posting.";
      } else if (review?.approvedAt && review.review?.draftId === choice.id && canApproveContent(review.inputHash, review.review, review.superseded, review.voicePending) && !copyChecks(review.draft).some((finding) => finding.severity === "blocker")) {
        approval = "approved";
        approvalDetail = "Owner approval matches this saved draft and its current evidence.";
      } else if (review) {
        approval = "missing";
        approvalDetail = "Owner approval of this exact draft and its current evidence is still required.";
      }
    } catch { /* The publishing request still enforces approval. */ }
    const assets = await prisma.fileAsset.findMany({ where: { id: { in: choice.assetIds }, jobId: choice.jobId, job: { orgId }, type: "PHOTO" }, select: { id: true, fileName: true, storageKey: true } }).catch(() => []);
    const signed = assets.length ? await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").createSignedUrls(assets.map((asset) => asset.storageKey), 3600).catch(() => null) : null;
    const urls = new Map(signed?.data?.map((item) => [item.path, item.signedUrl]) ?? []);
    return {
      ...choice,
      caption,
      approval,
      approvalDetail,
      photos: choice.assetIds.map((id) => {
        const asset = assets.find((item) => item.id === id);
        return { id, fileName: asset?.fileName ?? "Selected photo", url: asset ? urls.get(asset.storageKey) ?? null : null };
      }),
    };
  }));
}

export default async function MarketingConnectionsPage({ searchParams }: { searchParams: Promise<{ result?: string; draftId?: string; website?: string }> }) {
  const auth = await requireAuth();
  const denied = marketingAccessDenied(auth.role);
  if (denied) return <p className="rounded-xl bg-slate-50 p-4 text-sm">{denied}</p>;
  const params = await searchParams;
  const notice = params.result ? RESULT_COPY[params.result] : "";
  const requestedDraftId = /^[0-9a-f-]{36}$/i.test(params.draftId ?? "") ? params.draftId : "";
  const requestedWebsite = /^[a-z0-9-]{1,80}$/.test(params.website ?? "") ? params.website ?? "" : "";
  const demo = isDemoMode();
  const storedCatalog = catalogProjects(auth.orgId);
  const env = readPublishingEnv(process.env);
  const [loaded, drafts] = await Promise.all([
    demo
      ? Promise.resolve({
          migrationReady: false,
          publishMode: env.publishMode,
          connections: PROVIDERS.map((provider) => presentConnection(provider, null, env, new Date())),
        })
      : presentedConnections(auth.orgId),
    demo ? Promise.resolve([]) : recentDrafts(auth.orgId).catch(() => []),
  ]);
  const selectedDraft = requestedDraftId && !demo && !drafts.some((draft) => draft.id === requestedDraftId)
    ? await draftChoice(auth.orgId, requestedDraftId).catch(() => null)
    : null;
  const draftChoices = selectedDraft ? [selectedDraft, ...drafts] : drafts;
  const [previews, website] = await Promise.all([
    demo ? Promise.resolve([]) : facebookDraftPreviews(auth.orgId, draftChoices).catch(() => []),
    demo ? Promise.resolve({ projects: storedCatalog, featured: pickShuffledProject(storedCatalog) }) : rememberWebsiteProjects(auth.orgId).catch(() => ({ projects: storedCatalog, featured: pickShuffledProject(storedCatalog) })),
  ]);
  const catalog = website.projects.filter((project) => project.slug);
  const selectedWebsite = catalog.find((project) => project.slug === requestedWebsite) ?? null;
  const featuredWebsite = catalog.find((project) => project.id === website.featured?.id) ?? pickShuffledProject(catalog);
  const mixed = [selectedWebsite, featuredWebsite].filter((project, index, all) => project && all.findIndex((item) => item?.id === project.id) === index);
  const websiteDrafts = mixed.flatMap((project) => project ? [{
    id: project.id,
    jobId: project.jobId ?? "",
    jobName: project.name,
    createdAt: project.newestAt,
    caption: websiteCaption(project),
    photos: project.images.slice(0, 4).map((image, index) => ({ id: `${project.slug}-${index}`, fileName: image.alt, url: `${WEBSITE_ORIGIN}${image.src}` })),
    approval: "missing" as const,
    approvalDetail: "This project is from the website. It is mixed in with new drafts and is not posted from here.",
    postable: false,
  }] : []);
  const facebook = loaded.connections.find((connection) => connection.provider === "FACEBOOK_PAGE");
  if (!facebook) return <p className="rounded-xl bg-slate-50 p-4 text-sm">Facebook setup could not be loaded.</p>;
  const otherPosts = loaded.connections.filter((connection) => connection.provider === "INSTAGRAM" || connection.provider === "GOOGLE_BUSINESS");
  const accounts = loaded.connections.flatMap((connection) => {
    if ((connection.provider !== "GOOGLE_ADS" && connection.provider !== "META_ADS") || !connection.externalAccountId || !connection.externalAccountName) return [];
    return [{ provider: connection.provider, id: connection.externalAccountId, name: connection.externalAccountName }];
  });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-teal-900 p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-teal-200">Facebook publishing</p>
        <h2 className="mt-2 text-2xl font-semibold">Post an approved draft to Facebook</h2>
        <p className="mt-2 max-w-xl text-sm text-teal-50">Choose a saved draft and its photos. Instagram and Google Business Profile stay available after Facebook. Ads are separate and are not sent from this post.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/marketing" className="rounded-xl bg-white px-4 py-2 font-semibold text-teal-900">Back to drafts</Link>
          <Link href="/marketing/results" className="rounded-xl border border-teal-200 px-4 py-2">Weekly results</Link>
        </div>
      </section>
      {notice ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notice}</p> : null}
      {loaded.publishMode !== "live" ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Publishing mode is mock. Connected accounts are not sent live posts or ad campaigns until MARKETING_PUBLISH_MODE=live.</p>
      ) : null}
      {demo ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Preview mode is on. Accounts are not saved, and nothing is published.</p>
      ) : !loaded.migrationReady ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">The publishing tables are not in this database yet. Review prisma/migrations/20261016190000_marketing_publishing before applying it locally. Do not apply it to production from this task.</p>
      ) : null}
      <ConnectionCard connection={facebook} />
      {requestedDraftId && !draftChoices.some((draft) => draft.id === requestedDraftId) ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">That saved pack is not available in this workspace.</p>
      ) : null}
      <FacebookPublishScreen key={requestedDraftId || selectedWebsite?.id || "newest"} mode={loaded.publishMode} facebook={facebook} drafts={[...previews, ...websiteDrafts]} initialDraftId={requestedDraftId || selectedWebsite?.id || ""} />
      <WebsiteProjectList projects={website.projects.map((project) => ({ id: project.id, slug: project.slug, jobId: project.jobId, name: project.name, location: project.location, description: project.description, photoCount: project.photoCount, imageUrl: project.images[0] ? `${WEBSITE_ORIGIN}${project.images[0].src}` : null, imageAlt: project.images[0]?.alt }))} featuredId={website.featured?.id} />
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Other posting accounts</h3>
        {otherPosts.map((connection) => <ConnectionCard key={connection.provider} connection={connection} />)}
      </section>
      <details className="rounded-2xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold">Paused ad drafts stay separate</summary>
        <div className="mt-4 space-y-3">
          {loaded.connections.filter((connection) => connection.provider === "GOOGLE_ADS" || connection.provider === "META_ADS").map((connection) => <ConnectionCard key={connection.provider} connection={connection} />)}
          <CampaignDraftForm drafts={draftChoices.map((draft) => ({ id: draft.id, jobId: draft.jobId, jobName: draft.jobName }))} accounts={accounts} initialDraftId={requestedDraftId} />
        </div>
      </details>
    </div>
  );
}
