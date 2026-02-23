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
