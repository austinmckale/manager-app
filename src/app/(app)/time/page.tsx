import { endOfWeek, format, startOfWeek } from "date-fns";
import {
  createTimeEntryAction,
  setPayrollWeekStateAction,
  startTimerAction,
  stopTimerAction,
  updateTimeEntryAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getJobs, getOrgUsers, getRunningTimer } from "@/lib/data";
import { demoJobs, demoUsers, isDemoMode, listDemoRuntimeTimeEntries } from "@/lib/demo";
import { canEditTimeEntry, canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { currency, toNumber } from "@/lib/utils";

type PayrollWeekState = "OPEN" | "LOCKED" | "PAID";

function readWeekStart(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>).weekStart;
  return typeof value === "string" ? value : "";
}

function toDateTimeLocal(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ workerId?: string; jobId?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const weekStartKey = format(weekStart, "yyyy-MM-dd");

  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 14);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(params.to) : now;

  const [users, jobs, runningTimer, settings] = await Promise.all([
    getOrgUsers(auth.orgId),
    getJobs({ orgId: auth.orgId, role: auth.role, userId: auth.userId, view: "all" }),
    getRunningTimer(auth.userId),
    isDemoMode() ? null : prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
  ]);

  const rawEntries = isDemoMode()
    ? listDemoRuntimeTimeEntries().map((entry) => ({
        ...entry,
        job: demoJobs.find((j) => j.id === entry.jobId) ?? demoJobs[0],
        worker: demoUsers.find((u) => u.id === entry.workerId) ?? demoUsers[0],
      }))
    : await prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          ...(params.workerId ? { workerId: params.workerId } : {}),
          ...(params.jobId ? { jobId: params.jobId } : {}),
          start: { gte: from, lte: to },
          ...(auth.role === "WORKER" ? { workerId: auth.userId } : {}),
        },
        include: { job: true, worker: true },
        orderBy: { start: "desc" },
        take: 200,
      });

  const entries = rawEntries.filter((e) => e.start >= from && e.start <= to);

  const weeklyEntries = isDemoMode()
    ? rawEntries.filter((e) => e.start >= weekStart && e.start <= weekEnd)
    : await prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          start: { gte: weekStart, lte: weekEnd },
          ...(auth.role === "WORKER" ? { workerId: auth.userId } : {}),
        },
        include: { job: true, worker: true },
        orderBy: { start: "asc" },
        take: 500,
      });

  const payrollWeekStateLogs = isDemoMode()
    ? []
    : await prisma.activityLog.findMany({
        where: {
          orgId: auth.orgId,
          action: {
            in: ["payroll.week.locked", "payroll.week.opened", "payroll.week.paid"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

  const payrollByWorker = new Map<string, { workerName: string; hours: number; laborCost: number; entryCount: number }>();
  for (const entry of entries) {
    const key = entry.workerId;
    const existing = payrollByWorker.get(key) ?? {
      workerName: entry.worker.fullName,
      hours: 0,
      laborCost: 0,
      entryCount: 0,
    };
    const minutes = entry.end ? (entry.end.getTime() - entry.start.getTime()) / 60000 : 0;
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
    const minutes = entry.end ? (entry.end.getTime() - entry.start.getTime()) / 60000 : 0;
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
    const jobRow = workerRow.jobs.get(entry.jobId) ?? { jobName: entry.job.jobName, hours: 0, pay: 0 };
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

  const latestWeekStateLog = payrollWeekStateLogs.find((log) => readWeekStart(log.metadata) === weekStartKey);
  const payrollWeekState: PayrollWeekState =
    latestWeekStateLog?.action === "payroll.week.paid"
      ? "PAID"
      : latestWeekStateLog?.action === "payroll.week.locked"
        ? "LOCKED"
        : "OPEN";
  const payrollWeekLocked = payrollWeekState === "LOCKED" || payrollWeekState === "PAID";

  const exportWeekUrl = `/api/export/time-entries?from=${weekStartKey}&to=${format(weekEnd, "yyyy-MM-dd")}`;
  const defaultFromStr = format(defaultFrom, "yyyy-MM-dd");
  const defaultToStr = format(now, "yyyy-MM-dd");

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Payroll week</h2>
        <p className="mt-1 text-sm text-teal-800">
          Review this week’s hours and pay, lock the week when you’re ready to run payroll, then export or use the time data in your bank or processor. You can add or edit time below until the week is locked.
        </p>
      </section>

      {/* This week: status + board + totals + controls */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Week of {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              payrollWeekState === "PAID"
                ? "bg-emerald-100 text-emerald-700"
                : payrollWeekState === "LOCKED"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {payrollWeekState === "PAID" ? "Paid" : payrollWeekState === "LOCKED" ? "Locked" : "Open"}
          </span>
        </div>

        {canManageOrg(auth.role) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action={setPayrollWeekStateAction} className="inline">
              <input type="hidden" name="weekStart" value={weekStartKey} />
              <input type="hidden" name="state" value="OPEN" />
              <button type="submit" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">Reopen week</button>
            </form>
            <form action={setPayrollWeekStateAction} className="inline">
              <input type="hidden" name="weekStart" value={weekStartKey} />
              <input type="hidden" name="state" value="LOCKED" />
              <button type="submit" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">Lock week</button>
            </form>
            <form action={setPayrollWeekStateAction} className="inline">
              <input type="hidden" name="weekStart" value={weekStartKey} />
              <input type="hidden" name="state" value="PAID" />
              <button type="submit" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">Mark paid</button>
            </form>
            <a
              href={exportWeekUrl}
              download
              className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-800"
            >
              Export this week (CSV)
            </a>
          </div>
        )}

        {payrollWeekLocked && (
          <p className="mt-2 text-xs text-amber-700">This week is locked. Time entry is read-only until you reopen it.</p>
        )}

        <div className="mt-4 space-y-2">
          {weeklyPayrollRows.map((row) => (
            <article key={row.workerName} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{row.workerName}</p>
                  <p className="text-xs text-slate-500">{currency(row.latestRate)}/hr</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{row.totalHours.toFixed(2)}h</p>
                  <p className="text-xs text-slate-500">{currency(row.totalPay)}</p>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {[...row.jobs.values()].sort((a, b) => b.pay - a.pay).map((job) => (
                  <div key={job.jobName} className="flex items-center justify-between text-xs text-slate-600">
                    <p>{job.jobName}</p>
                    <p>
                      {job.hours.toFixed(2)}h – {currency(job.pay)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {weeklyPayrollRows.length === 0 && (
            <p className="text-sm text-slate-500">No hours logged this week yet.</p>
          )}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p>Week total: {weeklyTotals.hours.toFixed(2)}h · {currency(weeklyTotals.pay)}</p>
        </div>
      </section>

      {/* Timer */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Timer</h3>
        {runningTimer ? (
          <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <p>Running: {runningTimer.job.jobName}</p>
            <p className="text-xs">Started {format(runningTimer.start, "EEE MMM d, h:mm a")}</p>
            <form action={stopTimerAction} className="mt-2">
              <input type="hidden" name="timeEntryId" value={runningTimer.id} />
              <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white">Stop timer</button>
            </form>
          </div>
        ) : (
          <form action={startTimerAction} className="mt-2 flex flex-wrap items-center gap-2">
            <select name="jobId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.jobName}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={payrollWeekLocked}
              className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start timer
            </button>
          </form>
        )}
      </section>

      {/* Manual entry */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Add time manually</h3>
        <form action={createTimeEntryAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <select name="jobId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.jobName}</option>
            ))}
          </select>
          {canManageOrg(auth.role) && (
            <select name="workerId" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Worker (self)</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.fullName}</option>
              ))}
            </select>
          )}
          <input name="start" type="datetime-local" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="end" type="datetime-local" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="notes" rows={2} placeholder="Notes (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <button
            type="submit"
            disabled={payrollWeekLocked}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed sm:col-span-2"
          >
            Save time entry
          </button>
        </form>
      </section>

      {/* Past time: filter + list + summary */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">View or edit past time</h3>
        <p className="mt-0.5 text-xs text-slate-500">Filter by worker, job, and date range. Changes are blocked when that week is locked.</p>
        <form method="get" action="/time" className="mt-3 grid gap-2 sm:grid-cols-4">
          <select name="workerId" defaultValue={params.workerId ?? ""} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All workers</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.fullName}</option>
            ))}
          </select>
          <select name="jobId" defaultValue={params.jobId ?? ""} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.jobName}</option>
            ))}
          </select>
          <input name="from" type="date" defaultValue={params.from ?? defaultFromStr} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="to" type="date" defaultValue={params.to ?? defaultToStr} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-4">
            Apply filter
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
            const minutes = entry.end ? (entry.end.getTime() - entry.start.getTime()) / 60000 : 0;
            const hours = minutes / 60;

            return (
              <article key={entry.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{entry.worker.fullName} · {entry.job.jobName}</p>
                    <p className="text-xs text-slate-500">
                      {format(entry.start, "EEE MMM d, h:mm a")}
                      {entry.end ? ` – ${format(entry.end, "h:mm a")}` : " (running)"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">{hours.toFixed(2)}h</p>
                    <p className="text-xs text-slate-500">{currency(hours * toNumber(entry.hourlyRateLoaded))}</p>
                  </div>
                </div>
                {canEdit && !payrollWeekLocked ? (
                  <form action={updateTimeEntryAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                    <input type="hidden" name="timeEntryId" value={entry.id} />
                    <input name="start" type="datetime-local" required defaultValue={toDateTimeLocal(entry.start)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                    <input name="end" type="datetime-local" defaultValue={entry.end ? toDateTimeLocal(entry.end) : ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                    <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Update</button>
                    <input name="notes" defaultValue={entry.notes ?? ""} placeholder="Notes" className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-4" />
                  </form>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">{canEdit ? "Week locked" : "Read only"}</p>
                )}
              </article>
            );
          })}
          {entries.length === 0 && <p className="text-sm text-slate-500">No entries for this filter.</p>}
        </div>

        {entries.length > 0 && (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <p>Filtered total: {payrollTotals.hours.toFixed(2)}h · {currency(payrollTotals.laborCost)}</p>
          </div>
        )}
      </section>
    </div>
  );
}
