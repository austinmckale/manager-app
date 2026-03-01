import { TaskStatus } from "@prisma/client";
import { endOfDay, format, isSameDay, setHours, setMinutes, setSeconds, startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";

const DISCORD_MESSAGE_LIMIT = 1900;
const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];

function truncateText(value: string | null | undefined, max: number) {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeClockText(value: string, fallback = "06:00") {
  const normalized = value.trim();
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return fallback;
  return `${match[1]}:${match[2]}`;
}

function splitClock(value: string) {
  const normalized = normalizeClockText(value);
  const [hourText, minuteText] = normalized.split(":");
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

function buildCrewText(assignments: Array<{ user: { fullName: string } }>) {
  const names = [...new Set(assignments.map((assignment) => assignment.user.fullName.trim()).filter(Boolean))];
  if (names.length === 0) return "Unassigned";
  return names.join(", ");
}



function splitIntoDiscordMessages(header: string, blocks: string[]) {
  const messages: string[] = [];
  let current = header;

  for (const rawBlock of blocks) {
    const block = rawBlock.length > 1200 ? `${rawBlock.slice(0, 1197)}...` : rawBlock;
    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= DISCORD_MESSAGE_LIMIT) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = `Continued:\n\n${block}`;
  }

  messages.push(current);
  return messages.filter((message) => message.trim().length > 0);
}

async function postDiscordMessages(webhookUrl: string, messages: string[]) {
  for (const content of messages) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Discord webhook failed (${response.status}): ${details || "no response body"}`);
    }
  }
}

export function sanitizeDigestClock(value: string, fallback = "06:00") {
  return normalizeClockText(value, fallback);
}

export function shouldSendDigestNow(params: {
  now: Date;
  digestTime: string;
  lastSentAt: Date | null | undefined;
}) {
  const { hour, minute } = splitClock(params.digestTime);
  const sendAfter = setSeconds(setMinutes(setHours(startOfDay(params.now), hour), minute), 0);
  const alreadySentToday = params.lastSentAt ? isSameDay(params.lastSentAt, params.now) : false;
  return !alreadySentToday && params.now.getTime() >= sendAfter.getTime();
}

export async function sendDiscordScheduleDigestForOrg(params: {
  orgId: string;
  webhookUrl: string;
  forDate?: Date;
}) {
  const webhookUrl = params.webhookUrl.trim();
  if (!webhookUrl) {
    return { sent: false, eventCount: 0, messageCount: 0 };
  }

  const digestDate = params.forDate ?? new Date();
  const dayStart = startOfDay(digestDate);
  const dayEnd = endOfDay(digestDate);

  // 1. Fetch Schedule Events
  const events = await prisma.jobScheduleEvent.findMany({
    where: {
      orgId: params.orgId,
      startAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { startAt: "asc" },
    include: {
      job: {
        select: {
          jobName: true,
          address: true,
          customer: { select: { name: true, notes: true } },
          assignments: {
            select: {
              user: { select: { fullName: true } },
            },
          },
          leads: {
            where: { notes: { not: null } },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { notes: true },
          },
        },
      },
    },
  });

  // 2. Fetch New Leads awaiting contact
  const newLeads = await prisma.lead.findMany({
    where: { orgId: params.orgId, stage: "NEW" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { contactName: true, serviceType: true, source: true },
  });

  // 3. Fetch Overdue Tasks
  const overdueTasks = await prisma.task.findMany({
    where: {
      job: { orgId: params.orgId },
      status: { in: OPEN_TASK_STATUSES },
      dueDate: { lt: dayStart },
    },
    include: {
      job: { select: { jobName: true } },
      assignee: { select: { fullName: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 10,
  });

  const header = `Crew Schedule Digest - ${format(digestDate, "EEE, MMM d, yyyy")}`;
  const blocks: string[] = [];

  // Write Schedule Section
  blocks.push("🗂️ **Schedule Today**");
  if (events.length === 0) {
    blocks.push("**NOT SCHEDULED**\n");
  } else {
    // Re-use existing block builder but strip tasks out of it
    events.forEach((event, index) => {
      const scheduleWindow = `${format(event.startAt, "h:mm a")} - ${format(event.endAt, "h:mm a")}`;
      const crewText = buildCrewText(event.job.assignments);
      const eventNotes = truncateText(event.notes, 140);
      const customerNotes = truncateText(event.job.customer.notes, 120);
      const leadNotes = truncateText(event.job.leads[0]?.notes ?? "", 120);

      const lines: string[] = [];
      lines.push(`\n${index + 1}) ${scheduleWindow} | ${event.job.jobName}`);
      lines.push(`Client: ${event.job.customer.name}`);
      lines.push(`Location: ${event.job.address}`);
      lines.push(`Crew: ${crewText}`);
      if (eventNotes) lines.push(`Schedule details: ${eventNotes}`);
      if (customerNotes) lines.push(`Client notes: ${customerNotes}`);
      if (leadNotes) lines.push(`Lead notes: ${leadNotes}`);
      blocks.push(lines.join("\n"));
    });
    blocks.push("\n");
  }

  // Write New Leads Section
  blocks.push("🚨 **New Leads** (Awaiting Contact)");
  if (newLeads.length === 0) {
    blocks.push("No new leads waiting.\n");
  } else {
    newLeads.forEach((lead) => {
      blocks.push(`- ${lead.contactName} (${lead.serviceType || "Unknown service"}) from ${lead.source.replaceAll("_", " ")}`);
    });
    blocks.push("\n");
  }

  // Write Overdue Tasks Section
  blocks.push("✓ **Overdue Tasks**");
  if (overdueTasks.length === 0) {
    blocks.push("No tasks overdue!");
  } else {
    overdueTasks.forEach((task) => {
      const assignee = task.assignee?.fullName ? ` (${task.assignee.fullName})` : "";
      const due = task.dueDate ? ` - Due ${format(task.dueDate, "MMM d")}` : "";
      blocks.push(`- [${task.job.jobName}] ${task.title}${assignee}${due}`);
    });
  }

  // Chunk blocks into valid Discord message sizes
  const messages = splitIntoDiscordMessages(header, blocks);
  await postDiscordMessages(webhookUrl, messages);

  return { sent: true, eventCount: events.length, messageCount: messages.length };
}

export async function sendDiscordEodDigestForOrg(params: {
  orgId: string;
  webhookUrl: string;
  forDate?: Date;
}) {
  const webhookUrl = params.webhookUrl.trim();
  if (!webhookUrl) return { sent: false, entriesCount: 0, messageCount: 0 };

  const digestDate = params.forDate ?? new Date();
  const dayStart = startOfDay(digestDate);
  const dayEnd = endOfDay(digestDate);

  // 1. Fetch Active Timers (where end is null)
  const activeTimers = await prisma.timeEntry.findMany({
    where: {
      job: { orgId: params.orgId },
      end: null, // Check for active clock-ins
    },
    include: {
      worker: { select: { fullName: true } },
      job: { select: { jobName: true } },
    },
    orderBy: { start: "asc" },
  });

  // 2. Fetch missing receipts (expenses from today where receipt is null)
  const receiptlessExpenses = await prisma.expense.findMany({
    where: {
      job: { orgId: params.orgId },
      date: { gte: dayStart, lte: dayEnd },
      receipt: null,
    },
    include: {
      job: { select: { jobName: true } },
    },
    orderBy: { date: "asc" },
  });

  const header = `EOD Wrap-up Digest - ${format(digestDate, "EEE, MMM d, yyyy")}`;
  const blocks: string[] = [];

  // Write Active Timers Section
  blocks.push("⏰ **Clock-outs**");
  if (activeTimers.length === 0) {
    blocks.push("Everyone is clocked out!\n");
  } else {
    blocks.push("WARNING - The following team members are still clocked in:");
    activeTimers.forEach((entry) => {
      const durationHours = Math.floor((new Date().getTime() - entry.start.getTime()) / (1000 * 60 * 60));
      blocks.push(`- **${entry.worker.fullName}** on ${entry.job.jobName} (Clocked in ${format(entry.start, "h:mm a")} - ${durationHours}h ago)`);
    });
    blocks.push("\n");
  }

  // Write Receipts Section
  blocks.push("🧾 **Receipts & Materials**");
  if (receiptlessExpenses.length === 0) {
    blocks.push("No missing receipts for today's expenses. Great job!\n");
  } else {
    blocks.push("The following expenses need a receipt upload:");
    receiptlessExpenses.forEach((exp) => {
      blocks.push(`- $${Number(exp.amount).toFixed(2)} at ${exp.vendor} for ${exp.job.jobName}`);
    });
    blocks.push("\n");
  }

  // Final reminder note
  blocks.push("*Did you order any materials today that aren't logged yet? Don't forget to add them to the job's Costs tab!*");

  // Chunk blocks into valid Discord message sizes
  const messages = splitIntoDiscordMessages(header, blocks);
  await postDiscordMessages(webhookUrl, messages);

  return { sent: true, entriesCount: activeTimers.length + receiptlessExpenses.length, messageCount: messages.length };
}
