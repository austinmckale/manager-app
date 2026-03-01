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

function taskStatusLabel(status: TaskStatus) {
  if (status === TaskStatus.IN_PROGRESS) return "In Progress";
  if (status === TaskStatus.BLOCKED) return "Blocked";
  return "Todo";
}

function buildTasksText(
  tasks: Array<{
    title: string;
    status: TaskStatus;
    dueDate: Date | null;
    notes: string | null;
    assignee: { fullName: string } | null;
  }>,
) {
  if (tasks.length === 0) return [];

  const lines: string[] = ["Tasks:"];
  const shownTasks = tasks.slice(0, 4);
  for (const task of shownTasks) {
    const due = task.dueDate ? `, due ${format(task.dueDate, "MMM d")}` : "";
    const assignee = task.assignee?.fullName ? `, ${task.assignee.fullName}` : "";
    const notes = truncateText(task.notes, 100);
    lines.push(`- [${taskStatusLabel(task.status)}] ${task.title}${assignee}${due}${notes ? ` | ${notes}` : ""}`);
  }
  if (tasks.length > shownTasks.length) {
    lines.push(`- +${tasks.length - shownTasks.length} more open task(s)`);
  }

  return lines;
}

function buildCrewText(assignments: Array<{ user: { fullName: string } }>) {
  const names = [...new Set(assignments.map((assignment) => assignment.user.fullName.trim()).filter(Boolean))];
  if (names.length === 0) return "Unassigned";
  return names.join(", ");
}

function buildEventBlock(
  index: number,
  event: {
    startAt: Date;
    endAt: Date;
    notes: string | null;
    job: {
      jobName: string;
      address: string;
      customer: { name: string; notes: string | null };
      assignments: Array<{ user: { fullName: string } }>;
      tasks: Array<{
        title: string;
        status: TaskStatus;
        dueDate: Date | null;
        notes: string | null;
        assignee: { fullName: string } | null;
      }>;
      leads: Array<{ notes: string | null }>;
    };
  },
) {
  const scheduleWindow = `${format(event.startAt, "h:mm a")} - ${format(event.endAt, "h:mm a")}`;
  const crewText = buildCrewText(event.job.assignments);
  const eventNotes = truncateText(event.notes, 140);
  const customerNotes = truncateText(event.job.customer.notes, 120);
  const leadNotes = truncateText(event.job.leads[0]?.notes ?? "", 120);
  const tasksText = buildTasksText(event.job.tasks);

  const lines: string[] = [];
  lines.push(`${index + 1}) ${scheduleWindow} | ${event.job.jobName}`);
  lines.push(`Client: ${event.job.customer.name}`);
  lines.push(`Location: ${event.job.address}`);
  lines.push(`Crew: ${crewText}`);
  if (eventNotes) lines.push(`Schedule details: ${eventNotes}`);
  if (customerNotes) lines.push(`Client notes: ${customerNotes}`);
  if (leadNotes) lines.push(`Lead notes: ${leadNotes}`);
  lines.push(...tasksText);

  return lines.join("\n");
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
          tasks: {
            where: { status: { in: OPEN_TASK_STATUSES } },
            orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
            take: 6,
            select: {
              title: true,
              status: true,
              dueDate: true,
              notes: true,
              assignee: { select: { fullName: true } },
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

  const header = `Crew Schedule Digest - ${format(digestDate, "EEE, MMM d, yyyy")}`;
  if (events.length === 0) {
    await postDiscordMessages(webhookUrl, [`${header}\n\nNo scheduled visits today.`]);
    return { sent: true, eventCount: 0, messageCount: 1 };
  }

  const eventBlocks = events.map((event, index) => buildEventBlock(index, event));
  const messages = splitIntoDiscordMessages(header, eventBlocks);
  await postDiscordMessages(webhookUrl, messages);
  return { sent: true, eventCount: events.length, messageCount: messages.length };
}
