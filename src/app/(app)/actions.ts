"use server";

import { ExpenseCategory, InvoiceStatus, JobStatus, LeadSource, LeadStage, LineItemType, Prisma, Role } from "@prisma/client";
import { addDays, endOfDay, format, setHours, setMinutes, setSeconds, startOfDay, startOfWeek, subHours } from "date-fns";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getJobsPageAlerts } from "@/lib/data";
import {
  demoAddScheduleEvents,
  demoAssignWorkersToJob,
  demoClockInWorker,
  demoClockOutWorker,
  demoCreateWorker,
  demoDeleteScheduleEvent,
  demoJobAssignments,
  demoSetJobAssignments,
  demoUpdateJobServiceTags,
  demoUpdateScheduleEvent,
  demoSetWorkerActive,
  demoUpdateWorker,
  demoUsers,
  getDemoOrgId,
  getDemoUserById,
  isDemoMode,
} from "@/lib/demo";
import { ensureDefaultKpis } from "@/lib/kpis";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { inferServiceTagFromText, normalizeServiceTags } from "@/lib/service-tags";
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

function normalizeLeadPhone(value: string | null | undefined) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits : value.trim();
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

function readWeekStartFromMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>).weekStart;
  return typeof value === "string" ? value : "";
}

async function isPayrollWeekLocked(orgId: string, date: Date) {
  const weekStartKey = format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const logs = await prisma.activityLog.findMany({
    where: {
      orgId,
      action: {
        in: ["payroll.week.locked", "payroll.week.opened", "payroll.week.paid"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const latest = logs.find((log) => readWeekStartFromMetadata(log.metadata) === weekStartKey);
  return latest?.action === "payroll.week.locked" || latest?.action === "payroll.week.paid";
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

  const phone = normalizeLeadPhone(parsed.phone);
  const email = (parsed.email ?? "").trim().toLowerCase();
  const openStageFilter = [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.SITE_VISIT_SET, LeadStage.ESTIMATE_SENT];

  const dedupeCandidates =
    phone || email
      ? await prisma.lead.findMany({
          where: {
            orgId: auth.orgId,
            createdAt: { gte: subHours(new Date(), 12) },
            stage: { in: openStageFilter },
            OR: [
              ...(phone ? [{ phone }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        })
      : [];

  const existing = dedupeCandidates[0];

  const lead = existing
    ? await prisma.lead.update({
        where: { id: existing.id },
        data: {
          contactName: parsed.contactName || existing.contactName,
          phone: phone || existing.phone,
          email: email || existing.email,
          address: parsed.address || existing.address,
          serviceType: parsed.serviceType || existing.serviceType,
          source: parsed.source,
          notes: parsed.notes ? `${existing.notes ? `${existing.notes}\n` : ""}${parsed.notes}` : existing.notes,
        },
      })
    : await prisma.lead.create({
        data: {
          orgId: auth.orgId,
          contactName: parsed.contactName,
          phone: phone || null,
          email: email || null,
          address: parsed.address || null,
          serviceType: parsed.serviceType || null,
          source: parsed.source,
          notes: parsed.notes || null,
          stage: LeadStage.NEW,
        },
      });

  await logActivity(auth.orgId, null, auth.userId, existing ? "lead.deduped" : "lead.created", {
    leadId: lead.id,
    source: parsed.source,
  });
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function sendDailyOpsDigestAction() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owners and admins can send digests.");
  }
  if (isDemoMode()) return;

  const webhookUrl = process.env.DISCORD_MISSING_CLOCKINS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [alerts, missingClockIns] = await Promise.all([
    getJobsPageAlerts({ orgId: auth.orgId, role: auth.role, userId: auth.userId }),
    (async () => {
      const [settings, users, entries] = await Promise.all([
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        prisma.userProfile.findMany({ where: { orgId: auth.orgId, isActive: true }, select: { id: true, fullName: true } }),
        prisma.timeEntry.findMany({
          where: {
            job: { orgId: auth.orgId },
            start: { gte: todayStart },
          },
          select: { workerId: true, start: true },
        }),
      ]);

      const [hourText, minuteText] = (settings?.defaultClockInTime ?? "07:00").split(":");
      const scheduled = setSeconds(
        setMinutes(setHours(startOfDay(new Date()), Number(hourText || 7)), Number(minuteText || 0)),
        0,
      );
      const cutoff = scheduled.getTime() + (settings?.clockGraceMinutes ?? 10) * 60000;

      const workersWithOnTimeEntry = new Set(
        entries.filter((entry) => entry.start.getTime() <= cutoff).map((entry) => entry.workerId),
      );

      return users.filter((user) => !workersWithOnTimeEntry.has(user.id)).map((user) => user.fullName);
    })(),
  ]);

  const overdueCount = alerts.overdueTasks.length;
  const missingReceiptsCount = alerts.jobIdsWithMissingReceipts.length;

  const lines: string[] = [];
  lines.push(`Daily ops digest for ${format(new Date(), "MMM d, yyyy")}`);
  lines.push("");
  lines.push(`• Overdue tasks: ${overdueCount}`);
  lines.push(`• Jobs with missing receipts: ${missingReceiptsCount}`);
  lines.push(`• Workers missing clock-in: ${missingClockIns.length}`);
  if (missingClockIns.length > 0) {
    lines.push("");
    lines.push("Missing clock-in:");
    for (const name of missingClockIns) {
      lines.push(`- ${name}`);
    }
  }

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: lines.join("\n"),
    }),
  });
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

  // If a lead is being marked WON and it doesn't yet have a job, automatically
  // convert it to a Customer + Job instead of just updating the stage. This
  // keeps the lead pipeline in sync with jobs without requiring an extra click.
  if (stage === LeadStage.WON && !existing.jobId) {
    await convertLeadToJobInternal(auth, existing.id, "");
    revalidatePath("/leads");
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return;
  }

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

async function convertLeadToJobInternal(auth: { orgId: string; userId: string }, leadId: string, jobNameInput: string) {
  const lead = await prisma.lead.findFirstOrThrow({
    where: { id: leadId, orgId: auth.orgId },
  });

  // If this lead already has a job linked, skip creating another one.
  if (lead.jobId) {
    return prisma.job.findFirstOrThrow({ where: { id: lead.jobId, orgId: auth.orgId } });
  }

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

  const conversionDate = new Date();
  const conversionEndDate = addDays(conversionDate, 14);

  const job = await prisma.job.create({
    data: {
      orgId: auth.orgId,
      customerId: customer.id,
      jobName: jobNameInput || `${lead.serviceType || "New"} - ${lead.contactName}`,
      address: lead.address || "Address pending",
      status: JobStatus.ESTIMATE,
      categoryTags: [inferServiceTagFromText(lead.serviceType) ?? "general-remodeling", "lead-converted"],
      startDate: conversionDate,
      endDate: conversionEndDate,
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

  import("@/lib/ga4-server").then(({ sendGA4ConversionEvent }) =>
    sendGA4ConversionEvent({
      leadId: lead.id,
      jobId: job.id,
      contactName: lead.contactName,
      serviceType: lead.serviceType,
      utmSource: lead.utmSource ?? null,
      utmMedium: lead.utmMedium ?? null,
      utmCampaign: lead.utmCampaign ?? null,
    }).catch(() => {}),
  );

  return job;
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

  await convertLeadToJobInternal(auth, leadId, jobNameInput);

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
    const notes = `Imported from Joist CSV${statusRaw ? ` - status: ${statusRaw}` : ""}`;

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

  const customerIdRaw = String(formData.get("customerId") ?? "").trim();
  const newCustomerName = String(formData.get("newCustomerName") ?? "").trim();
  const newCustomerPhone = String(formData.get("newCustomerPhone") ?? "").trim();
  const newCustomerEmail = String(formData.get("newCustomerEmail") ?? "").trim();
  const newCustomerAddress = String(formData.get("newCustomerAddress") ?? "").trim();

  let customerId: string;

  if (customerIdRaw && z.string().uuid().safeParse(customerIdRaw).success) {
    customerId = customerIdRaw;
  } else if (newCustomerName.length > 0) {
    const customer = await prisma.customer.create({
      data: {
        orgId: auth.orgId,
        name: newCustomerName,
        phone: newCustomerPhone || null,
        email: newCustomerEmail || null,
        addresses: newCustomerAddress ? [{ label: "primary", value: newCustomerAddress }] : undefined,
      },
    });
    customerId = customer.id;
    await logActivity(auth.orgId, null, auth.userId, "customer.created", { name: newCustomerName });
  } else {
    throw new Error("Select an existing customer or enter a new client name.");
  }

  const schema = z.object({
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

  const jobAddress = String(formData.get("address") ?? "").trim();
  const parsed = schema.parse({
    jobName: formData.get("jobName"),
    address: jobAddress || (newCustomerName ? newCustomerAddress : ""),
    status: formData.get("status") ?? JobStatus.LEAD,
    tags: formData.get("tags") ?? "",
    startDate: formData.get("startDate") ?? "",
    endDate: formData.get("endDate") ?? "",
    estimatedLaborBudget: formData.get("estimatedLaborBudget") ?? undefined,
    estimatedMaterialsBudget: formData.get("estimatedMaterialsBudget") ?? undefined,
    estimatedTotalBudget: formData.get("estimatedTotalBudget") ?? undefined,
  });

  const selectedServiceTags = formData
    .getAll("serviceTags")
    .map((value) => String(value))
    .filter(Boolean);
  const fallbackCsvTags = parsed.tags
    ? parsed.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const tags = normalizeServiceTags([...selectedServiceTags, ...fallbackCsvTags]);
  const finalTags = tags.length > 0 ? tags : ["general-remodeling"];

  const job = await prisma.job.create({
    data: {
      orgId: auth.orgId,
      customerId,
      jobName: parsed.jobName,
      address: parsed.address,
      status: parsed.status,
      categoryTags: finalTags,
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
  const userId = String(formData.get("userId") ?? "");
  if (isDemoMode()) {
    if (jobId && userId) {
      demoAssignWorkersToJob({
        orgId: getDemoOrgId(),
        jobId,
        workerIds: [userId],
      });
    }
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    revalidatePath("/team");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can assign workers.");
  }

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

export async function updateJobServiceTagsAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const selected = formData
    .getAll("serviceTags")
    .map((value) => String(value))
    .filter(Boolean);
  const tags = normalizeServiceTags(selected);
  const finalTags = tags.length > 0 ? tags : ["general-remodeling"];

  if (!jobId) return;

  if (isDemoMode()) {
    demoUpdateJobServiceTags({ jobId, categoryTags: finalTags });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can update service tags.");
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      categoryTags: finalTags,
    },
  });

  await logActivity(auth.orgId, job.id, auth.userId, "job.service_tags.updated", {
    tags: finalTags,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
}

export async function createScheduleEventAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (isDemoMode()) {
    if (jobId && startAt && endAt) {
      demoAddScheduleEvents([
        {
          orgId: getDemoOrgId(),
          jobId,
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          notes: notes || null,
        },
      ]);
    }
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    revalidatePath("/jobs");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();

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
  revalidatePath("/attendance");
}

export async function updateScheduleEventAction(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const overrideConflicts = String(formData.get("overrideConflicts") ?? "") === "1";
  if (!eventId || !jobId || !startAt || !endAt) return;

  if (isDemoMode()) {
    demoUpdateScheduleEvent(eventId, {
      orgId: getDemoOrgId(),
      jobId,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      notes,
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/today");
    revalidatePath("/jobs");
    revalidatePath("/attendance");
    redirect(`/jobs/${jobId}#schedule`);
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return;

  const existing = await prisma.jobScheduleEvent.findFirst({
    where: { id: eventId, job: { orgId: auth.orgId } },
  });
  if (!existing) return;

  const newStart = new Date(startAt);
  const newEnd = new Date(endAt);

  // Prevent obvious double-booking: if any worker assigned to this job is already
  // scheduled on another job that overlaps this block, block the change.
  const assignedWorkers = await prisma.jobAssignment.findMany({
    where: { orgId: auth.orgId, jobId },
    select: { userId: true },
  });
  const workerIds = assignedWorkers.map((a) => a.userId);

  if (workerIds.length > 0) {
    const conflict = await prisma.jobScheduleEvent.findFirst({
      where: {
        id: { not: eventId },
        job: {
          orgId: auth.orgId,
          assignments: {
            some: {
              userId: { in: workerIds },
            },
          },
        },
        startAt: { lt: newEnd },
        endAt: { gt: newStart },
      },
      include: {
        job: { select: { id: true, jobName: true } },
      },
    });

    if (conflict && !overrideConflicts) {
      const params = new URLSearchParams();
      params.set("conflict", "1");
      params.set("conflictAction", "edit");
      params.set("conflictJobId", conflict.job.id);
      params.set("conflictJobName", conflict.job.jobName);
      params.set("conflictStart", conflict.startAt.toISOString());
      params.set("conflictEnd", conflict.endAt.toISOString());
      params.set("edit", eventId);
      params.set("editStartAt", startAt);
      params.set("editEndAt", endAt);
      if (notes) params.set("editNotes", notes);
      redirect(`/jobs/${jobId}?${params.toString()}#schedule`);
    }
  }

  await prisma.jobScheduleEvent.update({
    where: { id: eventId },
    data: {
      startAt: newStart,
      endAt: newEnd,
      notes,
    },
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/today");
  revalidatePath("/jobs");
  revalidatePath("/attendance");
  redirect(`/jobs/${jobId}#schedule`);
}

export async function deleteScheduleEventAction(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  if (!eventId) return;

  if (isDemoMode()) {
    demoDeleteScheduleEvent(eventId);
    if (jobId) {
      revalidatePath(`/jobs/${jobId}`);
      redirect(`/jobs/${jobId}#schedule`);
    }
    revalidatePath("/jobs");
    revalidatePath("/today");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return;

  const existing = await prisma.jobScheduleEvent.findFirst({
    where: { id: eventId, job: { orgId: auth.orgId } },
  });
  if (!existing) return;

  await prisma.jobScheduleEvent.delete({ where: { id: eventId } });
  revalidatePath(`/jobs/${existing.jobId}`);
  revalidatePath("/today");
  revalidatePath("/jobs");
  revalidatePath("/attendance");
  redirect(`/jobs/${existing.jobId}#schedule`);
}

function parseTimeHHMM(value: string): { hour: number; minute: number } {
  const [h, m] = (value || "").split(":").map(Number);
  return { hour: Number.isNaN(h) ? 8 : Math.max(0, Math.min(23, h)), minute: Number.isNaN(m) ? 0 : Math.max(0, Math.min(59, m)) };
}

export async function quickScheduleCrewAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const slot = String(formData.get("slot") ?? "FULL");
  const notes = String(formData.get("notes") ?? "");
  const customDate = String(formData.get("customDate") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "08:00");
  const endTime = String(formData.get("endTime") ?? "17:00");
  const overrideConflicts = String(formData.get("overrideConflicts") ?? "") === "1";
  let dates = formData
    .getAll("dates")
    .map((value) => String(value))
    .filter(Boolean);
  if (customDate) dates = [...new Set([...dates, customDate])];
  const workerIds = formData
    .getAll("workerIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (!jobId || dates.length === 0) return;

  const slotHours =
    slot === "CUSTOM"
      ? (() => {
          const s = parseTimeHHMM(startTime);
          const e = parseTimeHHMM(endTime);
          return { startHour: s.hour, startMinute: s.minute, endHour: e.hour, endMinute: e.minute };
        })()
      : slot === "AM"
        ? { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 }
        : slot === "PM"
          ? { startHour: 13, startMinute: 0, endHour: 17, endMinute: 0 }
          : { startHour: 8, startMinute: 0, endHour: 17, endMinute: 0 };

  if (isDemoMode()) {
    if (workerIds.length > 0) {
      demoAssignWorkersToJob({
        orgId: getDemoOrgId(),
        jobId,
        workerIds,
      });
    }
    const demoEvents = dates.map((dateText) => {
      const base = new Date(`${dateText}T00:00:00`);
      const startAt = new Date(base);
      startAt.setHours(slotHours.startHour, slotHours.startMinute, 0, 0);
      const endAt = new Date(base);
      endAt.setHours(slotHours.endHour, slotHours.endMinute, 0, 0);
      return {
        orgId: getDemoOrgId(),
        jobId,
        startAt,
        endAt,
        notes: notes || null,
      };
    });
    demoAddScheduleEvents(demoEvents);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/today");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can schedule crew.");
  }

  // Guardrail: prevent double-booking workers across jobs for the same time window.
  // For each date/slot, if any selected worker is already scheduled on a job that
  // overlaps this block, block the quick schedule.
  if (workerIds.length > 0) {
    for (const dateText of dates) {
      const base = new Date(`${dateText}T00:00:00`);
      const blockStart = new Date(base);
      blockStart.setHours(slotHours.startHour, slotHours.startMinute, 0, 0);
      const blockEnd = new Date(base);
      blockEnd.setHours(slotHours.endHour, slotHours.endMinute, 0, 0);

      const conflict = await prisma.jobScheduleEvent.findFirst({
        where: {
          job: {
            orgId: auth.orgId,
            assignments: {
              some: {
                userId: { in: workerIds },
              },
            },
          },
          startAt: { lt: blockEnd },
          endAt: { gt: blockStart },
        },
        include: {
          job: { select: { id: true, jobName: true } },
        },
      });

      if (conflict && !overrideConflicts) {
        const params = new URLSearchParams();
        params.set("conflict", "1");
        params.set("conflictAction", "quick");
        params.set("conflictJobId", conflict.job.id);
        params.set("conflictJobName", conflict.job.jobName);
        params.set("conflictStart", conflict.startAt.toISOString());
        params.set("conflictEnd", conflict.endAt.toISOString());
        params.set("slot", slot);
        params.set("startTime", startTime);
        params.set("endTime", endTime);
        if (notes) params.set("notes", notes);
        if (customDate) params.set("customDate", customDate);
        dates.forEach((date) => params.append("dates", date));
        workerIds.forEach((id) => params.append("workerIds", id));
        redirect(`/jobs/${jobId}?${params.toString()}#schedule`);
      }
    }
  }

  if (workerIds.length > 0) {
    await prisma.jobAssignment.createMany({
      data: workerIds.map((userId) => ({
        orgId: auth.orgId,
        jobId,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  const events = dates.map((dateText) => {
    const base = new Date(`${dateText}T00:00:00`);
    const startAt = new Date(base);
    startAt.setHours(slotHours.startHour, slotHours.startMinute, 0, 0);
    const endAt = new Date(base);
    endAt.setHours(slotHours.endHour, slotHours.endMinute, 0, 0);
    return {
      orgId: auth.orgId,
      jobId,
      startAt,
      endAt,
      notes: notes || null,
    };
  });

  await prisma.jobScheduleEvent.createMany({
    data: events,
  });

  await logActivity(auth.orgId, jobId, auth.userId, "job.quick_schedule.saved", {
    datesCount: dates.length,
    workersCount: workerIds.length,
    slot,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/today");
  revalidatePath("/attendance");
  revalidatePath("/team");
}

const FAR_FUTURE = new Date("9999-12-31T23:59:59Z");

async function findOverlappingTimeEntry(
  orgId: string,
  workerId: string,
  start: Date,
  end: Date | null,
  excludeEntryId?: string,
): Promise<{ jobName: string; start: Date; end: Date | null } | null> {
  const endOrMax = end ?? FAR_FUTURE;
  const existing = await prisma.timeEntry.findFirst({
    where: {
      workerId,
      job: { orgId },
      id: excludeEntryId ? { not: excludeEntryId } : undefined,
      start: { lt: endOrMax },
      OR: [{ end: null }, { end: { gt: start } }],
    },
    include: { job: { select: { jobName: true } } },
    orderBy: { start: "asc" },
  });
  if (!existing) return null;
  return {
    jobName: existing.job.jobName,
    start: existing.start,
    end: existing.end,
  };
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
  const startAt = new Date(parsed.start);
  const endAt = parsed.end ? new Date(parsed.end) : null;

  if (await isPayrollWeekLocked(auth.orgId, startAt)) {
    throw new Error("Payroll week is locked. Reopen the week to add/edit time.");
  }

  const overlap = await findOverlappingTimeEntry(auth.orgId, workerId, startAt, endAt);
  if (overlap) {
    const other = overlap.end ? format(overlap.end, "h:mm a") : "…";
    throw new Error(
      `Conflict — not allowed. This employee already has time on "${overlap.jobName}" (${format(overlap.start, "h:mm a")} – ${other}) for this period. An employee cannot be at two jobs at the same time.`,
    );
  }

  const worker = await prisma.userProfile.findUniqueOrThrow({ where: { id: workerId } });
  const hourlyRate = toNumber(worker.hourlyRateDefault) || 35;

  const entry = await prisma.timeEntry.create({
    data: {
      jobId: parsed.jobId,
      workerId,
      date: startAt,
      start: startAt,
      end: endAt,
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
  revalidatePath("/attendance");
  revalidatePath("/today");
}

export async function startTimerAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  const jobId = String(formData.get("jobId"));
  if (!jobId) return;

  const now = new Date();
  if (await isPayrollWeekLocked(auth.orgId, now)) {
    throw new Error("Payroll week is locked. Reopen the week to start new timers.");
  }

  const active = await prisma.timeEntry.findFirst({
    where: { workerId: auth.userId, end: null },
  });

  if (active) {
    throw new Error("You already have a running timer.");
  }

  const worker = await prisma.userProfile.findUniqueOrThrow({ where: { id: auth.userId } });

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
  revalidatePath("/attendance");
  revalidatePath("/today");
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
  revalidatePath("/attendance");
  revalidatePath("/today");
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

export async function sendInvoiceAction(formData: FormData) {
  if (isDemoMode()) {
    const jobId = String(formData.get("jobId") ?? "");
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/accounting");
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  if (!invoiceId) return;

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { job: true },
  });

  const sent = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: invoice.status === InvoiceStatus.PAID ? InvoiceStatus.PAID : InvoiceStatus.SENT,
      sentAt: invoice.sentAt ?? new Date(),
      dueDate: dueDateRaw ? new Date(dueDateRaw) : invoice.dueDate,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.orgId,
      entityType: "INVOICE",
      entityId: sent.id,
      actorId: auth.userId,
      event: "sent",
      payload: { sentAt: (sent.sentAt ?? new Date()).toISOString(), dueDate: sent.dueDate?.toISOString() ?? null },
    },
  });

  await logActivity(auth.orgId, sent.jobId, auth.userId, "invoice.sent", { invoiceId: sent.id });
  revalidatePath(`/jobs/${sent.jobId}`);
  revalidatePath("/accounting");
  revalidatePath("/today");
  revalidatePath("/dashboard");
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
  } else if (payment.invoice.status === InvoiceStatus.DRAFT) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.SENT,
        sentAt: payment.invoice.sentAt ?? new Date(),
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

  const startAt = new Date(start);
  const endAt = end ? new Date(end) : null;
  if (await isPayrollWeekLocked(auth.orgId, startAt)) {
    throw new Error("Payroll week is locked. Reopen the week to edit time.");
  }

  const overlap = await findOverlappingTimeEntry(auth.orgId, entry.workerId, startAt, endAt, timeEntryId);
  if (overlap) {
    const other = overlap.end ? format(overlap.end, "h:mm a") : "…";
    throw new Error(
      `Conflict — not allowed. This employee already has time on "${overlap.jobName}" (${format(overlap.start, "h:mm a")} – ${other}) for this period. An employee cannot be at two jobs at the same time.`,
    );
  }

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: {
      start: startAt,
      end: endAt,
      date: startAt,
      breakMinutes,
      notes: notes || null,
    },
  });

  await logActivity(auth.orgId, entry.jobId, auth.userId, "time.updated", { timeEntryId });
  revalidatePath("/time");
  revalidatePath(`/jobs/${entry.jobId}`);
  revalidatePath("/attendance");
  revalidatePath("/today");
}

export async function deleteTimeEntryAction(formData: FormData) {
  if (isDemoMode()) {
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  const timeEntryId = String(formData.get("timeEntryId") ?? "");
  if (!timeEntryId) return;

  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });

  if (await isPayrollWeekLocked(auth.orgId, entry.start)) {
    throw new Error("Payroll week is locked. Reopen the week to delete time.");
  }

  if (entry.workerId !== auth.userId && !canManageOrg(auth.role)) {
    throw new Error("You do not have permission to delete this time entry.");
  }

  await prisma.timeEntry.delete({ where: { id: timeEntryId } });

  await logActivity(auth.orgId, entry.jobId, auth.userId, "time.deleted", { timeEntryId });
  revalidatePath("/time");
  if (entry.jobId) revalidatePath(`/jobs/${entry.jobId}`);
  revalidatePath("/attendance");
  revalidatePath("/today");
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
  const discordClockInAlertsEnabled =
    formData.get("discordClockInAlertsEnabled") === "on" || formData.get("gpsTimeTrackingEnabled") === "on";

  await prisma.organizationSetting.upsert({
    where: { orgId: auth.orgId },
    update: {
      workerCanEditOwnTimeSameDay: formData.get("workerCanEditOwnTimeSameDay") === "on",
      gpsTimeTrackingEnabled: discordClockInAlertsEnabled,
      defaultClockInTime,
      clockGraceMinutes,
    },
    create: {
      orgId: auth.orgId,
      workerCanEditOwnTimeSameDay: formData.get("workerCanEditOwnTimeSameDay") === "on",
      gpsTimeTrackingEnabled: discordClockInAlertsEnabled,
      defaultClockInTime,
      clockGraceMinutes,
    },
  });

  revalidatePath("/settings/targets");
  revalidatePath("/attendance");
}

export async function ownerClockInEmployeeAction(formData: FormData) {
  const workerId = String(formData.get("workerId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  if (!workerId || !jobId) return;

  if (isDemoMode()) {
    const worker = getDemoUserById(workerId);
    demoClockInWorker({
      workerId,
      jobId,
      hourlyRateLoaded: worker?.hourlyRateDefault ?? 35,
    });
    revalidatePath("/attendance");
    revalidatePath("/time");
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can clock in employees.");
  }

  const now = new Date();
  if (await isPayrollWeekLocked(auth.orgId, now)) {
    throw new Error("Payroll week is locked. Reopen the week to clock employees in.");
  }

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
  const workerId = String(formData.get("workerId") ?? "");
  if (!workerId) return;

  if (isDemoMode()) {
    demoClockOutWorker(workerId);
    revalidatePath("/attendance");
    revalidatePath("/time");
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can clock out employees.");
  }

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

export async function sendMissingClockInsAlertAction() {
  if (isDemoMode()) {
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can send missing clock-in alerts.");
  }

  const [settings, users, entries] = await Promise.all([
    prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
    prisma.userProfile.findMany({
      where: { orgId: auth.orgId, isActive: true },
      select: { id: true, fullName: true },
    }),
    prisma.timeEntry.findMany({
      where: {
        job: { orgId: auth.orgId },
        start: { gte: startOfDay(new Date()) },
      },
      select: { workerId: true, start: true },
    }),
  ]);

  const [hourText, minuteText] = (settings?.defaultClockInTime ?? "07:00").split(":");
  const scheduled = setSeconds(
    setMinutes(setHours(startOfDay(new Date()), Number(hourText || 7)), Number(minuteText || 0)),
    0,
  );
  const cutoff = scheduled.getTime() + (settings?.clockGraceMinutes ?? 10) * 60000;

  const workersWithOnTimeEntry = new Set(
    entries.filter((entry) => entry.start.getTime() <= cutoff).map((entry) => entry.workerId),
  );
  const missingWorkers = users.filter((user) => !workersWithOnTimeEntry.has(user.id));

  if (missingWorkers.length === 0) {
    return;
  }

  const webhookUrl = process.env.DISCORD_MISSING_CLOCKINS_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    // No webhook configured; quietly return.
    return;
  }

  const todayLabel = format(new Date(), "EEE MMM d");
  const names = missingWorkers.map((u) => u.fullName).join(", ");
  const content = [
    `⏰ Missing clock-ins for ${todayLabel}`,
    ``,
    `Default clock-in: ${settings?.defaultClockInTime ?? "07:00"} (+${settings?.clockGraceMinutes ?? 10} min grace)`,
    `Missing (${missingWorkers.length}): ${names}`,
  ].join("\n");

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function ownerClockInCrewForJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  if (isDemoMode()) {
    const assignments = demoJobAssignments.filter((a) => a.jobId === jobId);
    for (const assignment of assignments) {
      demoClockInWorker({
        workerId: assignment.userId,
        jobId,
        hourlyRateLoaded: demoUsers.find((u) => u.id === assignment.userId)?.hourlyRateDefault ?? 35,
      });
    }
    revalidatePath("/attendance");
    revalidatePath("/time");
    revalidatePath("/today");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can clock in employees.");
  }

  const now = new Date();
  if (await isPayrollWeekLocked(auth.orgId, now)) {
    throw new Error("Payroll week is locked. Reopen the week to clock employees in.");
  }

  // Find crew assigned to this job.
  const assignments = await prisma.jobAssignment.findMany({
    where: { orgId: auth.orgId, jobId },
    select: { userId: true },
  });
  const workerIds = assignments.map((a) => a.userId);
  if (workerIds.length === 0) {
    throw new Error("No workers are assigned to this job yet. Assign crew first, then clock them in.");
  }

  // Skip anyone who already has an active timer.
  const activeEntries = await prisma.timeEntry.findMany({
    where: {
      workerId: { in: workerIds },
      end: null,
      job: { orgId: auth.orgId },
    },
    select: { workerId: true },
  });
  const activeWorkerIds = new Set(activeEntries.map((e) => e.workerId));
  const toClockIn = workerIds.filter((id) => !activeWorkerIds.has(id));
  if (toClockIn.length === 0) {
    throw new Error("All assigned workers on this job already have a running timer.");
  }

  const workers = await prisma.userProfile.findMany({
    where: { orgId: auth.orgId, id: { in: toClockIn } },
  });
  const workerById = new Map(workers.map((w) => [w.id, w]));

  for (const workerId of toClockIn) {
    const worker = workerById.get(workerId);
    await prisma.timeEntry.create({
      data: {
        jobId,
        workerId,
        date: now,
        start: now,
        breakMinutes: 0,
        hourlyRateLoaded: worker ? toNumber(worker.hourlyRateDefault) || 35 : 35,
        notes: "Owner crew clock-in",
      },
    });
  }

  await logActivity(auth.orgId, jobId, auth.userId, "time.owner.clock_in_crew", {
    workerIds: toClockIn,
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

  const webhook = (process.env.ATTENDANCE_REMINDER_WEBHOOK_URL ?? "").trim();
  if (webhook && count > 0) {
    fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `FieldFlow reminders sent: ${count} (${reminderType})`,
      }),
    }).catch(() => {});
  }

  revalidatePath("/attendance");
}

export async function setPayrollWeekStateAction(formData: FormData) {
  const weekStart = String(formData.get("weekStart") ?? "").trim();
  const state = String(formData.get("state") ?? "LOCKED").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim();

  if (!weekStart) return;

  if (isDemoMode()) {
    revalidatePath("/time");
    revalidatePath("/today");
    revalidatePath("/reports");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can change payroll week state.");
  }

  const event =
    state === "PAID"
      ? "payroll.week.paid"
      : state === "OPEN"
        ? "payroll.week.opened"
        : "payroll.week.locked";

  await prisma.activityLog.create({
    data: {
      orgId: auth.orgId,
      actorId: auth.userId,
      action: event,
      metadata: {
        weekStart,
        note: note || null,
      },
    },
  });

  revalidatePath("/time");
  revalidatePath("/today");
  revalidatePath("/reports");
}

export async function createWorkerAction(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "WORKER") as Role;
  const hourlyRate = Number(formData.get("hourlyRateDefault") ?? 0);

  if (!fullName || !email) {
    throw new Error("Name and email are required.");
  }

  if (isDemoMode()) {
    demoCreateWorker({
      fullName,
      email,
      phone: phone || null,
      role,
      hourlyRateDefault: hourlyRate > 0 ? hourlyRate : null,
    });
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    revalidatePath("/attendance");
    revalidatePath("/time");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can add workers.");
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
  const workerId = String(formData.get("workerId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "WORKER") as Role;
  const hourlyRate = Number(formData.get("hourlyRateDefault") ?? 0);

  if (!workerId) return;

  if (isDemoMode()) {
    demoUpdateWorker({
      workerId,
      fullName: fullName || undefined,
      phone: phone || null,
      role,
      hourlyRateDefault: hourlyRate > 0 ? hourlyRate : null,
    });
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    revalidatePath("/time");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can update workers.");
  }

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
  const workerId = String(formData.get("workerId") ?? "");
  const isActive = String(formData.get("isActive") ?? "true") === "true";
  if (!workerId) return;

  if (isDemoMode()) {
    demoSetWorkerActive(workerId, isActive);
    revalidatePath("/settings/targets");
    revalidatePath("/team");
    revalidatePath("/time");
    revalidatePath("/attendance");
    return;
  }

  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    throw new Error("Only owner/admin can activate/deactivate workers.");
  }

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
    demoSetJobAssignments({
      orgId: getDemoOrgId(),
      jobId,
      workerIds: selectedWorkerIds,
    });
    revalidatePath("/team");
    revalidatePath("/time");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/attendance");
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
  revalidatePath("/attendance");
  revalidatePath("/today");
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

export async function togglePortfolioAction(formData: FormData) {
  const auth = await requireAuth();
  const assetId = String(formData.get("assetId"));

  if (isDemoMode()) {
    return;
  }

  const asset = await prisma.fileAsset.findFirst({
    where: { id: assetId, job: { orgId: auth.orgId } },
    select: {
      id: true,
      isPortfolio: true,
      jobId: true,
      storageKey: true,
      job: {
        select: { categoryTags: true },
      },
    },
  });

  if (!asset) return;

  const newValue = !asset.isPortfolio;
  if (newValue) {
    const serviceTags = normalizeServiceTags(asset.job.categoryTags);
    if (serviceTags.length === 0) {
      throw new Error("Add at least one controlled service tag on the job before portfolio publish.");
    }
  }

  await prisma.fileAsset.update({
    where: { id: assetId },
    data: {
      isPortfolio: newValue,
      ...(newValue ? { isClientVisible: true } : {}),
    },
  });

  await prisma.activityLog.create({
    data: {
      orgId: auth.orgId,
      jobId: asset.jobId,
      actorId: auth.userId,
      action: newValue ? "file.portfolio.added" : "file.portfolio.removed",
      metadata: { fileAssetId: assetId },
    },
  });

  const { onPortfolioPublish, onPortfolioUnpublish } = await import("@/lib/portfolio-publish");
  if (newValue) {
    onPortfolioPublish(assetId, asset.storageKey).catch(() => {});
  } else {
    onPortfolioUnpublish(asset.storageKey).catch(() => {});
  }

  revalidatePath(`/jobs/${asset.jobId}`);
}
