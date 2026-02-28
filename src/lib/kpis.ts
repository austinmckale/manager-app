import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getLaborCost } from "@/lib/time-entry";
import { toNumber } from "@/lib/utils";

export const KPI_KEYS = {
  grossMarginPercent: "gross_margin_percent",
  laborPercentRevenue: "labor_percent_revenue",
  materialsPercentRevenue: "materials_percent_revenue",
  leadToWinRate: "lead_to_win_rate",
} as const;

export async function ensureDefaultKpis() {
  if (isDemoMode()) return;

  const defaults = [
    {
      kpiKey: KPI_KEYS.grossMarginPercent,
      name: "Gross margin %",
      description: "Completed jobs gross margin percentage.",
      unit: "%",
    },
    {
      kpiKey: KPI_KEYS.laborPercentRevenue,
      name: "Labor % of revenue",
      description: "Labor cost divided by revenue.",
      unit: "%",
    },
    {
      kpiKey: KPI_KEYS.materialsPercentRevenue,
      name: "Materials % of revenue",
      description: "Materials spend divided by revenue.",
      unit: "%",
    },
    {
      kpiKey: KPI_KEYS.leadToWinRate,
      name: "Lead-to-win rate",
      description: "Won leads divided by won + lost leads.",
      unit: "%",
    },
  ];

  for (const kpi of defaults) {
    await prisma.kpi.upsert({
      where: { kpiKey: kpi.kpiKey },
      update: kpi,
      create: kpi,
    });
  }
}

export async function computeDashboardKpis(orgId: string) {
  if (isDemoMode()) {
    return {
      grossMarginPercent: 32.4,
      laborPercentRevenue: 24.2,
      materialsPercentRevenue: 28.7,
      leadToWinRate: 61.5,
      leadsContactedWithin24hPercent: 72.4,
      outstandingInvoicesTotal: 12450,
      outstandingInvoicesCount: 3,
      averageDaysToPayment: 19.4,
      targets: {
        grossMarginPercent: null,
        laborPercentRevenue: null,
        materialsPercentRevenue: null,
        leadToWinRate: null,
      },
    };
  }

  const now = new Date();
  const periodStart = startOfMonth(subMonths(now, 2));
  const periodEnd = endOfMonth(now);

  const [jobs, leads, invoices, payments, targets] = await Promise.all([
    prisma.job.findMany({
      where: {
        orgId,
        status: "COMPLETED",
        updatedAt: { gte: periodStart, lte: periodEnd },
      },
      include: {
        timeEntries: true,
        expenses: true,
        invoices: true,
        changeOrders: true,
        estimates: true,
      },
    }),
    prisma.lead.findMany({
      where: { orgId, createdAt: { gte: periodStart, lte: periodEnd } },
      select: { stage: true, createdAt: true, updatedAt: true },
    }),
    prisma.invoice.findMany({
      where: { job: { orgId } },
      select: { id: true, status: true, total: true, sentAt: true, paidAt: true },
    }),
    prisma.payment.findMany({
      where: { invoice: { job: { orgId } } },
      select: { date: true, amount: true, invoiceId: true },
    }),
    prisma.kpiTarget.findMany({
      where: { orgId },
      orderBy: { effectiveDate: "desc" },
    }),
  ]);

  let revenue = 0;
  let labor = 0;
  let materials = 0;

  for (const job of jobs) {
    const jobRevenue = job.invoices
      .filter((invoice) => ["SENT", "PAID", "OVERDUE"].includes(invoice.status))
      .reduce((acc, invoice) => acc + toNumber(invoice.total), 0);

    revenue += jobRevenue;

    for (const entry of job.timeEntries) {
      labor += getLaborCost(entry);
    }

    for (const expense of job.expenses) {
      if (expense.category === "MATERIALS") {
        materials += toNumber(expense.amount);
      }
    }
  }

  const totalCost = labor + materials;
  const grossMarginPercent = revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : 0;
  const laborPercentRevenue = revenue > 0 ? (labor / revenue) * 100 : 0;
  const materialsPercentRevenue = revenue > 0 ? (materials / revenue) * 100 : 0;

  const wonLeads = leads.filter((lead) => lead.stage === "WON").length;
  const lostLeads = leads.filter((lead) => lead.stage === "LOST").length;
  const leadToWinRate = wonLeads + lostLeads > 0 ? (wonLeads / (wonLeads + lostLeads)) * 100 : 0;
  const leadsContactedWithin24hPercent =
    leads.length > 0
      ? (leads.filter((lead) => {
          if (lead.stage === "NEW") return false;
          const hours = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / 3600000;
          return hours <= 24;
        }).length /
          leads.length) *
        100
      : 0;

  const outstandingInvoices = invoices.filter((invoice) => invoice.status === "SENT" || invoice.status === "OVERDUE");
  const outstandingTotal = outstandingInvoices.reduce((acc, invoice) => acc + toNumber(invoice.total), 0);

  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const daysToPay: number[] = [];

  for (const payment of payments) {
    const invoice = invoiceById.get(payment.invoiceId);
    if (!invoice?.sentAt) continue;
    const days = (payment.date.getTime() - invoice.sentAt.getTime()) / 86400000;
    if (days >= 0) daysToPay.push(days);
  }

  const averageDaysToPayment = daysToPay.length
    ? daysToPay.reduce((acc, value) => acc + value, 0) / daysToPay.length
    : 0;

  const getTarget = (kpiKey: string) => targets.find((target) => target.kpiKey === kpiKey);

  return {
    grossMarginPercent,
    laborPercentRevenue,
    materialsPercentRevenue,
    leadToWinRate,
    leadsContactedWithin24hPercent,
    outstandingInvoicesTotal: outstandingTotal,
    outstandingInvoicesCount: outstandingInvoices.length,
    averageDaysToPayment,
    targets: {
      grossMarginPercent: getTarget(KPI_KEYS.grossMarginPercent),
      laborPercentRevenue: getTarget(KPI_KEYS.laborPercentRevenue),
      materialsPercentRevenue: getTarget(KPI_KEYS.materialsPercentRevenue),
      leadToWinRate: getTarget(KPI_KEYS.leadToWinRate),
    },
  };
}
