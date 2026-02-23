import { computeJobCosting } from "@/lib/costing";
import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoCustomers, demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();

  if (isDemoMode()) {
    return csvResponse("job-profitability.csv", ["job", "customer", "revenue", "total_cost", "gross_profit", "gross_margin_percent"], [[demoJobs[0].jobName, demoCustomers[0].name, 15000, 9800, 5200, 34.67]]);
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

  return csvResponse(
    "job-profitability.csv",
    ["job", "customer", "revenue", "total_cost", "gross_profit", "gross_margin_percent"],
    jobs.map((job) => {
      const costing = computeJobCosting(job);
      return [job.jobName, job.customer.name, toNumber(costing.revenue), toNumber(costing.totalCost), toNumber(costing.grossProfit), Number(costing.grossMarginPercent.toFixed(2))];
    }),
  );
}
