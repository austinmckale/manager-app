import { endOfDay, format, startOfDay } from "date-fns";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoJobs, demoUsers, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from"); // yyyy-MM-dd
  const toParam = searchParams.get("to");

  if (isDemoMode()) {
    const headers = ["Date", "Employee", "Employee Email", "Job", "Customer", "Start", "End", "Hours", "Hourly Rate", "Total", "Notes", "Time Entry ID", "Job ID"];
    const rate = 38;
    const hours = 2.5;
    return csvResponse(
      "time-entries.csv",
      headers,
      [[format(new Date(), "yyyy-MM-dd"), demoUsers[1].fullName, demoUsers[1].email, demoJobs[0].jobName, "Demo Customer", "08:00", "10:30", hours, rate, (hours * rate).toFixed(2), "", "demo-1", demoJobs[0].id]],
    );
  }

  const dateFilter =
    fromParam && toParam
      ? {
          start: {
            gte: startOfDay(new Date(fromParam)),
            lte: endOfDay(new Date(toParam)),
          },
        }
      : {};

  const entries = await prisma.timeEntry.findMany({
    where: {
      job: { orgId: auth.orgId },
      ...dateFilter,
    },
    include: { worker: true, job: { include: { customer: true } } },
    orderBy: { start: "asc" },
  });

  const headers = ["Date", "Employee", "Employee Email", "Job", "Customer", "Start", "End", "Hours", "Hourly Rate", "Total", "Notes", "Time Entry ID", "Job ID"];
  const rows = entries
    .filter((e) => e.end != null)
    .map((entry) => {
      const end = entry.end as Date;
      const hours = (end.getTime() - entry.start.getTime()) / (1000 * 60 * 60);
      const rate = toNumber(entry.hourlyRateLoaded);
      const total = hours * rate;
      return [
        format(entry.date, "yyyy-MM-dd"),
        entry.worker.fullName,
        entry.worker.email ?? "",
        entry.job.jobName,
        entry.job.customer?.name ?? "",
        format(entry.start, "HH:mm"),
        format(end, "HH:mm"),
        hours.toFixed(4),
        rate.toFixed(2),
        total.toFixed(2),
        entry.notes ?? "",
        entry.id,
        entry.jobId,
      ];
    });

  return csvResponse("time-entries.csv", headers, rows);
}
