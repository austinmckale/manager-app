import Link from "next/link";
import { endOfDay, endOfWeek, format, setHours, setMinutes, setSeconds, startOfDay, startOfWeek } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getTodayOpsSummary } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency } from "@/lib/utils";
import { sendMissingClockInsAlertAction } from "@/app/(app)/actions";

type TeamSnapshot = {
  missingClockIns: number;
  discordClockInAlertsEnabled: boolean;
};

type WeeklyPayrollSnapshot = {
  totalGrossPay: number;
}

export default async function TodayPage() {
  const auth = await requireAuth();
  const [ops, teamSnapshot, weeklyPayroll] = await Promise.all([
    getTodayOpsSummary({ orgId: auth.orgId, userId: auth.userId, role: auth.role }),
    (async (): Promise<TeamSnapshot> => {
      if (isDemoMode()) {
        return {
          missingClockIns: 1,
          discordClockInAlertsEnabled: false,
        };
      }

      const [settings, users, entries] = await Promise.all([
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        prisma.userProfile.findMany({
          where: { orgId: auth.orgId, isActive: true },
          select: { id: true },
        }),
        prisma.timeEntry.findMany({
          where: {
            job: { orgId: auth.orgId },
            start: { gte: startOfDay(new Date()) },
          },
          select: { workerId: true, start: true },
        }),
      ]);

      const [hourText, minuteText] = (settings?.defaultClockInTime ?? "07:00").split(":");
      const scheduled = setSeconds(
        setMinutes(setHours(startOfDay(new Date()), Number(hourText || 7)), Number(minuteText || 0)),
        0,
      );
      const cutoff = scheduled.getTime() + (settings?.clockGraceMinutes ?? 10) * 60000;

      const workersWithEntryByCutoff = new Set(
        entries.filter((entry) => entry.start.getTime() <= cutoff).map((entry) => entry.workerId),
      );

      return {
        missingClockIns: users.filter((user) => !workersWithEntryByCutoff.has(user.id)).length,
        discordClockInAlertsEnabled: settings?.gpsTimeTrackingEnabled ?? false,
      };
    })(),
    (async (): Promise<WeeklyPayrollSnapshot> => {
      if (isDemoMode()) {
        return {
          totalGrossPay: 684.5,
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
          start: true,
          end: true,
          breakMinutes: true,
          hourlyRateLoaded: true,
        },
      });

      let totalGrossPay = 0;
      for (const entry of entries) {
        const end = entry.end as Date;
        const workedMinutes = Math.max(0, (end.getTime() - entry.start.getTime()) / 60000 - entry.breakMinutes);
        const hours = workedMinutes / 60;
        const grossPay = hours * Number(entry.hourlyRateLoaded);
        totalGrossPay += grossPay;
      }

      return {
        totalGrossPay,
      };
    })(),
  ]);

  const captureCountsByJob = await (async () => {
    if (isDemoMode()) return {} as Record<string, { photosToday: number; receiptsToday: number }>;

    const todayJobIds = [...new Set(ops.todayEvents.map((event) => event.job.id))];
    if (todayJobIds.length === 0) return {} as Record<string, { photosToday: number; receiptsToday: number }>;

    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const assets = await prisma.fileAsset.findMany({
      where: {
        jobId: { in: todayJobIds },
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
  })();

  const jobsTodayCount = new Set(ops.todayEvents.map((event) => event.job.id)).size;
  const visitsTodayCount = ops.todayEvents.length;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Daily Command</h2>
        <p className="mt-1 text-xs text-slate-500">Only today-critical actions for mobile use.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/jobs?view=today&focus=visits" className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100">
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

      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Attention Queue</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/jobs#overdue-tasks" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Overdue tasks</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{ops.overdueTasksCount}</p>
          </Link>
          <Link href="/jobs#missing-receipts" className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <p className="text-xs text-sky-700">Missing receipts</p>
            <p className="mt-1 text-xl font-semibold text-sky-700">{ops.missingReceipts}</p>
          </Link>
        </div>
        {teamSnapshot.discordClockInAlertsEnabled && teamSnapshot.missingClockIns > 0 ? (
          <form action={sendMissingClockInsAlertAction} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
            >
              Send Discord clock-in alert
            </button>
          </form>
        ) : null}
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
        </div>
      </section>
    </div>
  );
}
