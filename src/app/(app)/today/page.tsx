import Link from "next/link";
import { endOfDay, format, setHours, setMinutes, setSeconds, startOfDay } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getTodayOpsSummary } from "@/lib/data";
import { computeDashboardKpis } from "@/lib/kpis";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency } from "@/lib/utils";
import { sendDailyOpsDigestAction, sendMissingClockInsAlertAction } from "@/app/(app)/actions";

export default async function TodayPage() {
  const auth = await requireAuth();
  const [ops, kpis, attendanceAlertCount, captureCountsByJob] = await Promise.all([
    getTodayOpsSummary({ orgId: auth.orgId, userId: auth.userId, role: auth.role }),
    computeDashboardKpis(auth.orgId),
    (async () => {
      if (isDemoMode()) return 1;
      const [settings, users, entries] = await Promise.all([
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        prisma.userProfile.findMany({ where: { orgId: auth.orgId, isActive: true }, select: { id: true } }),
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

      const workersWithAnyEntry = new Set(entries.filter((entry) => entry.start.getTime() <= cutoff).map((entry) => entry.workerId));
      return users.filter((user) => !workersWithAnyEntry.has(user.id)).length;
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
        <h2 className="text-sm font-semibold text-slate-900">Owner Command Center</h2>
        <p className="mt-2 text-sm text-slate-600">
          Start on Today each morning, then use Team for schedule and the Payroll tab for weekly hours.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/attendance" className="rounded-xl border border-slate-300 px-3 py-2">
            Clock Employees
          </Link>
          <Link href="/leads#new-lead-form" className="rounded-xl border border-slate-300 px-3 py-2">
            New Lead
          </Link>
          <Link href="/time" className="rounded-xl border border-slate-300 px-3 py-2">
            Payroll Week
          </Link>
          <Link href="/reports" className="rounded-xl border border-slate-300 px-3 py-2">
            Export Reports
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Priority Queue</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Click a card to go fix it. Overdue = tasks past due date. Missing receipts = expenses with no receipt attached (24h+).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/leads" className="rounded-xl border border-rose-300 bg-rose-50 p-3">
            <p className="text-xs text-rose-700">New Leads (Uncontacted)</p>
            <p className="mt-1 text-xl font-semibold text-rose-700">{ops.newLeadsAwaitingContact}</p>
          </Link>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-rose-700">Missing Clock-ins</p>
                <p className="mt-1 text-xl font-semibold text-rose-700">{attendanceAlertCount}</p>
              </div>
              {attendanceAlertCount > 0 ? (
                <form action={sendMissingClockInsAlertAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                  >
                    Ping me on Discord
                  </button>
                </form>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-rose-700/80">
              Sends a one-time alert with who hasn’t clocked in yet today.
            </p>
          </div>
          <Link href="/jobs#overdue-tasks" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Overdue Tasks</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{ops.overdueTasks.length}</p>
          </Link>
          <Link href="/jobs#missing-receipts" className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <p className="text-xs text-sky-700">Missing Receipts (24h+)</p>
            <p className="mt-1 text-xl font-semibold text-sky-700">{ops.missingReceipts}</p>
          </Link>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-700">Daily ops digest</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Sends a one-time Discord summary of overdue tasks, missing receipts, and missing clock-ins for today.
            </p>
            <form action={sendDailyOpsDigestAction} className="mt-2">
              <button
                type="submit"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
              >
                Send digest now
              </button>
            </form>
          </div>
          <Link href="/accounting" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Unpaid invoices (owed to you)</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{currency(kpis.outstandingInvoicesTotal)}</p>
          </Link>
        </div>
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
                {(lead.serviceType || "Service TBD")} - {lead.source.replaceAll("_", " ")}
              </p>
              <p className="text-xs text-slate-500">Received {format(lead.createdAt, "EEE h:mm a")}</p>
            </article>
          ))}
          {ops.newLeadList.length === 0 ? (
            <p className="text-sm text-slate-500">No uncontacted leads right now.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Today Job Run Sheet</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every scheduled block across the company today. For each row: Hub (scope/Joist, details) → Time (confirm hours) → Capture (photos/receipts).
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700">
          Today: {jobsTodayCount} job{jobsTodayCount === 1 ? "" : "s"} · {visitsTodayCount} visit
          {visitsTodayCount === 1 ? "" : "s"} · {attendanceAlertCount} missing clock-in
          {attendanceAlertCount === 1 ? "" : "s"}
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
                          Photos today: {capture.photosToday} · Receipts: {capture.receiptsToday}
                        </p>
                      ) : null}
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {group.events.map((event) => (
                          <li key={event.id}>
                            <span className="font-medium">
                              {format(event.startAt, "h:mm a")} – {format(event.endAt, "h:mm a")}
                            </span>
                            {event.notes ? <span className="text-slate-500"> · {event.notes}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Link
                        href={`/jobs/${group.jobId}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
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
            <p className="text-sm text-slate-500">
              No schedule blocks for today. Add blocks on each job’s hub.
            </p>
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
