import { endOfDay, startOfDay, subDays } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { computeDashboardKpis } from "@/lib/kpis";
import { prisma } from "@/lib/prisma";
import { currency, percent, toNumber } from "@/lib/utils";

function tone(actual: number, target?: number, invert = false) {
  if (target === undefined) return "bg-slate-100 text-slate-700";
  const good = invert ? actual <= target : actual >= target;
  if (good) return "bg-emerald-100 text-emerald-700";
  const within = invert ? actual <= target * 1.1 : actual >= target * 0.9;
  if (within) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function KpiRow({ label, value, target, invert = false }: { label: string; value: number; target?: number; invert?: boolean }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <span className={`rounded-full px-2 py-1 text-[11px] ${tone(value, target, invert)}`}>
          {target !== undefined ? `Target ${target.toFixed(1)}` : "No target"}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value.toFixed(1)}</p>
    </article>
  );
}

export default async function DashboardPage() {
  const auth = await requireAuth();
  const kpis = await computeDashboardKpis(auth.orgId);

  const [unbilledJobsCount, unpaidInvoicesTotal, laborHours7d] = isDemoMode()
    ? [2, 12450, 86.5]
    : await Promise.all([
        prisma.job.count({
          where: {
            orgId: auth.orgId,
            invoices: { none: {} },
          },
        }),
        prisma.invoice.aggregate({
          where: {
            job: { orgId: auth.orgId },
            status: { in: ["SENT", "OVERDUE"] },
          },
          _sum: { total: true },
        }).then((v) => toNumber(v._sum.total)),
        prisma.timeEntry.findMany({
          where: {
            job: { orgId: auth.orgId },
            start: { gte: startOfDay(subDays(new Date(), 7)), lte: endOfDay(new Date()) },
            end: { not: null },
          },
          select: { start: true, end: true, breakMinutes: true },
        }).then((rows) =>
          rows.reduce((acc, row) => {
            const end = row.end as Date;
            const minutes = Math.max(0, (end.getTime() - row.start.getTime()) / 60000 - row.breakMinutes);
            return acc + minutes / 60;
          }, 0),
        ),
      ]);

  const gmTarget = kpis.targets.grossMarginPercent ? toNumber(kpis.targets.grossMarginPercent.targetValue) : undefined;
  const winTarget = kpis.targets.estimateToWinRate ? toNumber(kpis.targets.estimateToWinRate.targetValue) : undefined;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Daily Scoreboard</h2>
        <p className="text-xs text-slate-500">Manager view: money, momentum, and labor in one glance.</p>
      </section>

      <section className="grid gap-2 sm:grid-cols-2">
        <KpiRow label="Gross Margin % (30d)" value={kpis.grossMarginPercent} target={gmTarget} />
        <KpiRow label="Estimate Win Rate %" value={kpis.estimateToWinRate} target={winTarget} />
        <article className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-900">Unbilled Jobs</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{unbilledJobsCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-900">Unpaid Invoices</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(unpaidInvoicesTotal)}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-3 sm:col-span-2">
          <p className="text-sm font-medium text-slate-900">Labor Hours (Last 7 Days)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{laborHours7d.toFixed(1)}h</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <p>Outstanding count: {kpis.outstandingInvoicesCount}</p>
        <p>Average days to payment: {kpis.averageDaysToPayment.toFixed(1)}</p>
        <p>Labor % revenue: {percent(kpis.laborPercentRevenue)}</p>
        <p>Materials % revenue: {percent(kpis.materialsPercentRevenue)}</p>
      </section>
    </div>
  );
}
