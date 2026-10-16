import { JobStatus, LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildWeeklyReport, type ReportMetric } from "@/lib/marketing-reporting/report";
import { reportingWeek } from "@/lib/marketing-reporting/week";
import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { readConnections, toSecret } from "@/lib/publishing/connection-store";
import { isMissingRelation } from "@/lib/publishing/http";
import type { MarketingProviderName } from "@/lib/publishing/types";

const ORGANIC: MarketingProviderName[] = ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS"];

export async function loadWeeklyReport(orgId: string, now = new Date()) {
  const period = reportingWeek(now);
  const env = readPublishingEnv(process.env);
  const [quoteSubmissions, attributableQuoteSubmissions, loggedCalls, bookedJobs, deliveries, connections] = await Promise.all([
    countOrNull(() =>
      prisma.lead.count({
        where: { orgId, source: LeadSource.WEBSITE_FORM, createdAt: { gte: period.start, lt: period.end } },
      }),
    ),
    countOrNull(() =>
      prisma.lead.count({
        where: {
          orgId,
          source: LeadSource.WEBSITE_FORM,
          createdAt: { gte: period.start, lt: period.end },
          OR: [{ utmSource: { not: null } }, { utmCampaign: { not: null } }],
        },
      }),
    ),
    countOrNull(() =>
      prisma.lead.count({
        where: { orgId, source: LeadSource.PHONE_CALL, createdAt: { gte: period.start, lt: period.end } },
      }),
    ),
    countOrNull(async () => {
      const events = await prisma.jobScheduleEvent.findMany({
        where: {
          orgId,
          startAt: { lt: period.end },
          endAt: { gt: period.start },
          job: { status: { in: [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.COMPLETED, JobStatus.PAID] } },
        },
        select: { jobId: true },
        distinct: ["jobId"],
      });
      return events.length;
    }),
    loadDeliveries(orgId, period.start, period.end),
    readConnections(orgId),
  ]);

  const providerMetrics: ReportMetric[] = ORGANIC.map((provider) => {
    const row = connections?.find((item) => item.provider === provider) ?? null;
    const presented = presentConnection(provider, row ? toSecret(row) : null, env, now);
    if (presented.status !== "CONNECTED") {
      return { kind: "missing", label: `${presented.label} metrics`, state: "not_connected", source: presented.note };
    }
    if (env.publishMode !== "live") {
      return {
        kind: "missing",
        label: `${presented.label} metrics`,
        state: "unavailable",
        source: "Platform metrics are not read while MARKETING_PUBLISH_MODE is mock.",
      };
    }
    return {
      kind: "missing",
      label: `${presented.label} metrics`,
      state: "unavailable",
      source: "The connected account did not return metrics for this report.",
    };
  });

  const ads = (["GOOGLE_ADS", "META_ADS"] as const).map((provider) => {
    const row = connections?.find((item) => item.provider === provider) ?? null;
    return presentConnection(provider, row ? toSecret(row) : null, env, now);
  });
  const adsConnected = ads.some((item) => item.status === "CONNECTED");
  const adSpend = !adsConnected
    ? { state: "not_connected" as const, source: ads.map((item) => item.note).join(" ") }
    : env.publishMode !== "live"
      ? { state: "unavailable" as const, source: "Ad spend is not read while MARKETING_PUBLISH_MODE is mock." }
      : { state: "unavailable" as const, source: "The ad account did not return spend for this report." };

  return buildWeeklyReport({
    generatedAt: now,
    period,
    deliveriesAvailable: deliveries !== null,
    deliveries: deliveries ?? [],
    quoteSubmissions,
    attributableQuoteSubmissions,
    loggedCalls,
    bookedJobs,
    providerMetrics,
    adSpend,
  });
}

async function loadDeliveries(orgId: string, start: Date, end: Date) {
  try {
    const rows = await prisma.marketingDelivery.findMany({
      where: { orgId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => ({
      destination: row.destination,
      status: row.status,
      providerPostId: row.providerPostId,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      jobId: row.jobId,
      lastError: row.lastError,
      attemptCount: row.attemptCount,
    }));
  } catch (error) {
    if (isMissingRelation(error)) return null;
    return null;
  }
}

async function countOrNull(load: () => Promise<number>) {
  try {
    return await load();
  } catch {
    return null;
  }
}
