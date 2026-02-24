import { canManageOrg, canEditTimeEntry } from "@/lib/permissions";
import { requireAuth } from "@/lib/auth";
import { getJobs, getOrgUsers, getRunningTimer } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency, toNumber } from "@/lib/utils";
import { createTimeEntryAction, startTimerAction, stopTimerAction } from "@/app/(app)/actions";
import { endOfWeek, format, startOfWeek } from "date-fns";

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ workerId?: string; jobId?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;

  const [users, jobs, runningTimer, settings] = await Promise.all([
    getOrgUsers(auth.orgId),
    getJobs({ orgId: auth.orgId, role: auth.role, userId: auth.userId }),
    getRunningTimer(auth.userId),
    isDemoMode() ? null : prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
  ]);

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 14);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(params.to) : now;
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const entries = isDemoMode()
    ? []
    : await prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          ...(params.workerId ? { workerId: params.workerId } : {}),
          ...(params.jobId ? { jobId: params.jobId } : {}),
          start: { gte: from, lte: to },
          ...(auth.role === "WORKER" ? { workerId: auth.userId } : {}),
        },
        include: {
          job: true,
          worker: true,
        },
        orderBy: { start: "desc" },
        take: 200,
      });

  const weeklyEntries = isDemoMode()
    ? []
    : await prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          start: { gte: weekStart, lte: weekEnd },
          ...(auth.role === "WORKER" ? { workerId: auth.userId } : {}),
        },
        include: {
          job: true,
          worker: true,
        },
        orderBy: { start: "asc" },
        take: 500,
      });

  const payrollByWorker = new Map<
    string,
    { workerName: string; hours: number; laborCost: number; entryCount: number }
  >();

  for (const entry of entries) {
    const key = entry.workerId;
    const existing = payrollByWorker.get(key) ?? {
      workerName: entry.worker.fullName,
      hours: 0,
      laborCost: 0,
      entryCount: 0,
    };
    const minutes = entry.end
      ? Math.max(0, (entry.end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes)
      : 0;
    const hours = minutes / 60;
    existing.hours += hours;
    existing.laborCost += hours * toNumber(entry.hourlyRateLoaded);
    existing.entryCount += 1;
    payrollByWorker.set(key, existing);
  }

  const payrollRows = [...payrollByWorker.values()].sort((a, b) => b.laborCost - a.laborCost);
  const payrollTotals = payrollRows.reduce(
    (acc, row) => {
      acc.hours += row.hours;
      acc.laborCost += row.laborCost;
      return acc;
    },
    { hours: 0, laborCost: 0 },
  );

  const weeklyPayrollByWorker = new Map<
    string,
    {
      workerName: string;
      totalHours: number;
      totalPay: number;
      latestRate: number;
      jobs: Map<string, { jobName: string; hours: number; pay: number }>;
    }
  >();

  for (const entry of weeklyEntries) {
    const minutes = entry.end
      ? Math.max(0, (entry.end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes)
      : 0;
    const hours = minutes / 60;
    const loadedRate = toNumber(entry.hourlyRateLoaded);
    const pay = hours * loadedRate;

    const workerRow = weeklyPayrollByWorker.get(entry.workerId) ?? {
      workerName: entry.worker.fullName,
      totalHours: 0,
      totalPay: 0,
      latestRate: loadedRate,
      jobs: new Map<string, { jobName: string; hours: number; pay: number }>(),
    };

    workerRow.totalHours += hours;
    workerRow.totalPay += pay;
    workerRow.latestRate = loadedRate || workerRow.latestRate;

    const jobRow = workerRow.jobs.get(entry.jobId) ?? {
      jobName: entry.job.jobName,
      hours: 0,
      pay: 0,
    };
    jobRow.hours += hours;
    jobRow.pay += pay;
    workerRow.jobs.set(entry.jobId, jobRow);

    weeklyPayrollByWorker.set(entry.workerId, workerRow);
  }

  const weeklyPayrollRows = [...weeklyPayrollByWorker.values()].sort((a, b) => b.totalPay - a.totalPay);
  const weeklyTotals = weeklyPayrollRows.reduce(
    (acc, row) => {
      acc.hours += row.totalHours;
      acc.pay += row.totalPay;
      return acc;
    },
    { hours: 0, pay: 0 },
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Timer</h2>
        {runningTimer ? (
          <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <p>Running on {runningTimer.job.jobName}</p>
            <p className="text-xs">Started {runningTimer.start.toLocaleString()}</p>
            <form action={stopTimerAction} className="mt-2">
              <input type="hidden" name="timeEntryId" value={runningTimer.id} />
              <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-white">
                Stop timer
              </button>
            </form>
          </div>
        ) : (
          <form action={startTimerAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <select name="jobId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobName}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
              Start timer
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Manual Entry</h2>
        <form action={createTimeEntryAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <select name="jobId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.jobName}
              </option>
            ))}
          </select>
          {canManageOrg(auth.role) ? (
            <select name="workerId" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Worker (self)</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          ) : null}
          <input name="start" type="datetime-local" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="end" type="datetime-local" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="breakMinutes" type="number" min={0} defaultValue={0} placeholder="Break minutes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="notes" rows={2} placeholder="Notes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
            Save Time Entry
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Weekly Payroll Board</h2>
        <p className="mt-1 text-xs text-slate-500">
          {format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")} by employee with job breakdown.
        </p>
        <div className="mt-3 space-y-2">
          {weeklyPayrollRows.map((row) => (
            <article key={row.workerName} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{row.workerName}</p>
                  <p className="text-xs text-slate-500">Rate snapshot: {currency(row.latestRate)}/hr</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{row.totalHours.toFixed(2)}h</p>
                  <p className="text-xs text-slate-500">Pay: {currency(row.totalPay)}</p>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {[...row.jobs.values()].sort((a, b) => b.pay - a.pay).map((job) => (
                  <div key={job.jobName} className="flex items-center justify-between text-xs text-slate-600">
                    <p>{job.jobName}</p>
                    <p>{job.hours.toFixed(2)}h • {currency(job.pay)}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {weeklyPayrollRows.length === 0 ? <p className="text-sm text-slate-500">No payroll hours logged this week.</p> : null}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
          <p>Week Total Hours: {weeklyTotals.hours.toFixed(2)}</p>
          <p>Week Total Pay: {currency(weeklyTotals.pay)}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Timesheet View</h2>
        <form className="mt-3 grid gap-2 sm:grid-cols-4">
          <select name="workerId" defaultValue={params.workerId ?? ""} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All workers</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
          <select name="jobId" defaultValue={params.jobId ?? ""} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.jobName}
              </option>
            ))}
          </select>
          <input name="from" type="date" defaultValue={params.from} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="to" type="date" defaultValue={params.to} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-4">
            Filter
          </button>
        </form>

        <div className="mt-4 space-y-2">
          {entries.map((entry) => {
            const canEdit = canEditTimeEntry({
              role: auth.role,
              actorUserId: auth.userId,
              entry,
              workerCanEditOwnSameDay: settings?.workerCanEditOwnTimeSameDay ?? true,
            });

            const minutes = entry.end
              ? Math.max(0, (entry.end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes)
              : 0;
            const hours = minutes / 60;

            return (
              <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{entry.worker.fullName} • {entry.job.jobName}</p>
                    <p className="text-xs text-slate-500">{entry.start.toLocaleString()} {entry.end ? `→ ${entry.end.toLocaleString()}` : "(running)"}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">{hours.toFixed(2)}h</p>
                    <p className="text-xs text-slate-500">{currency(hours * toNumber(entry.hourlyRateLoaded))}</p>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">{canEdit ? "Editable" : "Read only"}</p>
              </article>
            );
          })}
          {entries.length === 0 ? <p className="text-sm text-slate-500">No entries for selected filters.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Payroll Summary (Filtered Range)</h2>
        <div className="mt-3 space-y-2">
          {payrollRows.map((row) => (
            <article key={row.workerName} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-900">{row.workerName}</p>
                <p className="text-xs text-slate-500">{row.entryCount} entries</p>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>Hours: {row.hours.toFixed(2)}</p>
                <p>Labor Cost: {currency(row.laborCost)}</p>
              </div>
            </article>
          ))}
          {payrollRows.length === 0 ? <p className="text-sm text-slate-500">No payroll data for this filter.</p> : null}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
          <p>Total Hours: {payrollTotals.hours.toFixed(2)}</p>
          <p>Total Labor Cost: {currency(payrollTotals.laborCost)}</p>
        </div>
      </section>
    </div>
  );
}
