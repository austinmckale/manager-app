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
    const assignedJobIds = assignments.map((assignment) => assignment.jobId);

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
      invoices: true,
      expenses: true,
      timeEntries: { include: { worker: true } },
      assignments: true,
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
    const assignments = getMergedDemoAssignments();
    const scheduleEvents = getMergedDemoScheduleEvents();
    const assignedJobIds = assignments.map((assignment) => assignment.jobId);

    const assignedJobs = demoJobs.filter((job) => assignedJobIds.includes(job.id));
    const todayEvents = scheduleEvents
      .filter((event) => assignedJobIds.includes(event.jobId) && isSameDay(event.startAt, new Date()))
      .map((event) => ({
        ...event,
        job: demoJobs.find((job) => job.id === event.jobId) ?? demoJobs[0],
      }));
    const weekEvents = scheduleEvents
      .filter((event) => assignedJobIds.includes(event.jobId))
      .map((event) => ({
        ...event,
        job: demoJobs.find((job) => job.id === event.jobId) ?? demoJobs[0],
      }));
    const overdueTasks = demoTasks.filter(
      (task) =>
        assignedJobIds.includes(task.jobId) &&
        task.dueDate &&
        isBefore(task.dueDate, todayStart),
    );

    return {
      assignedJobs,
      todayEvents,
      weekEvents,
      overdueTasks,
      unsentEstimates: 1,
      unpaidInvoices: 2,
      missingReceipts: 1,
      newLeadsAwaitingContact: 2,
      newLeadList: [
        {
          id: "demo-lead-today-1",
          contactName: "Samantha Reed",
          serviceType: "Water Damage",
          source: "WEBSITE_FORM",
          createdAt: new Date(Date.now() - 1000 * 60 * 45),
        },
        {
          id: "demo-lead-today-2",
          contactName: "John Ortiz",
          serviceType: "Bathroom Remodel",
          source: "PHONE_CALL",
          createdAt: new Date(Date.now() - 1000 * 60 * 90),
        },
      ],
    };
  }

  const assignmentFilter = params.role === Role.WORKER ? { assignments: { some: { userId: params.userId } } } : {};

  const [assignedJobs, todayEvents, weekEvents, overdueTasks, unsentEstimates, unpaidInvoices, missingReceipts, newLeadsAwaitingContact, newLeadList] =
    await Promise.all([
      prisma.job.findMany({
        where: { orgId: params.orgId, ...assignmentFilter },
        include: { customer: true, invoices: true, expenses: true, timeEntries: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.jobScheduleEvent.findMany({
        where: {
          orgId: params.orgId,
          startAt: { gte: todayStart, lte: todayEnd },
        },
        include: { job: true },
        orderBy: { startAt: "asc" },
      }),
      prisma.jobScheduleEvent.findMany({
        where: {
          orgId: params.orgId,
          startAt: { gte: startOfWeek(new Date(), { weekStartsOn: 1 }), lte: endOfWeek(new Date(), { weekStartsOn: 1 }) },
        },
        include: { job: true },
        orderBy: { startAt: "asc" },
      }),
      prisma.task.findMany({
        where: {
          job: { orgId: params.orgId, ...assignmentFilter },
          dueDate: { lt: todayStart },
          status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        },
        include: { job: true, assignee: true },
        orderBy: { dueDate: "asc" },
      }),
      prisma.estimate.count({ where: { job: { orgId: params.orgId, ...assignmentFilter }, status: "DRAFT" } }),
      prisma.invoice.count({ where: { job: { orgId: params.orgId, ...assignmentFilter }, status: { in: ["SENT", "OVERDUE"] } } }),
      prisma.expense.count({
        where: {
          job: { orgId: params.orgId, ...assignmentFilter },
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
      prisma.lead.findMany({
        where: {
          orgId: params.orgId,
          stage: LeadStage.NEW,
        },
        orderBy: { createdAt: "asc" },
        take: 8,
        select: {
          id: true,
          contactName: true,
          serviceType: true,
          source: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    assignedJobs,
    todayEvents,
    weekEvents,
    overdueTasks,
    unsentEstimates,
    unpaidInvoices,
    missingReceipts,
    newLeadsAwaitingContact,
    newLeadList,
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
