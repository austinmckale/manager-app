import { format } from "date-fns";
import JSZip from "jszip";
import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import { computeJobCosting } from "@/lib/costing";
import { requireAuth } from "@/lib/auth";
import { demoJobs, demoCustomers, demoUsers, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getLaborCost, getWorkedHours } from "@/lib/time-entry";
import { toNumber } from "@/lib/utils";

function csvLine(header: string[], rows: Array<Array<string | number>>): string {
  const escape = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  return [header.join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month"); // YYYY-MM
  const now = new Date();
  const year = monthParam ? parseInt(monthParam.slice(0, 4), 10) : now.getFullYear();
  const monthIndex = monthParam ? parseInt(monthParam.slice(5, 7), 10) - 1 : now.getMonth();
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

  const zip = new JSZip();

  if (isDemoMode()) {
    const timeHeaders = ["Date", "Employee", "Employee Email", "Job", "Customer", "Start", "End", "Hours", "Hourly Rate", "Total", "Notes", "Time Entry ID", "Job ID"];
    zip.file(
      "time-entries.csv",
      csvLine(timeHeaders, [[format(start, "yyyy-MM-dd"), demoUsers[1].fullName, demoUsers[1].email, demoJobs[0].jobName, demoCustomers[0].name, "08:00", "10:30", "2.5", "38", "95.00", "", "demo-1", demoJobs[0].id]]),
    );
    const jobHeaders = ["Job ID", "Job Name", "Customer", "Job Address", "Status", "Labor Hours", "Labor Cost", "Expense Total", "Total Cost", "Revenue", "Gross Profit", "Gross Margin %"];
    zip.file("job-profitability.csv", csvLine(jobHeaders, [[demoJobs[0].id, demoJobs[0].jobName, demoCustomers[0].name, demoJobs[0].address, "IN_PROGRESS", "120", "4560", "5240", "9800", "15000", "5200", "34.67"]]));
  } else {
    const [timeEntries, expensesInMonth] = await Promise.all([
      prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          date: { gte: start, lte: end },
        },
        include: { worker: true, job: { include: { customer: true } } },
        orderBy: { start: "asc" },
      }),
      prisma.expense.findMany({
        where: {
          job: { orgId: auth.orgId },
          date: { gte: start, lte: end },
        },
        select: { jobId: true },
      }),
    ]);

    const timeHeaders = ["Date", "Employee", "Employee Email", "Job", "Customer", "Start", "End", "Hours", "Hourly Rate", "Total", "Notes", "Time Entry ID", "Job ID"];
    const timeRows = timeEntries
      .filter((e) => e.end != null)
      .map((entry) => {
        const endTime = entry.end as Date;
        const hours = getWorkedHours(entry);
        const rate = toNumber(entry.hourlyRateLoaded);
        return [
          format(entry.date, "yyyy-MM-dd"),
          entry.worker.fullName,
          entry.worker.email ?? "",
          entry.job.jobName,
          entry.job.customer?.name ?? "",
          format(entry.start, "HH:mm"),
          format(endTime, "HH:mm"),
          hours.toFixed(4),
          rate.toFixed(2),
          getLaborCost(entry).toFixed(2),
          entry.notes ?? "",
          entry.id,
          entry.jobId,
        ];
      });
    zip.file("time-entries.csv", csvLine(timeHeaders, timeRows));

    // No expenses.csv in export — use bank/CC feed for that; export is labor + job P&L only
    const jobIds = new Set<string>([...timeEntries.map((e) => e.jobId), ...expensesInMonth.map((e) => e.jobId)]);
    const jobs =
      jobIds.size > 0
        ? await prisma.job.findMany({
            where: { id: { in: [...jobIds] }, orgId: auth.orgId },
            include: {
              customer: true,
              estimates: true,
              changeOrders: true,
              invoices: true,
              timeEntries: true,
              expenses: true,
            },
          })
        : [];

    const jobHeaders = ["Job ID", "Job Name", "Customer", "Job Address", "Status", "Labor Hours", "Labor Cost", "Expense Total", "Total Cost", "Revenue", "Gross Profit", "Gross Margin %"];
    const jobRows = jobs.map((job) => {
      const costing = computeJobCosting(job);
      return [
        job.id,
        job.jobName,
        job.customer?.name ?? "",
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
    zip.file("job-profitability.csv", csvLine(jobHeaders, jobRows));
  }

  const content = await zip.generateAsync({ type: "uint8array" });
  const filename = `export-${format(start, "yyyy-MM")}.zip`;
  return new NextResponse(Buffer.from(content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
