import { computeJobCosting } from "@/lib/costing";
import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoCustomers, demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();

  if (isDemoMode()) {
    const headers = ["Job ID", "Job Name", "Customer", "Job Address", "Status", "Labor Hours", "Labor Cost", "Expense Total", "Total Cost", "Revenue", "Gross Profit", "Gross Margin %"];
    return csvResponse(
      "job-profitability.csv",
      headers,
      [[demoJobs[0].id, demoJobs[0].jobName, demoCustomers[0].name, demoJobs[0].address, "IN_PROGRESS", "120", "4560", "5240", "9800", "15000", "5200", "34.67"]],
    );
  }

  const jobs = await prisma.job.findMany({
    where: { orgId: auth.orgId },
    include: {
      customer: true,
      estimates: true,
      changeOrders: true,
      invoices: true,
      timeEntries: true,
      expenses: true,
    },
  });

  const headers = ["Job ID", "Job Name", "Customer", "Job Address", "Status", "Labor Hours", "Labor Cost", "Expense Total", "Total Cost", "Revenue", "Gross Profit", "Gross Margin %"];
  const rows = jobs.map((job) => {
    const costing = computeJobCosting(job);
    return [
      job.id,
      job.jobName,
      job.customer.name,
      job.address,
      job.status,
      costing.laborHours.toFixed(2),
      toNumber(costing.laborCost).toFixed(2),
      toNumber(costing.expensesTotal).toFixed(2),
      toNumber(costing.totalCost).toFixed(2),
      toNumber(costing.revenue).toFixed(2),
      toNumber(costing.grossProfit).toFixed(2),
      costing.grossMarginPercent.toFixed(2),
    ];
  });

  return csvResponse("job-profitability.csv", headers, rows);
}
