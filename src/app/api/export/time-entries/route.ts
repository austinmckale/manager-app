import { requireAuth } from "@/lib/auth";
import { csvResponse } from "@/lib/csv";
import { demoJobs, demoUsers, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();

  if (isDemoMode()) {
    return csvResponse("time-entries.csv", ["worker", "job", "start", "end", "break_minutes", "rate_loaded"], [[demoUsers[1].fullName, demoJobs[0].jobName, new Date().toISOString(), new Date().toISOString(), 30, 38]]);
  }

  const entries = await prisma.timeEntry.findMany({
    where: { job: { orgId: auth.orgId } },
    include: { worker: true, job: true },
    orderBy: { start: "desc" },
  });

  return csvResponse(
    "time-entries.csv",
    ["worker", "job", "start", "end", "break_minutes", "rate_loaded"],
    entries.map((entry) => [
      entry.worker.fullName,
      entry.job.jobName,
      entry.start.toISOString(),
      entry.end?.toISOString() ?? "",
      entry.breakMinutes,
      toNumber(entry.hourlyRateLoaded),
    ]),
  );
}
