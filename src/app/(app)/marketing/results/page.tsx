import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { loadWeeklyReport } from "@/lib/marketing-reporting/load";
import { buildWeeklyReport, metricDisplay, type ReportMetric } from "@/lib/marketing-reporting/report";
import { reportingWeek } from "@/lib/marketing-reporting/week";
import { RetryDeliveryButton } from "@/components/publishing/retry-delivery-button";
import { prisma } from "@/lib/prisma";
import { isMissingRelation } from "@/lib/publishing/http";

function MetricBlock({ metric }: { metric: ReportMetric }) {
  const display = metricDisplay(metric);
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{metric.label}</p>
      <p className={`mt-2 text-2xl font-semibold ${metric.kind === "missing" ? "text-slate-500" : "text-teal-800"}`}>{display}</p>
      <p className="mt-2 text-xs text-slate-500">{metric.source}</p>
    </div>
  );
}

export default async function MarketingResultsPage() {
  const auth = await requireAuth();
  const denied = marketingAccessDenied(auth.role);
  if (denied) return <p className="rounded-xl bg-slate-50 p-4 text-sm">{denied}</p>;
  const now = new Date();
  const week = reportingWeek(now);
  const demo = isDemoMode();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weeklyPromise = demo ? Promise.resolve([0, 0, 0] as const) : Promise.all([
    prisma.fileAsset.count({ where: { job: { orgId: auth.orgId }, type: "PHOTO", createdAt: { gte: weekStart } } }),
    prisma.fileAsset.count({ where: { job: { orgId: auth.orgId }, type: "PHOTO", isPortfolio: true, updatedAt: { gte: weekStart } } }),
    prisma.lead.count({ where: { orgId: auth.orgId, utmCampaign: { startsWith: "job-" }, createdAt: { gte: weekStart } } }),
  ]);
  const [report, savedAt] = demo
    ? [buildWeeklyReport({
        generatedAt: now,
        period: week,
        deliveriesAvailable: false,
        deliveries: [],
        quoteSubmissions: null,
        attributableQuoteSubmissions: null,
        loggedCalls: null,
        bookedJobs: null,
        providerMetrics: [],
        adSpend: { state: "not_connected", source: "Connect an ad account before spend can be read." },
        previewMode: true,
      }), null] as const
    : await Promise.all([loadWeeklyReport(auth.orgId, now), savedReportTime(auth.orgId, week.start)]);
  const weekly = await weeklyPromise;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-teal-900 p-5 text-white">
        <p className="text-xs uppercase tracking-widest text-teal-200">Weekly results</p>
        <h2 className="mt-2 text-2xl font-semibold">{report.period.label}</h2>
        <p className="mt-2 text-sm text-teal-50">Last refresh {new Date(report.generatedAt).toLocaleString()}. {report.source}</p>
        {savedAt ? <p className="mt-1 text-sm text-teal-100">Saved weekly snapshot {new Date(savedAt).toLocaleString()}.</p> : <p className="mt-1 text-sm text-teal-100">No saved weekly snapshot for this period yet.</p>}
        <Link href="/marketing/buffer" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950">Buffer</Link>
      </section>
      <section aria-label="Past seven days" className="rounded-2xl border border-slate-300 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Past 7 days</h3>
        <div className="mt-3 grid grid-cols-3 gap-3">{([[weekly[0], "Photos uploaded"], [weekly[1], "Website photos updated"], [weekly[2], "Leads from tracked packs"]] as const).map(([value, label]) => <div key={label}><p className="text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-800">{label}</p></div>)}</div>
        <p className="mt-3 text-xs text-slate-800">{demo ? "Preview mode does not read the database, so these counts are empty." : "Tracked leads are quote requests with a marketing-pack campaign link. Website photo updates are not social posts. Ad spend, phone calls and booked revenue are not included."}</p>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <MetricBlock metric={report.quoteSubmissions} />
        <MetricBlock metric={report.attributableQuoteSubmissions} />
        <MetricBlock metric={report.phoneClickEvents} />
        <MetricBlock metric={report.loggedCalls} />
        <MetricBlock metric={report.bookedJobs} />
        <MetricBlock metric={report.adSpend} />
        <MetricBlock metric={report.costPerQualifiedLead} />
        {report.providerMetrics.map((metric) => <MetricBlock key={metric.label} metric={metric} />)}
      </section>
      <section className="rounded-2xl border border-slate-200 p-4">
        <h3 className="font-semibold">Published posts</h3>
        {report.publishedPosts.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {report.publishedPosts.map((post) => (
              <li key={`${post.destination}-${post.providerPostId}`}>{post.destination} · {post.providerPostId} · {post.publishedAt ? new Date(post.publishedAt).toLocaleString() : "time unavailable"}</li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-600">No live posts were recorded in this period.</p>}
        {report.mockDeliveries.length ? <p className="mt-3 text-sm text-slate-600">{report.mockDeliveries.length} mock {report.mockDeliveries.length === 1 ? "delivery was" : "deliveries were"} saved locally and not sent.</p> : null}
      </section>
      <section className="rounded-2xl border border-slate-200 p-4">
        <h3 className="font-semibold">Failed deliveries</h3>
        {report.failedDeliveries.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {report.failedDeliveries.map((delivery, index) => (
              <li key={`${delivery.destination}-${delivery.jobId}-${index}`} className="flex items-center justify-between gap-3">
                <span>{delivery.destination} · attempt {delivery.attemptCount} · {delivery.error ?? "Failed"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-600">No failed deliveries in this period.</p>}
        <FailedRetries orgId={auth.orgId} demo={demo} start={report.period.start} end={report.period.end} />
      </section>
      <ul className="space-y-1 text-xs text-slate-500">
        {report.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </div>
  );
}

async function savedReportTime(orgId: string, weekStart: Date) {
  try {
    const saved = await prisma.marketingReportRun.findFirst({
      where: { orgId, weekStart },
      select: { createdAt: true },
    });
    return saved?.createdAt.toISOString() ?? null;
  } catch (error) {
    if (!isMissingRelation(error)) return null;
    return null;
  }
}

async function FailedRetries({ orgId, demo, start, end }: { orgId: string; demo: boolean; start: string; end: string }) {
  if (demo) return null;
  const rows = await failedDeliveries(orgId, start, end);
  if (!rows.length) return null;
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3">
          <span>{row.destination}</span>
          <RetryDeliveryButton deliveryId={row.id} />
        </li>
      ))}
    </ul>
  );
}

async function failedDeliveries(orgId: string, start: string, end: string) {
  try {
    return await prisma.marketingDelivery.findMany({
      where: { orgId, status: "FAILED", createdAt: { gte: new Date(start), lt: new Date(end) } },
      select: { id: true, destination: true },
      take: 20,
    });
  } catch (error) {
    if (isMissingRelation(error)) return [];
    return [];
  }
}
