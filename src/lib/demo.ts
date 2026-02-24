import { JobStatus, Role, TaskStatus } from "@prisma/client";
import { addDays, addHours, startOfDay, subDays } from "date-fns";

export function isDemoMode() {
  return !process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === "" || process.env.DEV_BYPASS === "1";
}

const now = new Date();
const todayStart = startOfDay(now);

export const demoUsers = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000001",
    fullName: "Admin Demo",
    email: "admin@demo.local",
    role: Role.OWNER,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    phone: null,
    hourlyRateDefault: 65,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    orgId: "00000000-0000-0000-0000-000000000001",
    fullName: "Crew Lead",
    email: "crew@demo.local",
    role: Role.WORKER,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    phone: null,
    hourlyRateDefault: 38,
  },
];

type DemoRuntimeUser = {
  id: string;
  orgId: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  phone: string | null;
  hourlyRateDefault: number | null;
};

export const demoCustomers = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000001",
    name: "Morris Family",
    phone: "555-201-4401",
    email: "morris@example.com",
    addresses: null,
    notes: null,
    leadSource: "Referral",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    orgId: "00000000-0000-0000-0000-000000000001",
    name: "Parkers",
    phone: "555-777-1002",
    email: "parker@example.com",
    addresses: null,
    notes: null,
    leadSource: "Google",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoJobs = [
  {
    id: "20000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000001",
    customerId: demoCustomers[0].id,
    jobName: "Kitchen Water Damage Rebuild",
    address: "1024 River St, Austin, TX",
    status: JobStatus.IN_PROGRESS,
    categoryTags: ["kitchen", "water damage", "insurance"],
    createdAt: now,
    updatedAt: now,
    startDate: subDays(now, 3),
    endDate: null,
    estimatedLaborBudget: 5400,
    estimatedMaterialsBudget: 4200,
    estimatedTotalBudget: 11200,
  },
  {
    id: "20000000-0000-0000-0000-000000000002",
    orgId: "00000000-0000-0000-0000-000000000001",
    customerId: demoCustomers[1].id,
    jobName: "Bathroom Remodel Phase 1",
    address: "88 Cedar Ln, Austin, TX",
    status: JobStatus.SCHEDULED,
    categoryTags: ["bath"],
    createdAt: now,
    updatedAt: now,
    startDate: addDays(now, 1),
    endDate: null,
    estimatedLaborBudget: 3100,
    estimatedMaterialsBudget: 2800,
    estimatedTotalBudget: 6800,
  },
  {
    id: "20000000-0000-0000-0000-000000000003",
    orgId: "00000000-0000-0000-0000-000000000001",
    customerId: demoCustomers[1].id,
    jobName: "Drywall Punch & Paint",
    address: "300 Oak Ridge, Austin, TX",
    status: JobStatus.ESTIMATE,
    categoryTags: ["drywall"],
    createdAt: now,
    updatedAt: now,
    startDate: addDays(now, 3),
    endDate: null,
    estimatedLaborBudget: 1600,
    estimatedMaterialsBudget: 900,
    estimatedTotalBudget: 3200,
  },
];

export const demoJobAssignments = [
  {
    id: "a0000000-0000-0000-0000-000000000001",
    orgId: demoJobs[0].orgId,
    jobId: demoJobs[0].id,
    userId: demoUsers[1].id,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "a0000000-0000-0000-0000-000000000002",
    orgId: demoJobs[1].orgId,
    jobId: demoJobs[1].id,
    userId: demoUsers[1].id,
    createdAt: now,
    updatedAt: now,
  },
];

export const demoScheduleEvents = [
  {
    id: "s0000000-0000-0000-0000-000000000001",
    orgId: demoJobs[0].orgId,
    jobId: demoJobs[0].id,
    startAt: addHours(todayStart, 8),
    endAt: addHours(todayStart, 12),
    notes: "Drywall install + texture",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "s0000000-0000-0000-0000-000000000002",
    orgId: demoJobs[0].orgId,
    jobId: demoJobs[0].id,
    startAt: addHours(todayStart, 13),
    endAt: addHours(todayStart, 16),
    notes: "Prime and prep",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "s0000000-0000-0000-0000-000000000003",
    orgId: demoJobs[1].orgId,
    jobId: demoJobs[1].id,
    startAt: addHours(addDays(todayStart, 1), 9),
    endAt: addHours(addDays(todayStart, 1), 15),
    notes: "Demo and rough-in",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoTasks = [
  {
    id: "t0000000-0000-0000-0000-000000000001",
    jobId: demoJobs[0].id,
    assignedTo: demoUsers[1].id,
    title: "Final sand and texture",
    dueDate: subDays(now, 1),
    status: TaskStatus.IN_PROGRESS,
    notes: "Overdue by 1 day",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "t0000000-0000-0000-0000-000000000002",
    jobId: demoJobs[1].id,
    assignedTo: demoUsers[1].id,
    title: "Protect floors + dust barriers",
    dueDate: now,
    status: TaskStatus.TODO,
    notes: null,
    createdAt: now,
    updatedAt: now,
  },
];

type DemoRuntimeAssignment = {
  id: string;
  orgId: string;
  jobId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

type DemoRuntimeScheduleEvent = {
  id: string;
  orgId: string;
  jobId: string;
  startAt: Date;
  endAt: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DemoRuntimeTimeEntry = {
  id: string;
  jobId: string;
  workerId: string;
  date: Date;
  start: Date;
  end: Date | null;
  breakMinutes: number;
  hourlyRateLoaded: number;
  notes: string | null;
};

declare global {
  var __fieldflowDemoUsers: DemoRuntimeUser[] | undefined;
  var __fieldflowDemoAssignments: DemoRuntimeAssignment[] | undefined;
  var __fieldflowDemoScheduleEvents: DemoRuntimeScheduleEvent[] | undefined;
  var __fieldflowDemoTimeEntries: DemoRuntimeTimeEntry[] | undefined;
}

function getDemoUsersStore() {
  if (!globalThis.__fieldflowDemoUsers) {
    globalThis.__fieldflowDemoUsers = demoUsers.map((user) => ({ ...user }));
  }
  return globalThis.__fieldflowDemoUsers;
}

function getDemoAssignmentsStore() {
  if (!globalThis.__fieldflowDemoAssignments) {
    globalThis.__fieldflowDemoAssignments = [];
  }
  return globalThis.__fieldflowDemoAssignments;
}

function getDemoScheduleEventsStore() {
  if (!globalThis.__fieldflowDemoScheduleEvents) {
    globalThis.__fieldflowDemoScheduleEvents = [];
  }
  return globalThis.__fieldflowDemoScheduleEvents;
}

function getDemoTimeEntriesStore() {
  if (!globalThis.__fieldflowDemoTimeEntries) {
    globalThis.__fieldflowDemoTimeEntries = [];
  }
  return globalThis.__fieldflowDemoTimeEntries;
}

export function listDemoRuntimeUsers() {
  return [...getDemoUsersStore()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function getDemoUserById(userId: string) {
  return getDemoUsersStore().find((user) => user.id === userId) ?? null;
}

export function getDemoOrgId() {
  return getDemoUsersStore()[0]?.orgId ?? "00000000-0000-0000-0000-000000000001";
}

export function demoCreateWorker(params: {
  fullName: string;
  email: string;
  phone?: string | null;
  role: Role;
  hourlyRateDefault?: number | null;
}) {
  const store = getDemoUsersStore();
  const now = new Date();
  store.push({
    id: crypto.randomUUID(),
    orgId: getDemoOrgId(),
    fullName: params.fullName,
    email: params.email,
    phone: params.phone ?? null,
    role: params.role,
    hourlyRateDefault: params.hourlyRateDefault ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function demoUpdateWorker(params: {
  workerId: string;
  fullName?: string;
  phone?: string | null;
  role?: Role;
  hourlyRateDefault?: number | null;
}) {
  const worker = getDemoUsersStore().find((user) => user.id === params.workerId);
  if (!worker) return;
  if (params.fullName && params.fullName.trim().length > 0) worker.fullName = params.fullName.trim();
  worker.phone = params.phone ?? null;
  if (params.role) worker.role = params.role;
  worker.hourlyRateDefault = params.hourlyRateDefault ?? null;
  worker.updatedAt = new Date();
}

export function demoSetWorkerActive(workerId: string, isActive: boolean) {
  const worker = getDemoUsersStore().find((user) => user.id === workerId);
  if (!worker) return;
  worker.isActive = isActive;
  worker.updatedAt = new Date();
}

export function listDemoRuntimeAssignments() {
  return [...getDemoAssignmentsStore()];
}

export function listDemoRuntimeScheduleEvents() {
  return [...getDemoScheduleEventsStore()];
}

export function demoAssignWorkersToJob(params: { orgId: string; jobId: string; workerIds: string[] }) {
  const store = getDemoAssignmentsStore();
  const keys = new Set([
    ...demoJobAssignments.map((item) => `${item.jobId}:${item.userId}`),
    ...store.map((item) => `${item.jobId}:${item.userId}`),
  ]);

  const now = new Date();
  for (const workerId of params.workerIds) {
    const key = `${params.jobId}:${workerId}`;
    if (keys.has(key)) continue;
    keys.add(key);
    store.push({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      jobId: params.jobId,
      userId: workerId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function demoSetJobAssignments(params: { orgId: string; jobId: string; workerIds: string[] }) {
  const store = getDemoAssignmentsStore();
  const selected = new Set(params.workerIds);
  const baseForJob = demoJobAssignments.filter((item) => item.jobId === params.jobId);
  const keepFromRuntime = store.filter((item) => item.jobId !== params.jobId);

  const mergedForJob = [
    ...baseForJob.filter((item) => selected.has(item.userId)),
    ...store.filter((item) => item.jobId === params.jobId && selected.has(item.userId)),
  ];
  const existingKeys = new Set(mergedForJob.map((item) => `${item.jobId}:${item.userId}`));
  const now = new Date();

  for (const userId of selected) {
    const key = `${params.jobId}:${userId}`;
    if (existingKeys.has(key)) continue;
    mergedForJob.push({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      jobId: params.jobId,
      userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  globalThis.__fieldflowDemoAssignments = [...keepFromRuntime, ...mergedForJob];
}

export function demoAddScheduleEvents(
  events: Array<{ orgId: string; jobId: string; startAt: Date; endAt: Date; notes?: string | null }>,
) {
  const store = getDemoScheduleEventsStore();
  const now = new Date();
  for (const event of events) {
    store.push({
      id: crypto.randomUUID(),
      orgId: event.orgId,
      jobId: event.jobId,
      startAt: event.startAt,
      endAt: event.endAt,
      notes: event.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function listDemoRuntimeTimeEntries() {
  return [...getDemoTimeEntriesStore()];
}

export function demoClockInWorker(params: { workerId: string; jobId: string; hourlyRateLoaded?: number }) {
  const store = getDemoTimeEntriesStore();
  const hasActive = store.some((entry) => entry.workerId === params.workerId && entry.end === null);
  if (hasActive) {
    throw new Error("Employee already has a running timer.");
  }

  const now = new Date();
  store.push({
    id: crypto.randomUUID(),
    jobId: params.jobId,
    workerId: params.workerId,
    date: now,
    start: now,
    end: null,
    breakMinutes: 0,
    hourlyRateLoaded: params.hourlyRateLoaded ?? 35,
    notes: "Demo owner clock-in",
  });
}

export function demoClockOutWorker(workerId: string) {
  const store = getDemoTimeEntriesStore();
  const active = [...store]
    .reverse()
    .find((entry) => entry.workerId === workerId && entry.end === null);

  if (!active) return;
  active.end = new Date();
}
