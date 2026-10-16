import Link from "next/link";
import { notFound } from "next/navigation";
import { readSharedScorecard } from "@/lib/shared-scorecards";
import { CampaignScorecardView } from "@/components/campaign-scorecard-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your marketing results | RHI Pros", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function SharedResultsPage({ params }: { params: Promise<{ token: string; reportId: string }> }) {
  const { token, reportId } = await params;
  const report = await readSharedScorecard(token, reportId);
  if (!report) notFound();
  return <main className="mx-auto max-w-4xl space-y-5 px-5 py-7"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros · Marketing results</p><CampaignScorecardView report={report} /><Link href={`/send-photos/${encodeURIComponent(token)}/reports`} className="inline-block text-sm text-[#b4411b] underline">All your reports</Link></main>;
}
