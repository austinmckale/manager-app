import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadWeeklyReport } from "@/lib/marketing-reporting/load";
import { cronAuthorized, reportSendDecision, reportText, runWeeklyReport } from "@/lib/marketing-reporting/run";
import { reportingWeek } from "@/lib/marketing-reporting/week";
import { isMissingRelation } from "@/lib/publishing/http";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function removeExpiredIngest(now: Date) {
  try {
    const rows = await prisma.marketingIngestMedia.findMany({
      where: { removedAt: null, expiresAt: { lt: now } },
      take: 50,
      select: { id: true, publicPath: true },
    });
    const paths = rows.filter((row) => row.publicPath.startsWith("marketing-ingest/")).map((row) => row.publicPath);
    if (paths.length) await supabaseAdmin.storage.from("site-public").remove(paths);
    if (rows.length) {
      await prisma.marketingIngestMedia.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { removedAt: now } });
    }
    return rows.length;
  } catch (error) {
    if (isMissingRelation(error)) return 0;
    return 0;
  }
}

async function run(request: Request) {
  const url = new URL(request.url);
  if (!cronAuthorized(request.headers.get("authorization"), url.searchParams.get("secret"), process.env.CRON_SECRET ?? "")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const week = reportingWeek(now);
  const removedIngest = await removeExpiredIngest(now);
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const decision = reportSendDecision(process.env);
  const results = [];
  for (const org of orgs) {
    const result = await runWeeklyReport({
      orgId: org.id,
      weekStartIso: week.start.toISOString(),
      now,
      decision,
      build: () => loadWeeklyReport(org.id, now),
      store: {
        async find(orgId, weekStartIso) {
          const row = await prisma.marketingReportRun.findUnique({
            where: { orgId_weekStart: { orgId, weekStart: new Date(weekStartIso) } },
          });
          if (!row) return null;
          return { preview: row.preview as never, sendStatus: row.sendStatus };
        },
        async create(row) {
          try {
            await prisma.marketingReportRun.create({
              data: {
                orgId: row.orgId,
                weekStart: new Date(row.weekStartIso),
                preview: row.preview,
                sendStatus: row.sendStatus,
                recipient: row.recipient,
                channel: row.channel,
                sentAt: row.sentAt ? new Date(row.sentAt) : null,
              },
            });
            return "created";
          } catch (error) {
            if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") return "conflict";
            if (isMissingRelation(error)) return "conflict";
            throw error;
          }
        },
        async markSent(orgId, weekStartIso, sendStatus, sentAt) {
          await prisma.marketingReportRun.update({
            where: { orgId_weekStart: { orgId, weekStart: new Date(weekStartIso) } },
            data: { sendStatus, sentAt: sentAt ? new Date(sentAt) : null },
          });
        },
      },
      deliver: decision.send ? deliverReport : undefined,
    });
    results.push({ orgId: org.id, deduped: result.deduped, sent: result.sent, sendStatus: result.sendStatus });
  }
  return NextResponse.json({
    ok: true,
    period: week.label,
    sending: decision.send ? "configured" : "disabled",
    removedIngest,
    results,
  });
}

async function deliverReport(report: Parameters<typeof reportText>[0]) {
  if (!reportSendDecision(process.env).send) return { sent: false };
  const channel = process.env.MARKETING_REPORT_CHANNEL?.trim().toLowerCase();
  if (channel === "email") return { sent: false };
  const webhook = process.env.MARKETING_REPORT_DISCORD_WEBHOOK_URL?.trim();
  if (channel !== "discord" || !webhook) return { sent: false };
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: reportText(report).slice(0, 1800) }),
  });
  return { sent: response.ok };
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
