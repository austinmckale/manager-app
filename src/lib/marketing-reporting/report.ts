import { isMockPostId } from "@/lib/publishing/deliver";

export type ReportMetric =
  | { kind: "count"; label: string; value: number; source: string }
  | { kind: "money"; label: string; amount: number; currency: string; source: string }
  | { kind: "missing"; label: string; state: "not_connected" | "unavailable"; source: string };

export type WeeklyMarketingReport = {
  period: { start: string; end: string; label: string };
  generatedAt: string;
  source: string;
  publishedPosts: Array<{ destination: string; providerPostId: string; publishedAt: string | null; jobId: string }>;
  mockDeliveries: Array<{ destination: string; jobId: string }>;
  failedDeliveries: Array<{ destination: string; jobId: string; error: string | null; attemptCount: number }>;
  quoteSubmissions: ReportMetric;
  attributableQuoteSubmissions: ReportMetric;
  phoneClickEvents: ReportMetric;
  loggedCalls: ReportMetric;
  bookedJobs: ReportMetric;
  providerMetrics: ReportMetric[];
  adSpend: ReportMetric;
  costPerQualifiedLead: ReportMetric;
  notes: string[];
};

export function metricDisplay(metric: ReportMetric) {
  if (metric.kind === "missing") return metric.state === "not_connected" ? "Not connected" : "Unavailable";
  if (metric.kind === "money") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: metric.currency }).format(metric.amount);
  }
  return String(metric.value);
}

function countOrMissing(label: string, value: number | null, source: string, missingSource: string): ReportMetric {
  if (value === null) return { kind: "missing", label, state: "unavailable", source: missingSource };
  return { kind: "count", label, value, source };
}

export function buildWeeklyReport(input: {
  generatedAt: Date;
  period: { start: Date; end: Date; label: string };
  deliveriesAvailable: boolean;
  deliveries: Array<{
    destination: string;
    status: string;
    providerPostId: string | null;
    publishedAt: string | null;
    jobId: string;
    lastError: string | null;
    attemptCount: number;
  }>;
  quoteSubmissions: number | null;
  attributableQuoteSubmissions: number | null;
  loggedCalls: number | null;
  bookedJobs: number | null;
  providerMetrics: ReportMetric[];
  adSpend: { state: "value"; amount: number; currency: string; source: string } | { state: "not_connected" | "unavailable"; source: string };
  previewMode?: boolean;
}): WeeklyMarketingReport {
  const recordSource = input.previewMode ? "Preview mode does not read the lead database." : null;
  const publishedPosts = input.deliveriesAvailable
    ? input.deliveries.flatMap((delivery) => {
        if (delivery.status !== "PUBLISHED" || !delivery.providerPostId || isMockPostId(delivery.providerPostId)) return [];
        return [{ destination: delivery.destination, providerPostId: delivery.providerPostId, publishedAt: delivery.publishedAt, jobId: delivery.jobId }];
      })
    : [];
  const mockDeliveries = input.deliveriesAvailable
    ? input.deliveries.flatMap((delivery) => (isMockPostId(delivery.providerPostId) ? [{ destination: delivery.destination, jobId: delivery.jobId }] : []))
    : [];
  const failedDeliveries = input.deliveriesAvailable
    ? input.deliveries.flatMap((delivery) =>
        delivery.status === "FAILED"
          ? [{ destination: delivery.destination, jobId: delivery.jobId, error: delivery.lastError, attemptCount: delivery.attemptCount }]
          : [],
      )
    : [];

  const adSpend: ReportMetric =
    input.adSpend.state === "value"
      ? { kind: "money", label: "Ad spend", amount: input.adSpend.amount, currency: input.adSpend.currency, source: input.adSpend.source }
      : { kind: "missing", label: "Ad spend", state: input.adSpend.state, source: input.adSpend.source };

  const costPerQualifiedLead: ReportMetric = {
    kind: "missing",
    label: "Cost per qualified lead",
    state: input.adSpend.state === "value" ? "unavailable" : input.adSpend.state,
    source:
      input.adSpend.state === "value"
        ? "Qualified leads are not defined by the ad account, so cost per qualified lead is not calculated."
        : input.adSpend.source,
  };

  return {
    period: { start: input.period.start.toISOString(), end: input.period.end.toISOString(), label: input.period.label },
    generatedAt: input.generatedAt.toISOString(),
    source: "Manager app records. Platform metrics are included only when a connected account returns them.",
    publishedPosts,
    mockDeliveries,
    failedDeliveries,
    quoteSubmissions: countOrMissing(
      "Website quote submissions",
      input.quoteSubmissions,
      "Lead records with source Website form. A quote submission is not revenue.",
      recordSource ?? "Website quote submissions could not be read.",
    ),
    attributableQuoteSubmissions: countOrMissing(
      "Quote submissions with a campaign tag",
      input.attributableQuoteSubmissions,
      "Website form leads that stored a utm source or campaign.",
      recordSource ?? "Campaign-tagged quote submissions could not be read.",
    ),
    phoneClickEvents: {
      kind: "missing",
      label: "Phone-click events",
      state: "unavailable",
      source: "No phone-click event is stored in this app.",
    },
    loggedCalls: countOrMissing(
      "Logged phone calls",
      input.loggedCalls,
      "Lead records with source Phone call. A logged call is not revenue.",
      recordSource ?? "Logged phone calls could not be read.",
    ),
    bookedJobs: countOrMissing(
      "Jobs with scheduled time",
      input.bookedJobs,
      "Jobs scheduled, in progress, completed, or paid that have schedule time in this period. This is not revenue.",
      recordSource ?? "Scheduled jobs could not be read.",
    ),
    providerMetrics: input.deliveriesAvailable
      ? input.providerMetrics
      : [{ kind: "missing", label: "Delivery history", state: "unavailable", source: input.previewMode ? "Preview mode does not read publishing records." : "Publishing tables are not in this database yet." }],
    adSpend,
    costPerQualifiedLead,
    notes: [
      "A lead, call, or scheduled job is not revenue.",
      "Ad spend and cost per qualified lead stay blank until an ad account returns measured spend.",
      "Mock deliveries are local test results and were not sent to a platform.",
    ],
  };
}
