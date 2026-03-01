import { PrismaClient, JobStatus, Role, ExpenseCategory, InvoiceStatus, EstimateStatus, ChangeOrderStatus, LeadSource, LeadStage, LineItemType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL not set. Skipping seed.");
    return;
  }

  const orgId = "00000000-0000-0000-0000-000000000001";
  const ownerId = "00000000-0000-0000-0000-000000000001";
  const workerId = "00000000-0000-0000-0000-000000000002";

  await prisma.organization.upsert({
    where: { id: orgId },
    update: { name: "FieldFlow Demo Contracting" },
    create: {
      id: orgId,
      name: "FieldFlow Demo Contracting",
      settings: {
        create: {
          workerCanEditOwnTimeSameDay: true,
          gpsTimeTrackingEnabled: false,
          discordScheduleDigestEnabled: false,
          discordScheduleDigestTime: "06:00",
          defaultClockInTime: "07:00",
          clockGraceMinutes: 10,
        },
      },
    },
  });

  await prisma.userProfile.upsert({
    where: { id: ownerId },
    update: { fullName: "Owner Admin", role: Role.OWNER, orgId },
    create: {
      id: ownerId,
      orgId,
      fullName: "Owner Admin",
      email: "owner@demo.local",
      role: Role.OWNER,
      hourlyRateDefault: 65,
    },
  });

  await prisma.userProfile.upsert({
    where: { id: workerId },
    update: { fullName: "Crew Lead", role: Role.WORKER, orgId },
    create: {
      id: workerId,
      orgId,
      fullName: "Crew Lead",
      email: "crew@demo.local",
      role: Role.WORKER,
      hourlyRateDefault: 38,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: "10000000-0000-0000-0000-000000000001" },
    update: { name: "Morris Family", orgId },
    create: {
      id: "10000000-0000-0000-0000-000000000001",
      orgId,
      name: "Morris Family",
      phone: "555-201-4401",
      email: "morris@example.com",
      leadSource: "Referral",
      addresses: [{ label: "primary", value: "1024 River St, Austin, TX" }],
      notes: "Insurance water damage rebuild project",
    },
  });

  const job = await prisma.job.upsert({
    where: { id: "20000000-0000-0000-0000-000000000001" },
    update: { status: JobStatus.IN_PROGRESS, orgId, customerId: customer.id },
    create: {
      id: "20000000-0000-0000-0000-000000000001",
      orgId,
      customerId: customer.id,
      jobName: "Kitchen Water Damage Rebuild",
      address: "1024 River St, Austin, TX",
      status: JobStatus.IN_PROGRESS,
      categoryTags: ["kitchen", "water damage", "insurance"],
      startDate: new Date(),
      estimatedLaborBudget: 5400,
      estimatedMaterialsBudget: 4200,
      estimatedTotalBudget: 11200,
    },
  });

  await prisma.jobAssignment.upsert({
    where: {
      jobId_userId: {
        jobId: job.id,
        userId: workerId,
      },
    },
    update: {},
    create: {
      id: "21000000-0000-0000-0000-000000000001",
      orgId,
      jobId: job.id,
      userId: workerId,
    },
  });

  await prisma.lead.upsert({
    where: { id: "70000000-0000-0000-0000-000000000001" },
    update: {
      orgId,
      contactName: "Samantha Reed",
      source: LeadSource.WEBSITE_FORM,
      stage: LeadStage.ESTIMATE_SENT,
      serviceType: "Water damage mitigation",
    },
    create: {
      id: "70000000-0000-0000-0000-000000000001",
      orgId,
      contactName: "Samantha Reed",
      phone: "555-101-9090",
      email: "samantha@example.com",
      address: "14 Cedar St, Austin, TX",
      source: LeadSource.WEBSITE_FORM,
      stage: LeadStage.ESTIMATE_SENT,
      serviceType: "Water damage mitigation",
      notes: "Submitted from website intake form",
    },
  });

  await prisma.lead.upsert({
    where: { id: "70000000-0000-0000-0000-000000000002" },
    update: {
      orgId,
      contactName: "John Ortiz",
      source: LeadSource.PHONE_CALL,
      stage: LeadStage.LOST,
      lostReason: "price",
    },
    create: {
      id: "70000000-0000-0000-0000-000000000002",
      orgId,
      contactName: "John Ortiz",
      phone: "555-777-1212",
      address: "800 North Ave, Austin, TX",
      source: LeadSource.PHONE_CALL,
      stage: LeadStage.LOST,
      serviceType: "Bathroom remodel",
      lostReason: "price",
    },
  });

  await prisma.jobScheduleEvent.create({
    data: {
      id: "22000000-0000-0000-0000-000000000001",
      orgId,
      jobId: job.id,
      startAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
      endAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
      notes: "Drywall install + prep",
    },
  }).catch(() => undefined);

  const estimate = await prisma.estimate.upsert({
    where: { id: "30000000-0000-0000-0000-000000000001" },
    update: { jobId: job.id, total: 14800, status: EstimateStatus.APPROVED },
    create: {
      id: "30000000-0000-0000-0000-000000000001",
      jobId: job.id,
      subtotal: 13200,
      tax: 600,
      margin: 1000,
      total: 14800,
      status: EstimateStatus.APPROVED,
      sentAt: new Date(),
      approvedAt: new Date(),
    },
  });

  await prisma.estimateLineItem.createMany({
    data: [
      {
        estimateId: estimate.id,
        type: LineItemType.LABOR,
        description: "Demolition and dry-out labor",
        quantity: 24,
        unitPrice: 85,
        total: 2040,
      },
      {
        estimateId: estimate.id,
        type: LineItemType.MATERIAL,
        description: "Drywall, insulation, paint, trim",
        quantity: 1,
        unitPrice: 4200,
        total: 4200,
      },
    ],
    skipDuplicates: true,
  });

  const changeOrder = await prisma.changeOrder.upsert({
    where: { id: "31000000-0000-0000-0000-000000000001" },
    update: { jobId: job.id, total: 900, status: ChangeOrderStatus.APPROVED },
    create: {
      id: "31000000-0000-0000-0000-000000000001",
      jobId: job.id,
      description: "Additional cabinet base rebuild",
      total: 900,
      status: ChangeOrderStatus.APPROVED,
      approvedAt: new Date(),
    },
  });

  await prisma.changeOrderLineItem.createMany({
    data: [
      {
        changeOrderId: changeOrder.id,
        type: LineItemType.MATERIAL,
        description: "Cabinet base material + finish",
        quantity: 1,
        unitPrice: 900,
        total: 900,
      },
    ],
    skipDuplicates: true,
  });

  const invoice = await prisma.invoice.upsert({
    where: { id: "32000000-0000-0000-0000-000000000001" },
    update: { jobId: job.id, total: 15700, status: InvoiceStatus.SENT },
    create: {
      id: "32000000-0000-0000-0000-000000000001",
      jobId: job.id,
      basedOnEstimateId: estimate.id,
      subtotal: 14100,
      tax: 600,
      total: 15700,
      status: InvoiceStatus.SENT,
      sentAt: new Date(),
    },
  });

  await prisma.invoiceLineItem.createMany({
    data: [
      {
        invoiceId: invoice.id,
        type: LineItemType.LABOR,
        description: "Demolition and rebuild labor",
        quantity: 1,
        unitPrice: 6200,
        total: 6200,
      },
      {
        invoiceId: invoice.id,
        type: LineItemType.MATERIAL,
        description: "Materials and finish",
        quantity: 1,
        unitPrice: 7900,
        total: 7900,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.timeEntry.create({
    data: {
      id: "40000000-0000-0000-0000-000000000001",
      jobId: job.id,
      workerId,
      date: new Date(),
      start: new Date(Date.now() - 1000 * 60 * 60 * 6),
      end: new Date(Date.now() - 1000 * 60 * 60 * 1),
      breakMinutes: 30,
      hourlyRateLoaded: 38,
      notes: "Drywall and prep",
    },
  }).catch(() => undefined);

  await prisma.expense.create({
    data: {
      id: "50000000-0000-0000-0000-000000000001",
      jobId: job.id,
      vendor: "Home Depot",
      category: ExpenseCategory.MATERIALS,
      amount: 320.15,
      date: new Date(),
      notes: "Drywall, screws, primer",
    },
  }).catch(() => undefined);

  await prisma.task.create({
    data: {
      id: "60000000-0000-0000-0000-000000000001",
      jobId: job.id,
      assignedTo: workerId,
      title: "Final sand and texture",
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2),
      status: "TODO",
      notes: "Client requested smooth finish",
    },
  }).catch(() => undefined);

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

