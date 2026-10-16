import { timingSafeEqual } from "node:crypto";
import type { WeeklyMarketingReport } from "@/lib/marketing-reporting/report";

export type ReportSendDecision =
  | { send: false; reason: string }
  | { send: true; recipient: string; channel: "email" | "discord" };

export function reportSendDecision(env: NodeJS.ProcessEnv | {
  MARKETING_REPORT_SENDING?: string;
  MARKETING_REPORT_RECIPIENT?: string;
  MARKETING_REPORT_CHANNEL?: string;
}): ReportSendDecision {
  const recipient = env.MARKETING_REPORT_RECIPIENT?.trim() ?? "";
  const channel = env.MARKETING_REPORT_CHANNEL?.trim().toLowerCase() ?? "";
  const enabled = env.MARKETING_REPORT_SENDING?.trim() === "enabled";
  if (!enabled || !recipient || (channel !== "email" && channel !== "discord")) {
    return {
      send: false,
      reason: "Sending stays off until MARKETING_REPORT_SENDING=enabled, MARKETING_REPORT_RECIPIENT, and MARKETING_REPORT_CHANNEL (email or discord) are all set.",
    };
  }
  return { send: true, recipient, channel };
}

export function cronAuthorized(authorization: string | null, querySecret: string | null, expected: string) {
  const secret = expected.trim();
  if (!secret) return false;
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return safeEqual(bearer, secret) || (querySecret ? safeEqual(querySecret, secret) : false);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export type StoredReport = { preview: WeeklyMarketingReport; sendStatus: string };

export async function runWeeklyReport(options: {
  orgId: string;
  weekStartIso: string;
  store: {
    find: (orgId: string, weekStartIso: string) => Promise<StoredReport | null>;
    create: (row: {
      orgId: string;
      weekStartIso: string;
      preview: WeeklyMarketingReport;
      sendStatus: string;
      recipient: string | null;
      channel: string | null;
      sentAt: string | null;
    }) => Promise<"created" | "conflict">;
    markSent?: (orgId: string, weekStartIso: string, sendStatus: string, sentAt: string | null) => Promise<void>;
  };
  build: () => Promise<WeeklyMarketingReport>;
  decision: ReportSendDecision;
  deliver?: (report: WeeklyMarketingReport, decision: Extract<ReportSendDecision, { send: true }>) => Promise<{ sent: boolean }>;
  now: Date;
}) {
  const existing = await options.store.find(options.orgId, options.weekStartIso);
  if (existing) {
    return { deduped: true, preview: existing.preview, sent: existing.sendStatus === "sent", sendStatus: existing.sendStatus };
  }
  const preview = await options.build();
  const willSend = options.decision.send && Boolean(options.deliver);
  const created = await options.store.create({
    orgId: options.orgId,
    weekStartIso: options.weekStartIso,
    preview,
    sendStatus: "preview_only",
    recipient: options.decision.send ? options.decision.recipient : null,
    channel: options.decision.send ? options.decision.channel : null,
    sentAt: null,
  });
  if (created === "conflict") {
    const winner = await options.store.find(options.orgId, options.weekStartIso);
    return {
      deduped: true,
      preview: winner?.preview ?? preview,
      sent: winner?.sendStatus === "sent",
      sendStatus: winner?.sendStatus ?? "preview_only",
    };
  }
  if (!willSend || !options.decision.send || !options.deliver) {
    return { deduped: false, preview, sent: false, sendStatus: "preview_only" };
  }
  const result = await options.deliver(preview, options.decision);
  const sendStatus = result.sent ? "sent" : "not_sent";
  await options.store.markSent?.(options.orgId, options.weekStartIso, sendStatus, result.sent ? options.now.toISOString() : null);
  return { deduped: false, preview, sent: result.sent, sendStatus };
}

export function reportText(report: WeeklyMarketingReport) {
  return [
    `RHI Pros marketing results · ${report.period.label}`,
    `Generated ${report.generatedAt}`,
    report.source,
    "Leads and scheduled jobs in this note are not revenue.",
  ].join("\n");
}
