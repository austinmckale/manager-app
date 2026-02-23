import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();

  if (isDemoMode()) {
    return csvResponse("expenses.csv", ["job", "vendor", "category", "amount", "date"], [[demoJobs[0].jobName, "Home Depot", "MATERIALS", 320.15, new Date().toISOString().slice(0, 10)]]);
  }

  const expenses = await prisma.expense.findMany({
    where: { job: { orgId: auth.orgId } },
    include: { job: true },
    orderBy: { date: "desc" },
  });

  return csvResponse(
    "expenses.csv",
    ["job", "vendor", "category", "amount", "date"],
    expenses.map((expense) => [expense.job.jobName, expense.vendor, expense.category, toNumber(expense.amount), expense.date.toISOString().slice(0, 10)]),
  );
}
