import Link from "next/link";
import { format } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getRunningTimer, getTodayOpsSummary } from "@/lib/data";
import { computeDashboardKpis } from "@/lib/kpis";
import { currency, percent } from "@/lib/utils";

function ScoreCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}

export default async function TodayPage() {
  const auth = await requireAuth();

  const [ops, runningTimer, kpis] = await Promise.all([
    getTodayOpsSummary({ orgId: auth.orgId, userId: auth.userId, role: auth.role }),
    getRunningTimer(auth.userId),
    computeDashboardKpis(auth.orgId),
  ]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Today Focus</h2>
        {runningTimer ? (
          <p className="mt-2 text-sm text-amber-700">Timer running on: {runningTimer.job.jobName}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No active timer. Start one before work begins.</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Link href="/time" className="rounded-xl border border-slate-300 px-3 py-2">Start/Stop Time</Link>
          <Link href="/jobs?view=today" className="rounded-xl border border-slate-300 px-3 py-2">Capture Receipts</Link>
          <Link href="/jobs?view=today" className="rounded-xl border border-slate-300 px-3 py-2">Capture Photos</Link>
          <Link href="/jobs?view=today" className="rounded-xl border border-slate-300 px-3 py-2">Open Job Hub</Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <ScoreCard label="Gross Margin" value={percent(kpis.grossMarginPercent)} />
        <ScoreCard label="Labor % Revenue" value={percent(kpis.laborPercentRevenue)} />
        <ScoreCard label="Outstanding AR" value={currency(kpis.outstandingInvoicesTotal)} />
        <ScoreCard label="Win Rate" value={percent(kpis.estimateToWinRate)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Schedule (Today)</h2>
        <div className="mt-3 space-y-2 text-sm">
          {ops.todayEvents.map((event) => (
            <article key={event.id} className="rounded-xl border border-slate-200 p-3">
              <p className="font-medium text-slate-900">{event.job.jobName}</p>
              <p className="text-xs text-slate-500">{format(event.startAt, "h:mm a")} - {format(event.endAt, "h:mm a")}</p>
              {event.notes ? <p className="text-xs text-slate-600">{event.notes}</p> : null}
            </article>
          ))}
          {ops.todayEvents.length === 0 ? <p className="text-sm text-slate-500">No schedule blocks for today.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">This Week</h2>
        <div className="mt-3 space-y-2 text-sm">
          {ops.weekEvents.slice(0, 8).map((event) => (
            <article key={event.id} className="rounded-xl border border-slate-200 p-3">
              <p className="font-medium text-slate-900">{event.job.jobName}</p>
              <p className="text-xs text-slate-500">{format(event.startAt, "EEE h:mm a")}</p>
            </article>
          ))}
          {ops.weekEvents.length === 0 ? <p className="text-sm text-slate-500">No schedule blocks this week.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Attention Needed</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl bg-rose-50 p-3">
            <p className="text-xs text-rose-600">Overdue Tasks</p>
            <p className="mt-1 text-xl font-semibold text-rose-700">{ops.overdueTasks.length}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Unsent Estimates</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{ops.unsentEstimates}</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-3">
            <p className="text-xs text-sky-700">Missing Receipts</p>
            <p className="mt-1 text-xl font-semibold text-sky-700">{ops.missingReceipts}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Assigned Jobs</h2>
        <div className="mt-3 space-y-2">
          {ops.assignedJobs.slice(0, 8).map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-xl border border-slate-200 p-3">
              <p className="font-medium text-slate-900">{job.jobName}</p>
              <p className="text-xs text-slate-500">{job.address}</p>
            </Link>
          ))}
          {ops.assignedJobs.length === 0 ? <p className="text-sm text-slate-500">No assigned jobs today.</p> : null}
        </div>
      </section>
    </div>
  );
}
