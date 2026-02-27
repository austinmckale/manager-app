import Link from "next/link";
import { endOfDay, endOfWeek, format, setHours, setMinutes, setSeconds, startOfDay, startOfWeek, subDays } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getTodayOpsSummary } from "@/lib/data";
import { computeDashboardKpis } from "@/lib/kpis";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency } from "@/lib/utils";
import { sendMissingClockInsAlertAction } from "@/app/(app)/actions";

type TeamStatus = "CLOCKED_IN" | "CLOCKED_OUT" | "NOT_CLOCKED";

type TeamRow = {
  id: string;
  fullName: string;
  role: string;
  status: TeamStatus;
};

type TeamSnapshot = {
  missingClockIns: number;
  totalActive: number;
  clockedInNow: number;
  clockedInToday: number;
  discordClockInAlertsEnabled: boolean;
  rows: TeamRow[];
};

type PayrollRow = {
  workerId: string;
  fullName: string;
  hours: number;
  grossPay: number;
};

type WeeklyPayrollSnapshot = {
  totalHours: number;
  totalGrossPay: number;
  rows: PayrollRow[];
};

type VisitTrend = {
  totalVisits28d: number;
  averageDailyVisits28d: number;
};

function teamStatusLabel(status: TeamStatus) {
  if (status === "CLOCKED_IN") return "Clocked in";
  if (status === "CLOCKED_OUT") return "Worked today";
  return "No clock-in";
}

function teamStatusClasses(status: TeamStatus) {
  if (status === "CLOCKED_IN") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "CLOCKED_OUT") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function teamSortWeight(status: TeamStatus) {
  if (status === "NOT_CLOCKED") return 0;
  if (status === "CLOCKED_IN") return 1;
  return 2;
}

export default async function TodayPage() {
  const auth = await requireAuth();
  const [ops, kpis, teamSnapshot, weeklyPayroll, visitTrend, captureCountsByJob] = await Promise.all([
    getTodayOpsSummary({ orgId: auth.orgId, userId: auth.userId, role: auth.role }),
    computeDashboardKpis(auth.orgId),
    (async (): Promise<TeamSnapshot> => {
      if (isDemoMode()) {
        return {
          missingClockIns: 1,
          totalActive: 3,
          clockedInNow: 1,
          clockedInToday: 2,
          discordClockInAlertsEnabled: false,
          rows: [
            { id: "demo-1", fullName: "Owner Admin", role: "OWNER", status: "CLOCKED_IN" },
            { id: "demo-2", fullName: "Crew Lead", role: "WORKER", status: "CLOCKED_OUT" },
            { id: "demo-3", fullName: "Estimator", role: "WORKER", status: "NOT_CLOCKED" },
          ],
        };
      }

      const [settings, users, entries] = await Promise.all([
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        prisma.userProfile.findMany({
          where: { orgId: auth.orgId, isActive: true },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: "asc" },
        }),
        prisma.timeEntry.findMany({
          where: {
            job: { orgId: auth.orgId },
            start: { gte: startOfDay(new Date()) },
          },
          select: { workerId: true, start: true, end: true },
        }),
      ]);

      const [hourText, minuteText] = (settings?.defaultClockInTime ?? "07:00").split(":");
      const scheduled = setSeconds(
        setMinutes(setHours(startOfDay(new Date()), Number(hourText || 7)), Number(minuteText || 0)),
        0,
      );
      const cutoff = scheduled.getTime() + (settings?.clockGraceMinutes ?? 10) * 60000;

      const workersWithAnyEntry = new Set(entries.map((entry) => entry.workerId));
      const workersWithEntryByCutoff = new Set(
        entries.filter((entry) => entry.start.getTime() <= cutoff).map((entry) => entry.workerId),
      );
      const workersCurrentlyClockedIn = new Set(entries.filter((entry) => !entry.end).map((entry) => entry.workerId));

      const rows = users
        .map((user) => {
          const status: TeamStatus = workersCurrentlyClockedIn.has(user.id)
            ? "CLOCKED_IN"
            : workersWithAnyEntry.has(user.id)
              ? "CLOCKED_OUT"
              : "NOT_CLOCKED";
          return { id: user.id, fullName: user.fullName, role: user.role, status };
        })
        .sort((a, b) => {
          const weight = teamSortWeight(a.status) - teamSortWeight(b.status);
          if (weight !== 0) return weight;
          return a.fullName.localeCompare(b.fullName);
        });

      return {
        missingClockIns: users.filter((user) => !workersWithEntryByCutoff.has(user.id)).length,
        totalActive: users.length,
        clockedInNow: workersCurrentlyClockedIn.size,
        clockedInToday: workersWithAnyEntry.size,
        discordClockInAlertsEnabled: settings?.gpsTimeTrackingEnabled ?? false,
        rows,
      };
    })(),
    (async (): Promise<WeeklyPayrollSnapshot> => {
      if (isDemoMode()) {
        return {
          totalHours: 18.5,
          totalGrossPay: 684.5,
          rows: [
            { workerId: "demo-1", fullName: "Owner Admin", hours: 6, grossPay: 390 },
            { workerId: "demo-2", fullName: "Crew Lead", hours: 8.5, grossPay: 323 },
            { workerId: "demo-3", fullName: "Estimator", hours: 4, grossPay: 91.5 },
          ],
        };
      }

      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
      const entries = await prisma.timeEntry.findMany({
        where: {
          job: { orgId: auth.orgId },
          start: { gte: weekStart, lte: weekEnd },
          end: { not: null },
        },
        select: {
          workerId: true,
          start: true,
          end: true,
          breakMinutes: true,
          hourlyRateLoaded: true,
          worker: { select: { fullName: true } },
        },
      });

      const grouped = new Map<string, PayrollRow>();
      for (const entry of entries) {
        const end = entry.end as Date;
        const workedMinutes = Math.max(0, (end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes);
        const hours = workedMinutes / 60;
        const grossPay = hours * Number(entry.hourlyRateLoaded);
        const existing = grouped.get(entry.workerId);
        if (!existing) {
          grouped.set(entry.workerId, {
            workerId: entry.workerId,
            fullName: entry.worker.fullName,
            hours,
            grossPay,
          });
          continue;
        }
        existing.hours += hours;
        existing.grossPay += grossPay;
      }

      const rows = [...grouped.values()].sort((a, b) => b.grossPay - a.grossPay);
      return {
        totalHours: rows.reduce((sum, row) => sum + row.hours, 0),
        totalGrossPay: rows.reduce((sum, row) => sum + row.grossPay, 0),
        rows,
      };
    })(),
    (async (): Promise<VisitTrend> => {
      if (isDemoMode()) return { totalVisits28d: 76, averageDailyVisits28d: 2.7 };
      const trendStart = startOfDay(subDays(new Date(), 27));
      const trendEnd = endOfDay(new Date());
      const totalVisits28d = await prisma.jobScheduleEvent.count({
        where: {
          orgId: auth.orgId,
          startAt: { gte: trendStart, lte: trendEnd },
        },
      });
      return {
        totalVisits28d,
        averageDailyVisits28d: totalVisits28d / 28,
      };
    })(),
    (async () => {
      if (isDemoMode()) return {} as Record<string, { photosToday: number; receiptsToday: number }>;

      const todayStart = startOfDay(new Date());
      const todayEnd = endOfDay(new Date());
      const assets = await prisma.fileAsset.findMany({
        where: {
          job: { orgId: auth.orgId },
          createdAt: { gte: todayStart, lte: todayEnd },
          type: { in: ["PHOTO", "RECEIPT"] },
        },
        select: { jobId: true, type: true },
      });

      const summary: Record<string, { photosToday: number; receiptsToday: number }> = {};
      for (const asset of assets) {
        const current = summary[asset.jobId] ?? { photosToday: 0, receiptsToday: 0 };
        if (asset.type === "PHOTO") current.photosToday += 1;
        if (asset.type === "RECEIPT") current.receiptsToday += 1;
        summary[asset.jobId] = current;
      }
      return summary;
    })(),
  ]);

  const jobsTodayCount = new Set(ops.todayEvents.map((event) => event.job.id)).size;
  const visitsTodayCount = ops.todayEvents.length;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Daily Command</h2>
        <p className="mt-1 text-xs text-slate-500">Mobile-first view: what needs action now, with direct tap targets.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/jobs?view=today" className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100">
            <p className="text-xs text-slate-500">Visits today</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{visitsTodayCount}</p>
          </Link>
          <Link href="/leads?stage=NEW" className="rounded-xl border border-rose-200 bg-rose-50 p-3 hover:bg-rose-100">
            <p className="text-xs text-rose-700">New leads</p>
            <p className="mt-1 text-xl font-semibold text-rose-700">{ops.newLeadsAwaitingContact}</p>
          </Link>
          <Link href="/attendance" className="rounded-xl border border-amber-200 bg-amber-50 p-3 hover:bg-amber-100">
            <p className="text-xs text-amber-700">Missing clock-ins</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{teamSnapshot.missingClockIns}</p>
          </Link>
          <Link href="/time" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 hover:bg-emerald-100">
            <p className="text-xs text-emerald-700">Payroll week</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">{currency(weeklyPayroll.totalGrossPay)}</p>
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Link href="/jobs?status=ESTIMATE" className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700 hover:bg-slate-100">
            Sent estimates: <span className="font-semibold">{ops.sentEstimates}</span>
          </Link>
          <Link href="/jobs?status=ESTIMATE" className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700 hover:bg-slate-100">
            Draft estimates: <span className="font-semibold">{ops.unsentEstimates}</span>
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/attendance" className="rounded-xl border border-slate-300 px-3 py-2">
            Attendance Dashboard
          </Link>
          <Link href="/time" className="rounded-xl border border-slate-300 px-3 py-2">
            Payroll Dashboard
          </Link>
          <Link href="/leads#new-lead-form" className="rounded-xl border border-slate-300 px-3 py-2">
            New Lead
          </Link>
          <Link href="/jobs?view=week" className="rounded-xl border border-slate-300 px-3 py-2">
            Open Jobs Board
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Attention Queue</h2>
          {teamSnapshot.discordClockInAlertsEnabled && teamSnapshot.missingClockIns > 0 ? (
            <form action={sendMissingClockInsAlertAction}>
              <button
                type="submit"
                className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
              >
                Send Discord clock-in alert
              </button>
            </form>
          ) : (
            <Link href="/settings/targets" className="text-[11px] text-slate-500 underline">
              Enable Discord alerts
            </Link>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/jobs#overdue-tasks" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Overdue tasks</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{ops.overdueTasks.length}</p>
          </Link>
          <Link href="/jobs#missing-receipts" className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <p className="text-xs text-sky-700">Missing receipts</p>
            <p className="mt-1 text-xl font-semibold text-sky-700">{ops.missingReceipts}</p>
          </Link>
        </div>
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Digest now: {ops.overdueTasks.length} overdue tasks, {ops.missingReceipts} missing receipts, {teamSnapshot.missingClockIns} missing clock-ins.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Weekly Payroll Snapshot</h2>
          <Link href="/time" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            Open Payroll
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          This week: {weeklyPayroll.totalHours.toFixed(1)}h | {currency(weeklyPayroll.totalGrossPay)} gross pay
        </p>
        <div className="mt-3 space-y-2">
          {weeklyPayroll.rows.map((row) => (
            <article key={row.workerId} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-900">{row.fullName}</p>
              <p className="text-xs text-slate-600">
                {row.hours.toFixed(1)}h | {currency(row.grossPay)}
              </p>
            </article>
          ))}
          {weeklyPayroll.rows.length === 0 ? (
            <p className="text-sm text-slate-500">No completed time entries this week yet.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Team Snapshot</h2>
          <Link href="/attendance" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            Open Team
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Active: {teamSnapshot.totalActive} | Clocked in now: {teamSnapshot.clockedInNow} | Worked today: {teamSnapshot.clockedInToday}
        </p>
        <div className="mt-3 space-y-2">
          {teamSnapshot.rows.map((row) => (
            <article key={row.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{row.fullName}</p>
                <p className="text-xs text-slate-500">{row.role}</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-xs font-medium ${teamStatusClasses(row.status)}`}>
                {teamStatusLabel(row.status)}
              </span>
            </article>
          ))}
          {teamSnapshot.rows.length === 0 ? <p className="text-sm text-slate-500">No active team members yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Stats</summary>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Link href="/accounting" className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700 hover:bg-slate-100">
              Unpaid invoices: <span className="font-semibold">{currency(kpis.outstandingInvoicesTotal)}</span>
            </Link>
            <Link href="/jobs?view=week" className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700 hover:bg-slate-100">
              Avg visits/day (4w): <span className="font-semibold">{visitTrend.averageDailyVisits28d.toFixed(1)}</span>
            </Link>
          </div>
        </details>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">New Leads Requiring First Contact</h2>
          <Link href="/leads" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            Open Leads
          </Link>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {ops.newLeadList.map((lead) => (
            <article key={lead.id} className="rounded-xl border border-rose-100 bg-rose-50 p-3">
              <p className="font-medium text-slate-900">{lead.contactName}</p>
              <p className="text-xs text-slate-600">
                {(lead.serviceType || "Service TBD")} | {lead.source.replaceAll("_", " ")}
              </p>
              <p className="text-xs text-slate-500">Received {format(lead.createdAt, "EEE h:mm a")}</p>
            </article>
          ))}
          {ops.newLeadList.length === 0 ? <p className="text-sm text-slate-500">No uncontacted leads right now.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Today Job Run Sheet</h2>
        <p className="mt-1 text-xs text-slate-500">
          All scheduled blocks today. For each row: Hub for scope, Time for hours, Capture for photos and receipts.
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700">
          Today: {jobsTodayCount} job{jobsTodayCount === 1 ? "" : "s"} | {visitsTodayCount} visit
          {visitsTodayCount === 1 ? "" : "s"} | {teamSnapshot.missingClockIns} missing clock-in
          {teamSnapshot.missingClockIns === 1 ? "" : "s"}
        </p>
        <div className="mt-3 space-y-2 text-sm">
          {(() => {
            const seen = new Set<string>();
            const todayDeduped = ops.todayEvents.filter((event) => {
              const key = `${event.job.id}-${new Date(event.startAt).getTime()}-${new Date(event.endAt).getTime()}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            const grouped = new Map<
              string,
              {
                jobId: string;
                jobName: string;
                events: typeof todayDeduped;
              }
            >();
            for (const event of todayDeduped) {
              const jobId = event.job.id;
              const jobName = event.job.jobName;
              const existing = grouped.get(jobId) ?? { jobId, jobName, events: [] as typeof todayDeduped };
              existing.events = [...existing.events, event];
              grouped.set(jobId, existing);
            }
            return [...grouped.values()].map((group) => {
              const capture = captureCountsByJob[group.jobId];
              return (
                <article key={group.jobId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{group.jobName}</p>
                      {capture ? (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Photos today: {capture.photosToday} | Receipts: {capture.receiptsToday}
                        </p>
                      ) : null}
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {group.events.map((event) => (
                          <li key={event.id}>
                            <span className="font-medium">
                              {format(event.startAt, "h:mm a")} - {format(event.endAt, "h:mm a")}
                            </span>
                            {event.notes ? <span className="text-slate-500"> | {event.notes}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Link href={`/jobs/${group.jobId}`} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                        Hub
                      </Link>
                      <Link
                        href={`/time?jobId=${group.jobId}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        Time
                      </Link>
                      <Link
                        href={`/jobs/${group.jobId}#capture`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        Photos / Receipts
                      </Link>
                    </div>
                  </div>
                </article>
              );
            });
          })()}
          {ops.todayEvents.length === 0 ? (
            <p className="text-sm text-slate-500">No schedule blocks for today. Add blocks on each job hub.</p>
          ) : null}
          {ops.todayEvents.length === 0 ? (
            <div className="mt-2">
              <Link href="/jobs?view=week" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700">
                Open Jobs Board
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
