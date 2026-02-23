import { ExpenseCategory, JobStatus } from "@prisma/client";
import { toNumber } from "@/lib/utils";

export type JobCostingInput = {
  status: JobStatus;
  estimates: Array<{ total: unknown; status: string }>;
  changeOrders: Array<{ total: unknown; status: string }>;
  invoices: Array<{ total: unknown; status: string }>;
  timeEntries: Array<{ start: Date; end: Date | null; breakMinutes: number; hourlyRateLoaded: unknown }>;
  expenses: Array<{ amount: unknown; category: ExpenseCategory }>;
  estimatedLaborBudget?: unknown;
  estimatedMaterialsBudget?: unknown;
  estimatedTotalBudget?: unknown;
};

export type JobCostingSummary = {
  laborHours: number;
  laborCost: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  expensesTotal: number;
  totalCost: number;
  revenue: number;
  grossProfit: number;
  grossMarginPercent: number;
  costHealth: {
    labor: number;
    materials: number;
    total: number;
  };
};

export function computeJobCosting(input: JobCostingInput): JobCostingSummary {
  let laborHours = 0;
  let laborCost = 0;

  for (const entry of input.timeEntries) {
    if (!entry.end) continue;
    const minutes = (entry.end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes;
    const hours = Math.max(0, minutes / 60);
    laborHours += hours;
    laborCost += hours * toNumber(entry.hourlyRateLoaded);
  }

  const expensesByCategory: Record<ExpenseCategory, number> = {
    MATERIALS: 0,
    SUBCONTRACTOR: 0,
    PERMIT: 0,
    EQUIPMENT: 0,
    MISC: 0,
  };

  for (const expense of input.expenses) {
    expensesByCategory[expense.category] += toNumber(expense.amount);
  }

  const expensesTotal = Object.values(expensesByCategory).reduce((acc, value) => acc + value, 0);
  const totalCost = laborCost + expensesTotal;

  const paidOrSentInvoices = input.invoices.filter((invoice) =>
    ["SENT", "PAID", "OVERDUE"].includes(invoice.status),
  );

  const invoiceRevenue = paidOrSentInvoices.reduce((acc, invoice) => acc + toNumber(invoice.total), 0);

  const estimateRevenue = input.estimates
    .filter((estimate) => estimate.status === "APPROVED")
    .reduce((acc, estimate) => acc + toNumber(estimate.total), 0);

  const approvedChangeOrders = input.changeOrders
    .filter((co) => co.status === "APPROVED")
    .reduce((acc, co) => acc + toNumber(co.total), 0);

  const revenue = invoiceRevenue || estimateRevenue + approvedChangeOrders;
  const grossProfit = revenue - totalCost;
  const grossMarginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  const laborBudget = toNumber(input.estimatedLaborBudget);
  const materialBudget = toNumber(input.estimatedMaterialsBudget);
  const totalBudget = toNumber(input.estimatedTotalBudget);

  return {
    laborHours,
    laborCost,
    expensesByCategory,
    expensesTotal,
    totalCost,
    revenue,
    grossProfit,
    grossMarginPercent,
    costHealth: {
      labor: laborBudget > 0 ? (laborCost / laborBudget) * 100 : 0,
      materials: materialBudget > 0 ? (expensesByCategory.MATERIALS / materialBudget) * 100 : 0,
      total: totalBudget > 0 ? (totalCost / totalBudget) * 100 : 0,
    },
  };
}
