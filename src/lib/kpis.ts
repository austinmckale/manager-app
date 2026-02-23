import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export const KPI_KEYS = {
  grossMarginPercent: "gross_margin_percent",
  laborPercentRevenue: "labor_percent_revenue",
  materialsPercentRevenue: "materials_percent_revenue",
  estimateToWinRate: "estimate_to_win_rate",
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
      kpiKey: KPI_KEYS.estimateToWinRate,
      name: "Estimate-to-win rate",
      description: "Approved estimates divided by sent estimates.",
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
      estimateToWinRate: 61.5,
      outstandingInvoicesTotal: 12450,
      outstandingInvoicesCount: 3,
      averageDaysToPayment: 19.4,
      targets: {
        grossMarginPercent: null,
        laborPercentRevenue: null,
        materialsPercentRevenue: null,
        estimateToWinRate: null,
      },
    };
  }

  const now = new Date();
  const periodStart = startOfMonth(subMonths(now, 2));
  const periodEnd = endOfMonth(now);

  const [jobs, estimates, invoices, payments, targets] = await Promise.all([
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
    prisma.estimate.findMany({
      where: { job: { orgId }, createdAt: { gte: periodStart, lte: periodEnd } },
      select: { status: true },
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
      if (!entry.end) continue;
      const hours = Math.max(0, (entry.end.getTime() - entry.start.getTime()) / 3600000 - entry.breakMinutes / 60);
      labor += hours * toNumber(entry.hourlyRateLoaded);
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

  const sentEstimates = estimates.filter((estimate) => ["SENT", "APPROVED", "DECLINED"].includes(estimate.status)).length;
  const approvedEstimates = estimates.filter((estimate) => estimate.status === "APPROVED").length;
  const estimateToWinRate = sentEstimates > 0 ? (approvedEstimates / sentEstimates) * 100 : 0;

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
    estimateToWinRate,
    outstandingInvoicesTotal: outstandingTotal,
    outstandingInvoicesCount: outstandingInvoices.length,
    averageDaysToPayment,
    targets: {
      grossMarginPercent: getTarget(KPI_KEYS.grossMarginPercent),
      laborPercentRevenue: getTarget(KPI_KEYS.laborPercentRevenue),
      materialsPercentRevenue: getTarget(KPI_KEYS.materialsPercentRevenue),
      estimateToWinRate: getTarget(KPI_KEYS.estimateToWinRate),
    },
  };
}
