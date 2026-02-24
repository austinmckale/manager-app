import { format } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoJobs, demoCustomers, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();

  if (isDemoMode()) {
    const headers = ["Date", "Job", "Customer", "Vendor (Payee)", "Category", "Amount", "Description", "Expense ID", "Job ID"];
    return csvResponse(
      "expenses.csv",
      headers,
      [[format(new Date(), "yyyy-MM-dd"), demoJobs[0].jobName, demoCustomers[0].name, "Home Depot", "MATERIALS", "320.15", "Demo expense", "demo-1", demoJobs[0].id]],
    );
  }

  const expenses = await prisma.expense.findMany({
    where: { job: { orgId: auth.orgId } },
    include: { job: { include: { customer: true } } },
    orderBy: { date: "asc" },
  });

  const headers = ["Date", "Job", "Customer", "Vendor (Payee)", "Category", "Amount", "Description", "Expense ID", "Job ID"];
  const rows = expenses.map((expense) => [
    format(expense.date, "yyyy-MM-dd"),
    expense.job.jobName,
    expense.job.customer?.name ?? "",
    expense.vendor,
    expense.category,
    toNumber(expense.amount).toFixed(2),
    expense.notes ?? "",
    expense.id,
    expense.jobId,
  ]);

  return csvResponse("expenses.csv", headers, rows);
}
