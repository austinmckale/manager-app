import { endOfDay, endOfWeek, isAfter, isBefore, isSameDay, startOfDay, startOfWeek, subHours } from "date-fns";
import { notFound } from "next/navigation";
import { JobStatus, LeadStage, Role } from "@prisma/client";
import {
  demoCustomers,
  demoJobAssignments,
  demoJobs,
  demoScheduleEvents,
  demoTasks,
  demoUsers,
  getDemoDeletedScheduleEventIds,
  listDemoRuntimeAssignments,
  listDemoRuntimeUsers,
  listDemoRuntimeScheduleEvents,
  isDemoMode,
} from "@/lib/demo";
import { prisma } from "@/lib/prisma";

function getMergedDemoAssignments() {
  const runtime = listDemoRuntimeAssignments();
  const merged = [...demoJobAssignments];
  const keys = new Set(merged.map((item) => `${item.jobId}:${item.userId}`));

  for (const item of runtime) {
    const key = `${item.jobId}:${item.userId}`;
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(item);
  }
  return merged;
}

function getMergedDemoScheduleEvents() {
  const deleted = new Set(getDemoDeletedScheduleEventIds());
  return [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()]
    .filter((e) => !deleted.has(e.id))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export async function getOrgUsers(orgId: string) {
  if (isDemoMode()) return listDemoRuntimeUsers().filter((user) => user.isActive) as never[];

  return prisma.userProfile.findMany({
    where: { orgId, isActive: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getCustomers(orgId: string) {
  if (isDemoMode()) return demoCustomers as never[];

  return prisma.customer.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getJobs(params: {
  orgId: string;
  role: Role;
  userId: string;
  status?: string;
  q?: string;
  view?: "today" | "week" | "all";
}) {
  const view = params.view ?? "all";
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  if (isDemoMode()) {
    const assignments = getMergedDemoAssignments();
    const scheduleEvents = getMergedDemoScheduleEvents();

    const filtered = demoJobs.filter((job) => {
      const statusOk = !params.status || params.status === "ALL" || job.status === params.status;
      const q = params.q?.toLowerCase() ?? "";
      const textOk = !q || job.jobName.toLowerCase().includes(q) || job.address.toLowerCase().includes(q);
      const assignmentOk = true;

      const jobEvents = scheduleEvents.filter((event) => event.jobId === job.id);
      const ongoingStatuses: JobStatus[] = [
        JobStatus.ESTIMATE,
        JobStatus.SCHEDULED,
        JobStatus.IN_PROGRESS,
        JobStatus.ON_HOLD,
      ];
      const isOngoing = ongoingStatuses.includes(job.status);
      const dateOk =
        view === "all"
          ? true
          : isOngoing
            ? true
            : view === "today"
              ? jobEvents.some((event) => isSameDay(event.startAt, new Date()))
              : jobEvents.some(
                  (event) =>
                    (isAfter(event.startAt, weekStart) || isSameDay(event.startAt, weekStart)) &&
                    (isBefore(event.startAt, weekEnd) || isSameDay(event.startAt, weekEnd)),
                );

      return statusOk && textOk && assignmentOk && dateOk;
    });

    return filtered.map((job) => ({
      ...job,
      customer: demoCustomers.find((customer) => customer.id === job.customerId) ?? demoCustomers[0],
      invoices: [],
      expenses: [],
      timeEntries: [],
      assignments: assignments.filter((assignment) => assignment.jobId === job.id),
      scheduleEvents: scheduleEvents.filter((event) => event.jobId === job.id),
    })) as never[];
  }

  const where = {
    orgId: params.orgId,
    ...(params.status && params.status !== "ALL" ? { status: params.status as never } : {}),
    ...(params.q
      ? {
          OR: [
            { jobName: { contains: params.q, mode: "insensitive" as const } },
            { address: { contains: params.q, mode: "insensitive" as const } },
            { customer: { name: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...{},
    ...(view === "today"
      ? {
          OR: [
            { scheduleEvents: { some: { startAt: { gte: todayStart, lte: todayEnd } } } },
            { startDate: { gte: todayStart, lte: todayEnd } },
            { status: { in: [JobStatus.ESTIMATE, JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.ON_HOLD] } },
          ],
        }
      : {}),
    ...(view === "week"
      ? {
          OR: [
            { scheduleEvents: { some: { startAt: { gte: weekStart, lte: weekEnd } } } },
            { startDate: { gte: weekStart, lte: weekEnd } },
            { status: { in: [JobStatus.ESTIMATE, JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.ON_HOLD] } },
          ],
        }
      : {}),
  };

  return prisma.job.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      customer: true,
      invoices: { select: { total: true } },
      expenses: { select: { amount: true } },
      timeEntries: {
        where: { start: { gte: weekStart, lte: weekEnd }, end: { not: null } },
        select: {
          workerId: true,
          start: true,
          end: true,
          worker: { select: { fullName: true } },
        },
      },
      scheduleEvents: {
        where:
          view === "today"
            ? { startAt: { gte: todayStart, lte: todayEnd } }
            : view === "week"
              ? { startAt: { gte: weekStart, lte: weekEnd } }
              : undefined,
        orderBy: { startAt: "asc" },
      },
    },
  });
}

export async function getJobsPageAlerts(params: { orgId: string; role: Role; userId: string }) {
  const todayStart = startOfDay(new Date());
  const assignmentFilter = {};
  const receiptCutoff = subHours(new Date(), 24);

  if (isDemoMode()) {
    const assignedJobIds = [
      ...new Set([
        ...demoJobAssignments.map((a) => a.jobId),
        ...listDemoRuntimeAssignments().map((a) => a.jobId),
      ]),
    ];
    const overdueTasks = demoTasks
      .filter(
        (t) => assignedJobIds.includes(t.jobId) && t.dueDate && isBefore(t.dueDate, todayStart),
      )
      .map((t) => {
        const job = demoJobs.find((j) => j.id === t.jobId) ?? demoJobs[0];
        const assignee = demoUsers.find((u) => u.id === t.assignedTo);
        return {
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          status: t.status,
          job: { id: job.id, jobName: job.jobName },
          assignee: assignee ? { id: assignee.id, fullName: assignee.fullName } : null,
        };
      });
    return {
      overdueTasks,
      jobIdsWithMissingReceipts: [demoJobs[0].id],
    };
  }

  const [overdueTasks, expensesNoReceipt] = await Promise.all([
    prisma.task.findMany({
      where: {
        job: { orgId: params.orgId, ...assignmentFilter },
        dueDate: { lt: todayStart },
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
      include: { job: { select: { id: true, jobName: true } }, assignee: { select: { id: true, fullName: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        job: { orgId: params.orgId, ...assignmentFilter },
        receipt: null,
        createdAt: { lt: receiptCutoff },
      },
      select: { jobId: true },
    }),
  ]);
  const jobIdsWithMissingReceipts = [...new Set(expensesNoReceipt.map((e) => e.jobId))];
  return { overdueTasks, jobIdsWithMissingReceipts };
}

export async function getTodayOpsSummary(params: { orgId: string; userId: string; role: Role }) {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const receiptCutoff = subHours(new Date(), 24);

  if (isDemoMode()) {
    const scheduleEvents = getMergedDemoScheduleEvents();
    const todayEvents = scheduleEvents
      .filter((event) => isSameDay(event.startAt, new Date()))
      .map((event) => ({
        ...event,
        job: demoJobs.find((job) => job.id === event.jobId) ?? demoJobs[0],
      }));

    return {
      todayEvents,
      overdueTasksCount: 1,
      missingReceipts: 1,
      newLeadsAwaitingContact: 2,
    };
  }

  const workerJobFilter = params.role === Role.WORKER ? { assignments: { some: { userId: params.userId } } } : {};
  const [todayEvents, overdueTasksCount, missingReceipts, newLeadsAwaitingContact] = await Promise.all([
    prisma.jobScheduleEvent.findMany({
      where: {
        orgId: params.orgId,
        startAt: { gte: todayStart, lte: todayEnd },
        ...(params.role === Role.WORKER ? { job: workerJobFilter } : {}),
      },
      include: {
        job: {
          select: {
            id: true,
            jobName: true,
          },
        },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.task.count({
      where: {
        job: { orgId: params.orgId, ...workerJobFilter },
        dueDate: { lt: todayStart },
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
    }),
    prisma.expense.count({
      where: {
        job: { orgId: params.orgId, ...workerJobFilter },
        receipt: null,
        createdAt: { lt: receiptCutoff },
      },
    }),
    prisma.lead.count({
      where: {
        orgId: params.orgId,
        stage: LeadStage.NEW,
      },
    }),
  ]);

  return {
    todayEvents,
    overdueTasksCount,
    missingReceipts,
    newLeadsAwaitingContact,
  };
}

export async function getJobById(params: {
  orgId: string;
  role: Role;
  userId: string;
  jobId: string;
}) {
  if (isDemoMode()) {
    const assignments = getMergedDemoAssignments();
    const scheduleEvents = getMergedDemoScheduleEvents();
    const job = demoJobs.find((item) => item.id === params.jobId) ?? demoJobs[0];
    return {
      ...job,
      customer: demoCustomers.find((customer) => customer.id === job.customerId) ?? demoCustomers[0],
      fileAssets: [],
      estimates: [],
      changeOrders: [],
      timeEntries: [],
      expenses: [],
      tasks: demoTasks.filter((task) => task.jobId === job.id).map((task) => ({
        ...task,
        assignee: listDemoRuntimeUsers().find((user) => user.id === task.assignedTo) ?? null,
      })),
      invoices: [],
      activityLogs: [],
      assignments: assignments.filter((assignment) => assignment.jobId === job.id),
      scheduleEvents: scheduleEvents.filter((event) => event.jobId === job.id),
    } as never;
  }

  const job = await prisma.job.findFirst({
    where: {
      id: params.jobId,
      orgId: params.orgId,
      ...(params.role === Role.WORKER
        ? {
            OR: [
              { assignments: { some: { userId: params.userId } } },
              { tasks: { some: { assignedTo: params.userId } } },
              { timeEntries: { some: { workerId: params.userId } } },
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      assignments: true,
      scheduleEvents: { orderBy: { startAt: "asc" } },
      fileAssets: { orderBy: { createdAt: "desc" } },
      estimates: { include: { lineItems: true }, orderBy: { createdAt: "desc" } },
      changeOrders: { include: { lineItems: true }, orderBy: { createdAt: "desc" } },
      timeEntries: { include: { worker: true }, orderBy: { start: "desc" } },
      expenses: { include: { receipt: true }, orderBy: { date: "desc" } },
      tasks: { include: { assignee: true }, orderBy: { createdAt: "desc" } },
      invoices: {
        include: {
          lineItems: true,
          payments: true,
        },
        orderBy: { createdAt: "desc" },
      },
      activityLogs: {
        take: 50,
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!job) notFound();
  return job;
}

export async function getRunningTimer(userId: string) {
  if (isDemoMode()) return null;

  return prisma.timeEntry.findFirst({
    where: {
      workerId: userId,
      end: null,
    },
    include: { job: true },
    orderBy: { start: "desc" },
  });
}
