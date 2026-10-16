import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { draftChoice, recentDrafts } from "@/lib/publishing/connection-store";
import { presentedConnections } from "@/lib/publishing/execute";
import { CampaignDraftForm } from "@/components/publishing/campaign-draft-form";
import { ConnectionCard } from "@/components/publishing/connection-card";
import { PublishForm } from "@/components/publishing/publish-form";
import type { MarketingProviderName } from "@/lib/publishing/types";

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

export default async function MarketingConnectionsPage({ searchParams }: { searchParams: Promise<{ result?: string; draftId?: string }> }) {
  const auth = await requireAuth();
  const denied = marketingAccessDenied(auth.role);
  if (denied) return <p className="rounded-xl bg-slate-50 p-4 text-sm">{denied}</p>;
  const params = await searchParams;
  const notice = params.result ? RESULT_COPY[params.result] : "";
  const requestedDraftId = /^[0-9a-f-]{36}$/i.test(params.draftId ?? "") ? params.draftId : "";
  const demo = isDemoMode();
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
  const accounts = loaded.connections.flatMap((connection) => {
    if ((connection.provider !== "GOOGLE_ADS" && connection.provider !== "META_ADS") || !connection.externalAccountId || !connection.externalAccountName) return [];
    return [{ provider: connection.provider, id: connection.externalAccountId, name: connection.externalAccountName }];
  });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-teal-900 p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-teal-200">Marketing connections</p>
        <h2 className="mt-2 text-2xl font-semibold">Connect the accounts you post from</h2>
        <p className="mt-2 max-w-xl text-sm text-teal-50">Facebook Pages, Instagram professional accounts, and Google Business Profile locations can be posted to directly. Google Ads and Meta Ads stay as approved drafts until you create a paused campaign.</p>
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
      <div className="grid gap-3">
        {loaded.connections.map((connection) => (
          <ConnectionCard key={connection.provider} connection={connection} />
        ))}
      </div>
      {requestedDraftId && !draftChoices.some((draft) => draft.id === requestedDraftId) ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">That saved pack is not available in this workspace.</p>
      ) : null}
      <PublishForm drafts={draftChoices} initialDraftId={requestedDraftId} />
      <CampaignDraftForm drafts={draftChoices.map((draft) => ({ id: draft.id, jobId: draft.jobId, jobName: draft.jobName }))} accounts={accounts} initialDraftId={requestedDraftId} />
    </div>
  );
}
