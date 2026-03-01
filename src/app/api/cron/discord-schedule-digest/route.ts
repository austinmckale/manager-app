import { NextResponse } from "next/server";
import { sendDiscordScheduleDigestForOrg, shouldSendDigestNow } from "@/lib/discord-schedule-digest";
import { prisma } from "@/lib/prisma";

function isAuthorized(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function runDigestDispatch(now: Date) {
  const settingsRows = await prisma.organizationSetting.findMany({
    where: {
      discordScheduleDigestEnabled: true,
      discordScheduleDigestWebhookUrl: { not: null },
    },
    select: {
      orgId: true,
      discordScheduleDigestWebhookUrl: true,
      discordScheduleDigestTime: true,
      discordScheduleDigestLastSentAt: true,
    },
  });

  const result = {
    scanned: settingsRows.length,
    sent: 0,
    skippedNotDue: 0,
    skippedMissingWebhook: 0,
    failed: 0,
  };

  for (const settings of settingsRows) {
    const webhookUrl = settings.discordScheduleDigestWebhookUrl?.trim() ?? "";
    if (!webhookUrl) {
      result.skippedMissingWebhook += 1;
      continue;
    }

    const due = shouldSendDigestNow({
      now,
      digestTime: settings.discordScheduleDigestTime,
      lastSentAt: settings.discordScheduleDigestLastSentAt,
    });
    if (!due) {
      result.skippedNotDue += 1;
      continue;
    }

    try {
      await sendDiscordScheduleDigestForOrg({
        orgId: settings.orgId,
        webhookUrl,
        forDate: now,
      });

      await prisma.organizationSetting.update({
        where: { orgId: settings.orgId },
        data: { discordScheduleDigestLastSentAt: now },
      });
      result.sent += 1;
    } catch (error) {
      console.error("discord-schedule-digest failed", {
        orgId: settings.orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  }

  return result;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const result = await runDigestDispatch(now);
  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    ...result,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
