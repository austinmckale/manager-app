"use server";

import { ExpenseCategory, InvoiceStatus, JobStatus, LeadSource, LeadStage, LineItemType, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { ensureDefaultKpis } from "@/lib/kpis";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

function parseMoney(value: FormDataEntryValue | null) {
  return Number(value ?? 0);
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() ?? "";
    });
    return record;
  });
}

function pickCsvValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key.toLowerCase()];
    if (value) return value.trim();
  }
  return "";
}

function mapJoistStatusToLeadStage(statusRaw: string): LeadStage {
  const status = statusRaw.trim().toLowerCase();
  if (!status) return LeadStage.ESTIMATE_SENT;
  if (["approved", "accepted", "won", "paid", "complete", "completed"].includes(status)) return LeadStage.WON;
  if (["declined", "lost", "rejected", "cancelled", "canceled"].includes(status)) return LeadStage.LOST;
  if (["sent", "viewed", "pending", "open", "draft"].includes(status)) return LeadStage.ESTIMATE_SENT;
  return LeadStage.CONTACTED;
}

async function logActivity(
  orgId: string,
  jobId: string | null,
  actorId: string,
  action: string,
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.activityLog.create({
    data: {
      orgId,
      jobId: jobId ?? undefined,
      actorId,
      action,
      metadata,
    },
  });
}

export async function createCustomerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/customers");
    revalidatePath("/jobs");
    return;
  }

  const auth = await requireAuth();

  const schema = z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    address: z.string().optional(),
    notes: z.string().optional(),
    leadSource: z.string().optional(),
  });

  const parsed = schema.parse({
    name: formData.get("name"),
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    address: formData.get("address") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    leadSource: formData.get("leadSource") ?? undefined,
  });

  await prisma.customer.create({
    data: {
      orgId: auth.orgId,
      name: parsed.name,
      phone: parsed.phone || null,
      email: parsed.email || null,
      addresses: parsed.address ? [{ label: "primary", value: parsed.address }] : undefined,
      notes: parsed.notes || null,
      leadSource: parsed.leadSource || null,
    },
  });

  await logActivity(auth.orgId, null, auth.userId, "customer.created", { name: parsed.name });
  revalidatePath("/customers");
  revalidatePath("/jobs");
}

export async function createLeadAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return;
  }

  const auth = await requireAuth();

  const schema = z.object({
    contactName: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    address: z.string().optional(),
    serviceType: z.string().optional(),
    source: z.nativeEnum(LeadSource),
    notes: z.string().optional(),
  });

  const parsed = schema.parse({
    contactName: formData.get("contactName"),
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    address: formData.get("address") ?? undefined,
    serviceType: formData.get("serviceType") ?? undefined,
    source: formData.get("source") ?? LeadSource.OTHER,
    notes: formData.get("notes") ?? undefined,
  });

  const lead = await prisma.lead.create({
    data: {
      orgId: auth.orgId,
      contactName: parsed.contactName,
      phone: parsed.phone || null,
      email: parsed.email || null,
      address: parsed.address || null,
      serviceType: parsed.serviceType || null,
      source: parsed.source,
      notes: parsed.notes || null,
      stage: LeadStage.NEW,
    },
  });

  await logActivity(auth.orgId, null, auth.userId, "lead.created", {
    leadId: lead.id,
    source: parsed.source,
  });
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateLeadStageAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return;
  }

  const auth = await requireAuth();
  const leadId = String(formData.get("leadId") ?? "");
  const stage = String(formData.get("stage") ?? "") as LeadStage;
  const lostReason = String(formData.get("lostReason") ?? "").trim();

  if (!leadId || !stage) return;

  const existing = await prisma.lead.findFirstOrThrow({
    where: { id: leadId, orgId: auth.orgId },
  });

  const lead = await prisma.lead.update({
    where: { id: existing.id },
    data: {
      stage,
      lostReason: stage === LeadStage.LOST ? lostReason || "unspecified" : null,
    },
  });

  await logActivity(auth.orgId, lead.jobId ?? null, auth.userId, "lead.stage.updated", {
    leadId: lead.id,
    stage,
  });
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function convertLeadToJobAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/leads");
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return;
  }

  const auth = await requireAuth();
  const leadId = String(formData.get("leadId") ?? "");
  const jobNameInput = String(formData.get("jobName") ?? "").trim();

  if (!leadId) return;

  const lead = await prisma.lead.findFirstOrThrow({
    where: { id: leadId, orgId: auth.orgId },
  });

  const customer = await prisma.customer.create({
    data: {
      orgId: auth.orgId,
      name: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      addresses: lead.address ? [{ label: "primary", value: lead.address }] : undefined,
      leadSource: lead.source,
      notes: lead.notes,
    },
  });

  const job = await prisma.job.create({
    data: {
      orgId: auth.orgId,
      customerId: customer.id,
      jobName: jobNameInput || `${lead.serviceType || "New"} - ${lead.contactName}`,
      address: lead.address || "Address pending",
      status: JobStatus.ESTIMATE,
      categoryTags: [lead.serviceType || "general", "lead-converted"],
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage: LeadStage.WON,
      customerId: customer.id,
      jobId: job.id,
      convertedAt: new Date(),
      lostReason: null,
    },
  });

  await logActivity(auth.orgId, job.id, auth.userId, "lead.converted_to_job", {
    leadId: lead.id,
    customerId: customer.id,
  });
  revalidatePath("/leads");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function importJoistCsvAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/leads");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can import Joist data.");
  }

  const file = formData.get("csvFile");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("CSV file is required.");
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error("No rows found. Export Joist data as CSV and upload it here.");
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const contactName = pickCsvValue(row, ["client name", "customer name", "name", "client"]);
    const phone = pickCsvValue(row, ["phone", "phone number", "client phone"]);
    const email = pickCsvValue(row, ["email", "client email"]);
    const address = pickCsvValue(row, ["address", "job address", "client address"]);
    const serviceType = pickCsvValue(row, ["title", "project", "description", "service"]);
    const statusRaw = pickCsvValue(row, ["status", "estimate status", "invoice status"]);
    const estimateNumber = pickCsvValue(row, ["estimate number", "estimate #", "estimate id", "id"]);
    const invoiceNumber = pickCsvValue(row, ["invoice number", "invoice #"]);
    const externalRefBase = estimateNumber || invoiceNumber;
    const stage = mapJoistStatusToLeadStage(statusRaw);

    if (!contactName && !phone && !email) {
      skipped += 1;
      continue;
    }

    const externalRef = externalRefBase ? `joist:${externalRefBase}`.slice(0, 191) : "";
    const notes = `Imported from Joist CSV${statusRaw ? ` • status: ${statusRaw}` : ""}`;

    if (externalRef) {
      const result = await prisma.lead.upsert({
        where: {
          orgId_externalRef: {
            orgId: auth.orgId,
            externalRef,
          },
        },
        update: {
          contactName: contactName || undefined,
          phone: phone || null,
          email: email || null,
          address: address || null,
          serviceType: serviceType || null,
          source: LeadSource.OTHER,
          stage,
          notes,
          rawPayload: row,
        },
        create: {
          orgId: auth.orgId,
          externalRef,
          contactName: contactName || phone || email || "Imported Lead",
          phone: phone || null,
          email: email || null,
          address: address || null,
          serviceType: serviceType || null,
          source: LeadSource.OTHER,
          stage,
          notes,
          rawPayload: row,
        },
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) imported += 1;
      else updated += 1;
      continue;
    }

    await prisma.lead.create({
      data: {
        orgId: auth.orgId,
        contactName: contactName || phone || email || "Imported Lead",
        phone: phone || null,
        email: email || null,
        address: address || null,
        serviceType: serviceType || null,
        source: LeadSource.OTHER,
        stage,
        notes,
        rawPayload: row,
      },
    });
    imported += 1;
  }

  await logActivity(auth.orgId, null, auth.userId, "lead.import.joist", {
    fileName: file.name,
    imported,
    updated,
    skipped,
  });

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function createJobAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/jobs");
    return;
  }

  const auth = await requireAuth();

  const schema = z.object({
    customerId: z.string().uuid(),
    jobName: z.string().min(1),
    address: z.string().min(1),
    status: z.nativeEnum(JobStatus),
    tags: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    estimatedLaborBudget: z.coerce.number().optional(),
    estimatedMaterialsBudget: z.coerce.number().optional(),
    estimatedTotalBudget: z.coerce.number().optional(),
  });

  const parsed = schema.parse({
    customerId: formData.get("customerId"),
    jobName: formData.get("jobName"),
    address: formData.get("address"),
    status: formData.get("status") ?? JobStatus.LEAD,
    tags: formData.get("tags") ?? "",
    startDate: formData.get("startDate") ?? "",
    endDate: formData.get("endDate") ?? "",
    estimatedLaborBudget: formData.get("estimatedLaborBudget") ?? undefined,
    estimatedMaterialsBudget: formData.get("estimatedMaterialsBudget") ?? undefined,
    estimatedTotalBudget: formData.get("estimatedTotalBudget") ?? undefined,
  });

  const tags = parsed.tags
    ? parsed.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const job = await prisma.job.create({
    data: {
      orgId: auth.orgId,
      customerId: parsed.customerId,
      jobName: parsed.jobName,
      address: parsed.address,
      status: parsed.status,
      categoryTags: tags,
      startDate: parsed.startDate ? new Date(parsed.startDate) : null,
      endDate: parsed.endDate ? new Date(parsed.endDate) : null,
      estimatedLaborBudget: parsed.estimatedLaborBudget,
      estimatedMaterialsBudget: parsed.estimatedMaterialsBudget,
      estimatedTotalBudget: parsed.estimatedTotalBudget,
    },
  });

  await logActivity(auth.orgId, job.id, auth.userId, "job.created", { status: parsed.status });
  revalidatePath("/jobs");
  revalidatePath("/today");
}

export async function assignWorkerToJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  if (isDemoMode()) {
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can assign workers.");
  }

  const userId = String(formData.get("userId") ?? "");
  if (!jobId || !userId) return;

  await prisma.jobAssignment.upsert({
    where: {
      jobId_userId: { jobId, userId },
    },
    update: {},
    create: {
      orgId: auth.orgId,
      jobId,
      userId,
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "job.assignment.created", { userId });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/today");
}

export async function createScheduleEventAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  if (isDemoMode()) {
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    revalidatePath("/jobs");
    return;
  }

  const auth = await requireAuth();
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");
  const notes = String(formData.get("notes") ?? "");

  if (!jobId || !startAt || !endAt) return;

  await prisma.jobScheduleEvent.create({
    data: {
      orgId: auth.orgId,
      jobId,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      notes: notes || null,
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "job.schedule_event.created", {
    startAt,
    endAt,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/today");
  revalidatePath("/jobs");
}

export async function createTimeEntryAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    revalidatePath("/time");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return;
  }

  const auth = await requireAuth();

  const schema = z.object({
    jobId: z.string().uuid(),
    start: z.string().min(1),
    end: z.string().optional(),
    breakMinutes: z.coerce.number().min(0).default(0),
    notes: z.string().optional(),
    startLat: z.coerce.number().optional(),
    startLng: z.coerce.number().optional(),
    endLat: z.coerce.number().optional(),
    endLng: z.coerce.number().optional(),
    workerId: z.string().uuid().optional(),
  });

  const parsed = schema.parse({
    jobId: formData.get("jobId"),
    start: formData.get("start"),
    end: formData.get("end") ?? undefined,
    breakMinutes: formData.get("breakMinutes") ?? 0,
    notes: formData.get("notes") ?? undefined,
    startLat: formData.get("startLat") ?? undefined,
    startLng: formData.get("startLng") ?? undefined,
    endLat: formData.get("endLat") ?? undefined,
    endLng: formData.get("endLng") ?? undefined,
    workerId: formData.get("workerId") ?? undefined,
  });

  const workerId = canManageOrg(auth.role) && parsed.workerId ? parsed.workerId : auth.userId;

  const worker = await prisma.userProfile.findUniqueOrThrow({ where: { id: workerId } });
  const hourlyRate = toNumber(worker.hourlyRateDefault) || 35;

  const entry = await prisma.timeEntry.create({
    data: {
      jobId: parsed.jobId,
      workerId,
      date: new Date(parsed.start),
      start: new Date(parsed.start),
      end: parsed.end ? new Date(parsed.end) : null,
      breakMinutes: parsed.breakMinutes,
      notes: parsed.notes || null,
      hourlyRateLoaded: hourlyRate,
      startLat: parsed.startLat,
      startLng: parsed.startLng,
      endLat: parsed.endLat,
      endLng: parsed.endLng,
    },
  });

  await logActivity(auth.orgId, parsed.jobId, auth.userId, "time.created", { timeEntryId: entry.id });
  revalidatePath("/time");
  revalidatePath(`/jobs/${parsed.jobId}`);
}

export async function startTimerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));

  const active = await prisma.timeEntry.findFirst({
    where: { workerId: auth.userId, end: null },
  });

  if (active) {
    throw new Error("You already have a running timer.");
  }

  const worker = await prisma.userProfile.findUniqueOrThrow({ where: { id: auth.userId } });

  const now = new Date();
  await prisma.timeEntry.create({
    data: {
      jobId,
      workerId: auth.userId,
      date: now,
      start: now,
      breakMinutes: 0,
      hourlyRateLoaded: toNumber(worker.hourlyRateDefault) || 35,
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "time.timer.started");
  revalidatePath("/time");
  revalidatePath(`/jobs/${jobId}`);
}

export async function stopTimerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  const timeEntryId = String(formData.get("timeEntryId"));

  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });

  if (entry.workerId !== auth.userId && !canManageOrg(auth.role)) {
    throw new Error("You cannot stop this timer.");
  }

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: {
      end: new Date(),
    },
  });

  await logActivity(auth.orgId, entry.jobId, auth.userId, "time.timer.stopped", { timeEntryId });
  revalidatePath("/time");
  revalidatePath(`/jobs/${entry.jobId}`);
}

export async function createExpenseAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    revalidatePath("/jobs");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/reports");
    return;
  }

  const auth = await requireAuth();

  const schema = z.object({
    jobId: z.string().uuid(),
    vendor: z.string().min(1),
    amount: z.coerce.number().positive(),
    category: z.nativeEnum(ExpenseCategory).optional(),
    date: z.string().min(1),
    notes: z.string().optional(),
  });

  const parsed = schema.parse({
    jobId: formData.get("jobId"),
    vendor: formData.get("vendor"),
    amount: formData.get("amount"),
    category: formData.get("category") ?? undefined,
    date: formData.get("date"),
    notes: formData.get("notes") ?? undefined,
  });

  const expense = await prisma.expense.create({
    data: {
      jobId: parsed.jobId,
      vendor: parsed.vendor,
      amount: parsed.amount,
      category: parsed.category ?? ExpenseCategory.MISC,
      date: new Date(parsed.date),
      notes: parsed.notes || null,
    },
  });

  await logActivity(auth.orgId, parsed.jobId, auth.userId, "expense.created", { expenseId: expense.id });
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${parsed.jobId}`);
  revalidatePath("/reports");
}

export async function createTaskAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return;
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));
  const title = String(formData.get("title"));
  const notes = String(formData.get("notes") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");
  const assignedTo = String(formData.get("assignedTo") ?? "");

  const task = await prisma.task.create({
    data: {
      jobId,
      title,
      notes: notes || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedTo: assignedTo || null,
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "task.created", { taskId: task.id });
  revalidatePath(`/jobs/${jobId}`);
}

export async function updateJobStatusAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const status = String(formData.get("status") ?? "") as JobStatus;

  if (isDemoMode()) {
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  if (!jobId || !status) return;

  if (status === JobStatus.COMPLETED) {
    const confirmFinalPhotos = formData.get("confirmFinalPhotos") === "on";
    const confirmPunchList = formData.get("confirmPunchList") === "on";
    const confirmReceipts = formData.get("confirmReceipts") === "on";
    const confirmInvoiceSent = formData.get("confirmInvoiceSent") === "on";

    if (!confirmFinalPhotos || !confirmPunchList || !confirmReceipts || !confirmInvoiceSent) {
      throw new Error("Closeout checklist must be fully confirmed before completion.");
    }

    const [afterPhotoCount, openTaskCount, invoiceCount, nonDraftInvoiceCount] = await Promise.all([
      prisma.fileAsset.count({
        where: {
          jobId,
          type: "PHOTO",
          stage: "AFTER",
        },
      }),
      prisma.task.count({
        where: {
          jobId,
          status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        },
      }),
      prisma.invoice.count({ where: { jobId } }),
      prisma.invoice.count({
        where: {
          jobId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PAID, InvoiceStatus.OVERDUE] },
        },
      }),
    ]);

    if (afterPhotoCount < 1) {
      throw new Error("Cannot complete job: add at least one AFTER photo.");
    }
    if (openTaskCount > 0) {
      throw new Error("Cannot complete job: punch list still has open items.");
    }
    if (invoiceCount < 1 || nonDraftInvoiceCount < 1) {
      throw new Error("Cannot complete job: send at least one invoice before closeout.");
    }
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status,
      ...(status === JobStatus.COMPLETED ? { endDate: new Date() } : {}),
    },
  });

  await logActivity(auth.orgId, job.id, auth.userId, "job.status.updated", { status });
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/jobs");
  revalidatePath("/today");
}

export async function updateTaskStatusAction(formData: FormData) {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  const taskId = String(formData.get("taskId"));
  const status = String(formData.get("status"));

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: status as never,
    },
  });

  await logActivity(auth.orgId, task.jobId, auth.userId, "task.updated", { taskId, status });
  revalidatePath(`/jobs/${task.jobId}`);
}

export async function createEstimateAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return;
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));
  const description = String(formData.get("description") ?? "Line item");
  const quantity = parseMoney(formData.get("quantity"));
  const unitPrice = parseMoney(formData.get("unitPrice"));
  const tax = parseMoney(formData.get("tax"));
  const margin = parseMoney(formData.get("margin"));
  const lineTotal = quantity * unitPrice;
  const subtotal = lineTotal;
  const total = subtotal + tax + margin;

  const estimate = await prisma.estimate.create({
    data: {
      jobId,
      subtotal,
      tax,
      margin,
      total,
      lineItems: {
        create: {
          type: LineItemType.LABOR,
          description,
          quantity,
          unitPrice,
          total: lineTotal,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "ESTIMATE",
      entityId: estimate.id,
      actorId: auth.userId,
      event: "created",
      payload: { subtotal, tax, margin, total },
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "estimate.created", { estimateId: estimate.id });
  revalidatePath(`/jobs/${jobId}`);
}

export async function approveEstimateAction(formData: FormData) {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  const estimateId = String(formData.get("estimateId"));

  const estimate = await prisma.estimate.update({
    where: { id: estimateId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "ESTIMATE",
      entityId: estimate.id,
      actorId: auth.userId,
      event: "approved",
      payload: { approvedAt: new Date().toISOString() },
    },
  });

  await logActivity(auth.orgId, estimate.jobId, auth.userId, "estimate.approved", { estimateId });
  revalidatePath(`/jobs/${estimate.jobId}`);
}

export async function createChangeOrderAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return;
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));
  const description = String(formData.get("description"));
  const quantity = parseMoney(formData.get("quantity"));
  const unitPrice = parseMoney(formData.get("unitPrice"));
  const total = quantity * unitPrice;

  const co = await prisma.changeOrder.create({
    data: {
      jobId,
      description,
      total,
      lineItems: {
        create: {
          type: LineItemType.OTHER,
          description,
          quantity,
          unitPrice,
          total,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "CHANGE_ORDER",
      entityId: co.id,
      actorId: auth.userId,
      event: "created",
      payload: { total },
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "change_order.created", { changeOrderId: co.id });
  revalidatePath(`/jobs/${jobId}`);
}

export async function approveChangeOrderAction(formData: FormData) {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  const changeOrderId = String(formData.get("changeOrderId"));

  const changeOrder = await prisma.changeOrder.update({
    where: { id: changeOrderId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "CHANGE_ORDER",
      entityId: changeOrder.id,
      actorId: auth.userId,
      event: "approved",
      payload: { approvedAt: new Date().toISOString() },
    },
  });

  await logActivity(auth.orgId, changeOrder.jobId, auth.userId, "change_order.approved", { changeOrderId });
  revalidatePath(`/jobs/${changeOrder.jobId}`);
}

export async function convertEstimateToInvoiceAction(formData: FormData) {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  const estimateId = String(formData.get("estimateId"));

  const estimate = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: { lineItems: true },
  });

  const invoice = await prisma.invoice.create({
    data: {
      jobId: estimate.jobId,
      basedOnEstimateId: estimate.id,
      subtotal: estimate.subtotal,
      tax: estimate.tax,
      total: estimate.total,
      status: InvoiceStatus.DRAFT,
      lineItems: {
        create: estimate.lineItems.map((item) => ({
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          sortOrder: item.sortOrder,
        })),
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "INVOICE",
      entityId: invoice.id,
      actorId: auth.userId,
      event: "created_from_estimate",
      payload: { estimateId },
    },
  });

  await logActivity(auth.orgId, estimate.jobId, auth.userId, "invoice.created", { invoiceId: invoice.id });
  revalidatePath(`/jobs/${estimate.jobId}`);
}

export async function addPaymentAction(formData: FormData) {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  const invoiceId = String(formData.get("invoiceId"));
  const amount = parseMoney(formData.get("amount"));
  const method = String(formData.get("method") ?? "other");
  const date = new Date(String(formData.get("date") ?? new Date().toISOString()));
  const notes = String(formData.get("notes") ?? "");

  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      amount,
      date,
      method,
      notes: notes || null,
    },
    include: {
      invoice: true,
    },
  });

  const totalPaid = await prisma.payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });

  if (toNumber(totalPaid._sum.amount) >= toNumber(payment.invoice.total)) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: new Date(),
      },
    });
  }

  await logActivity(auth.orgId, payment.invoice.jobId, auth.userId, "payment.created", { paymentId: payment.id });
  revalidatePath(`/jobs/${payment.invoice.jobId}`);
}

export async function createTargetAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/settings/targets");
    revalidatePath("/dashboard");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can update targets.");
  }

  await ensureDefaultKpis();

  const schema = z.object({
    kpiKey: z.string().min(1),
    targetValue: z.coerce.number(),
    period: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
    effectiveDate: z.string().min(1),
  });

  const parsed = schema.parse({
    kpiKey: formData.get("kpiKey"),
    targetValue: formData.get("targetValue"),
    period: formData.get("period"),
    effectiveDate: formData.get("effectiveDate"),
  });

  await prisma.kpiTarget.upsert({
    where: {
      orgId_kpiKey_period_effectiveDate: {
        orgId: auth.orgId,
        kpiKey: parsed.kpiKey,
        period: parsed.period,
        effectiveDate: new Date(parsed.effectiveDate),
      },
    },
    update: {
      targetValue: parsed.targetValue,
    },
    create: {
      orgId: auth.orgId,
      kpiKey: parsed.kpiKey,
      period: parsed.period,
      targetValue: parsed.targetValue,
      effectiveDate: new Date(parsed.effectiveDate),
    },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/dashboard");
}

export async function updateTimeEntryAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  const timeEntryId = String(formData.get("timeEntryId"));
  const start = String(formData.get("start"));
  const end = String(formData.get("end") ?? "");
  const breakMinutes = Number(formData.get("breakMinutes") ?? 0);
  const notes = String(formData.get("notes") ?? "");

  const [entry, settings] = await Promise.all([
    prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } }),
    prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
  ]);

  const { canEditTimeEntry } = await import("@/lib/permissions");
  const canEdit = canEditTimeEntry({
    role: auth.role,
    actorUserId: auth.userId,
    entry,
    workerCanEditOwnSameDay: settings?.workerCanEditOwnTimeSameDay ?? true,
  });

  if (!canEdit) {
    throw new Error("You do not have permission to edit this time entry.");
  }

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: {
      start: new Date(start),
      end: end ? new Date(end) : null,
      date: new Date(start),
      breakMinutes,
      notes: notes || null,
    },
  });

  await logActivity(auth.orgId, entry.jobId, auth.userId, "time.updated", { timeEntryId });
  revalidatePath("/time");
  revalidatePath(`/jobs/${entry.jobId}`);
}

export async function updateOrgSettingsAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/settings/targets");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can update settings.");
  }

  const defaultClockInTime = String(formData.get("defaultClockInTime") ?? "07:00");
  const clockGraceRaw = Number(formData.get("clockGraceMinutes") ?? 10);
  const clockGraceMinutes = Number.isFinite(clockGraceRaw) ? Math.max(0, Math.min(120, Math.trunc(clockGraceRaw))) : 10;

  await prisma.organizationSetting.upsert({
    where: { orgId: auth.orgId },
    update: {
      workerCanEditOwnTimeSameDay: formData.get("workerCanEditOwnTimeSameDay") === "on",
      gpsTimeTrackingEnabled: formData.get("gpsTimeTrackingEnabled") === "on",
      defaultClockInTime,
      clockGraceMinutes,
    },
    create: {
      orgId: auth.orgId,
      workerCanEditOwnTimeSameDay: formData.get("workerCanEditOwnTimeSameDay") === "on",
      gpsTimeTrackingEnabled: formData.get("gpsTimeTrackingEnabled") === "on",
      defaultClockInTime,
      clockGraceMinutes,
    },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/attendance");
}

export async function ownerClockInEmployeeAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/attendance");
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can clock in employees.");
  }

  const workerId = String(formData.get("workerId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  if (!workerId || !jobId) return;

  const active = await prisma.timeEntry.findFirst({
    where: { workerId, end: null },
    select: { id: true },
  });
  if (active) {
    throw new Error("Employee already has a running timer.");
  }

  const worker = await prisma.userProfile.findFirstOrThrow({
    where: { id: workerId, orgId: auth.orgId },
  });

  const now = new Date();
  const entry = await prisma.timeEntry.create({
    data: {
      jobId,
      workerId,
      date: now,
      start: now,
      breakMinutes: 0,
      hourlyRateLoaded: toNumber(worker.hourlyRateDefault) || 35,
      notes: "Owner clock-in",
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "time.owner.clock_in", {
    workerId,
    timeEntryId: entry.id,
  });
  revalidatePath("/attendance");
  revalidatePath("/time");
  revalidatePath("/today");
}

export async function ownerClockOutEmployeeAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/attendance");
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can clock out employees.");
  }

  const workerId = String(formData.get("workerId") ?? "");
  if (!workerId) return;

  const active = await prisma.timeEntry.findFirst({
    where: {
      workerId,
      end: null,
      job: { orgId: auth.orgId },
    },
    orderBy: { start: "desc" },
  });
  if (!active) return;

  await prisma.timeEntry.update({
    where: { id: active.id },
    data: { end: new Date() },
  });

  await logActivity(auth.orgId, active.jobId, auth.userId, "time.owner.clock_out", {
    workerId,
    timeEntryId: active.id,
  });
  revalidatePath("/attendance");
  revalidatePath("/time");
  revalidatePath("/today");
}

export async function sendClockRemindersAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can send reminders.");
  }

  const count = Number(formData.get("count") ?? 0);
  const reminderType = String(formData.get("reminderType") ?? "clock_in");

  await prisma.activityLog.create({
    data: {
      orgId: auth.orgId,
      actorId: auth.userId,
      action: "attendance.reminders.sent",
      metadata: { count, reminderType },
    },
  });

  revalidatePath("/attendance");
}

export async function createWorkerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can add workers.");
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "WORKER") as Role;
  const hourlyRate = Number(formData.get("hourlyRateDefault") ?? 0);

  if (!fullName || !email) {
    throw new Error("Name and email are required.");
  }

  await prisma.userProfile.create({
    data: {
      id: crypto.randomUUID(),
      orgId: auth.orgId,
      fullName,
      email,
      phone: phone || null,
      role,
      hourlyRateDefault: hourlyRate > 0 ? hourlyRate : null,
      isActive: true,
    },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/team");
  revalidatePath("/time");
}

export async function updateWorkerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can update workers.");
  }

  const workerId = String(formData.get("workerId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "WORKER") as Role;
  const hourlyRate = Number(formData.get("hourlyRateDefault") ?? 0);

  if (!workerId) return;

  await prisma.userProfile.update({
    where: { id: workerId },
    data: {
      fullName: fullName || undefined,
      phone: phone || null,
      role,
      hourlyRateDefault: hourlyRate > 0 ? hourlyRate : null,
    },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/team");
  revalidatePath("/time");
}

export async function setWorkerActiveAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can activate/deactivate workers.");
  }

  const workerId = String(formData.get("workerId") ?? "");
  const isActive = String(formData.get("isActive") ?? "true") === "true";
  if (!workerId) return;

  await prisma.userProfile.update({
    where: { id: workerId },
    data: { isActive },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/team");
  revalidatePath("/time");
}

export async function saveJobAssignmentsAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const selectedWorkerIds = formData
    .getAll("workerIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (!jobId) return;

  if (isDemoMode()) {
    revalidatePath("/team");
    revalidatePath("/time");
    revalidatePath(`/jobs/${jobId}`);
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can manage job assignments.");
  }

  await prisma.jobAssignment.deleteMany({
    where: {
      orgId: auth.orgId,
      jobId,
      userId: {
        notIn: selectedWorkerIds.length ? selectedWorkerIds : ["__none__"],
      },
    },
  });

  if (selectedWorkerIds.length > 0) {
    await prisma.jobAssignment.createMany({
      data: selectedWorkerIds.map((userId) => ({
        orgId: auth.orgId,
        jobId,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  await logActivity(auth.orgId, jobId, auth.userId, "job.assignments.saved", {
    assignedWorkerCount: selectedWorkerIds.length,
  });

  revalidatePath("/team");
  revalidatePath("/time");
  revalidatePath(`/jobs/${jobId}`);
}

export async function createShareLinkAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return crypto.randomUUID();
  }

  const auth = await requireAuth();

  const jobId = String(formData.get("jobId"));
  const type = String(formData.get("type")) as "TIMELINE" | "GALLERY";
  const selectedAssetIds = String(formData.get("selectedAssetIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const link = await prisma.shareLink.create({
    data: {
      orgId: auth.orgId,
      jobId,
      type,
      token: crypto.randomUUID(),
      selectedAssetIds,
      createdBy: auth.userId,
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "share.created", { type, shareId: link.id });
  revalidatePath(`/jobs/${jobId}`);
  return link.token;
}

export async function createPortalLinkAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    return crypto.randomUUID();
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));
  const customerId = String(formData.get("customerId"));

  const link = await prisma.portalLink.create({
    data: {
      orgId: auth.orgId,
      jobId,
      customerId,
      token: crypto.randomUUID(),
      createdBy: auth.userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  await logActivity(auth.orgId, jobId, auth.userId, "portal_link.created", { portalLinkId: link.id });
  revalidatePath(`/jobs/${jobId}`);
  return link.token;
}

export async function postPortalMessageAction(formData: FormData) {
  if (isDemoMode()) {
    const token = String(formData.get("token") ?? "");
    if (token) revalidatePath(`/portal/${token}`);
    return;
  }

  const token = String(formData.get("token"));
  const senderName = String(formData.get("senderName"));
  const senderEmail = String(formData.get("senderEmail") ?? "");
  const message = String(formData.get("message"));

  const link = await prisma.portalLink.findUniqueOrThrow({ where: { token } });

  await prisma.portalMessage.create({
    data: {
      orgId: link.orgId,
      jobId: link.jobId,
      senderName,
      senderEmail: senderEmail || null,
      message,
    },
  });

  await prisma.activityLog.create({
    data: {
      orgId: link.orgId,
      jobId: link.jobId,
      action: "portal.message",
      metadata: { senderName, senderEmail },
    },
  });

  revalidatePath(`/portal/${token}`);
}


