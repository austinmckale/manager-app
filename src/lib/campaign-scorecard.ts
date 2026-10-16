import { z } from "zod";

export const SCORECARD_SAVED = "marketing.scorecard.saved";
export const SCORECARD_SHARED = "marketing.scorecard.shared";
const count = z.number().int().min(0).max(1e9).nullable();
const money = z.number().min(0).max(1e9).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Use a valid calendar date.");
export const campaignRowSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(120), platform: z.enum(["Meta Ads", "Google Ads"]),
  campaignId: z.string().trim().min(1).max(100), source: z.string().trim().min(3).max(250),
  attribution: z.string().trim().min(3).max(150), accountTimeZone: z.string().trim().min(3).max(80),
  spend: money, impressions: count, clicks: count, platformConversions: z.number().min(0).max(1e9).nullable(),
  inquiries: count, qualifiedLeads: count, estimates: count, bookedJobs: count, collectedRevenue: money,
  targetCpql: z.number().positive().max(1e6).nullable(),
}).refine((row) => row.inquiries === null || row.qualifiedLeads === null || row.qualifiedLeads <= row.inquiries, { message: "Qualified leads cannot exceed the verified inquiries in the same cohort.", path: ["qualifiedLeads"] });
export const scorecardSchema = z.object({
  periodStart: date, periodEnd: date, dataAsOf: z.string().datetime(),
  currency: z.literal("USD"), qualification: z.string().trim().min(10).max(800),
  deduplicated: z.boolean(), summary: z.string().trim().max(3000), nextSteps: z.string().trim().max(3000),
  campaigns: z.array(campaignRowSchema).min(1).max(25),
}).refine((report) => report.periodStart <= report.periodEnd, { message: "End date must be on or after start date.", path: ["periodEnd"] })
  .refine((report) => new Set(report.campaigns.map((row) => `${row.platform}:${row.campaignId}`)).size === report.campaigns.length, { message: "Enter each platform campaign only once per report.", path: ["campaigns"] });
export type CampaignRow = z.infer<typeof campaignRowSchema>;
export type CampaignScorecard = z.infer<typeof scorecardSchema>;
export function campaignMetrics(row: CampaignRow) {
  return {
    ctr: row.impressions && row.clicks !== null ? row.clicks / row.impressions * 100 : null,
    cpc: row.clicks && row.spend !== null ? row.spend / row.clicks : null,
    cpql: row.qualifiedLeads && row.spend !== null ? row.spend / row.qualifiedLeads : null,
    collectedRoas: row.spend && row.collectedRevenue !== null ? row.collectedRevenue / row.spend : null,
  };
}
function completeSum(rows: CampaignRow[], field: "spend" | "inquiries" | "qualifiedLeads" | "bookedJobs" | "collectedRevenue") {
  return rows.every((row) => row[field] !== null) ? rows.reduce((sum, row) => sum + (row[field] ?? 0), 0) : null;
}
export function scorecardTotals(report: CampaignScorecard) {
  const spend = completeSum(report.campaigns, "spend");
  const qualifiedLeads = report.deduplicated ? completeSum(report.campaigns, "qualifiedLeads") : null;
  const collectedRevenue = report.deduplicated ? completeSum(report.campaigns, "collectedRevenue") : null;
  return {
    spend, qualifiedLeads, collectedRevenue,
    inquiries: report.deduplicated ? completeSum(report.campaigns, "inquiries") : null,
    bookedJobs: report.deduplicated ? completeSum(report.campaigns, "bookedJobs") : null,
    cpql: spend !== null && qualifiedLeads ? spend / qualifiedLeads : null,
    collectedRoas: spend && collectedRevenue !== null ? collectedRevenue / spend : null,
  };
}
export function campaignDecision(row: CampaignRow) {
  const { cpql } = campaignMetrics(row);
  if (row.spend === null || row.qualifiedLeads === null) return "Complete spend and qualified-lead tracking.";
  if (row.spend === 0) return "No recorded spend. Confirm campaign delivery before evaluating.";
  if (row.qualifiedLeads === 0) return "Spend recorded with no qualified leads. Review targeting, offer and follow-up before scaling.";
  if (row.targetCpql === null) return "Set a cost-per-qualified-lead target before judging performance.";
  return cpql !== null && cpql <= row.targetCpql ? "Within the stated cost-per-qualified-lead target. Check lead quality and sample size before scaling." : "Above the stated cost-per-qualified-lead target. Review the campaign before increasing spend.";
}
export function moneyText(value: number | null) { return value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
export function scorecardText(report: CampaignScorecard) {
  const totals = scorecardTotals(report);
  return [
    `RHI Pros marketing results · ${report.periodStart} to ${report.periodEnd}`,
    `Data as of ${report.dataAsOf}. USD. Manually entered; sources listed below.`,
    `Ad spend: ${moneyText(totals.spend)}`,
    `Verified inquiries: ${totals.inquiries ?? "Unavailable"}; qualified leads: ${totals.qualifiedLeads ?? "Unavailable"}; booked jobs: ${totals.bookedJobs ?? "Unavailable"}`,
    `Cost per qualified lead: ${moneyText(totals.cpql)}`,
    `Collected revenue attributed to these campaigns: ${moneyText(totals.collectedRevenue)}; collected-revenue ROAS: ${totals.collectedRoas === null ? "Unavailable" : `${totals.collectedRoas.toFixed(2)}x`}`,
    `Qualified means: ${report.qualification}`,
    ...report.campaigns.map((row) => `\n${row.name} (${row.platform}, ${row.campaignId}): spend ${moneyText(row.spend)}, inquiries ${row.inquiries ?? "Unavailable"}, qualified leads ${row.qualifiedLeads ?? "Unavailable"}, booked jobs ${row.bookedJobs ?? "Unavailable"}, CPQL ${moneyText(campaignMetrics(row).cpql)}.\nSource: ${row.source}. Attribution: ${row.attribution}. Account timezone: ${row.accountTimeZone}.\n${campaignDecision(row)}`),
    `\nWhat happened: ${report.summary || "Not supplied."}`, `Next steps: ${report.nextSteps || "Not supplied."}`,
    "Platform conversions may overlap; they are not added together. Cross-campaign business totals require confirmation that every lead, job and receipt is assigned once. Collected-revenue ROAS is not profit. Outcomes may arrive after the ad reporting period.",
  ].join("\n");
}
export function scorecardCsv(report: CampaignScorecard) {
  const cell = (value: unknown) => { let text = value === null ? "" : String(value); if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  const headings = ["Period start", "Period end", "Data as of", "Platform", "Campaign ID", "Campaign", "Spend USD", "Impressions", "Clicks", "Platform conversions (not unique leads)", "Verified inquiries", "Qualified leads", "Estimates", "Booked jobs", "Collected revenue USD", "CPQL USD", "CTR percent", "CPC USD", "Collected ROAS", "Target CPQL USD", "Source", "Attribution", "Account timezone"];
  return [headings.map(cell).join(","), ...report.campaigns.map((row) => { const metric = campaignMetrics(row); return [report.periodStart, report.periodEnd, report.dataAsOf, row.platform, row.campaignId, row.name, row.spend, row.impressions, row.clicks, row.platformConversions, row.inquiries, row.qualifiedLeads, row.estimates, row.bookedJobs, row.collectedRevenue, metric.cpql, metric.ctr, metric.cpc, metric.collectedRoas, row.targetCpql, row.source, row.attribution, row.accountTimeZone].map(cell).join(","); })].join("\r\n");
}
