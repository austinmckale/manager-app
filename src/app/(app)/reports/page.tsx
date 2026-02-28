import Link from "next/link";
import { endOfWeek, format, startOfWeek, subDays } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { demoCustomers, demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getLaborCost, getWorkedHours } from "@/lib/time-entry";
import { currency, percent } from "@/lib/utils";

export default async function ReportsPage() {
  const auth = await requireAuth();
  const now = new Date();
  const last30Cutoff = subDays(now, 30);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const jobs = isDemoMode()
    ? [
        {
          ...demoJobs[0],
          estimates: [],
          changeOrders: [],
          invoices: [],
          timeEntries: [],
          expenses: [],
          customer: demoCustomers[0],
        },
      ]
    : await prisma.job.findMany({
        where: { orgId: auth.orgId },
        include: {
          estimates: true,
          changeOrders: true,
          invoices: true,
          timeEntries: true,
          expenses: true,
          customer: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });

  const jobRows = jobs.map((job) => ({ job, costing: computeJobCosting(job) }));

  const totals = jobRows.reduce(
    (acc, row) => {
      acc.revenue += row.costing.revenue;
      acc.totalCost += row.costing.totalCost;
      acc.grossProfit += row.costing.grossProfit;
      acc.laborCost += row.costing.laborCost;
      acc.expensesTotal += row.costing.expensesTotal;
      acc.materialCost += row.costing.expensesByCategory.MATERIALS;
      return acc;
    },
    { revenue: 0, totalCost: 0, grossProfit: 0, laborCost: 0, expensesTotal: 0, materialCost: 0 },
  );

  const grossMarginPercent = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;

  const allInvoices = jobs.flatMap((job) => job.invoices);
  const openInvoices = allInvoices.filter((invoice) => invoice.status === "SENT" || invoice.status === "OVERDUE");
  const openInvoiceTotal = openInvoices.reduce((acc, invoice) => acc + Number(invoice.total ?? 0), 0);

  const last30Labor = jobs.reduce((acc, job) => {
    const labor = job.timeEntries.reduce((sum, entry) => {
      if (!entry.end || entry.start < last30Cutoff) return sum;
      return sum + getLaborCost(entry);
    }, 0);
    return acc + labor;
  }, 0);

  const last30Materials = jobs.reduce((acc, job) => {
    const materials = job.expenses.reduce((sum, expense) => {
      if (expense.date < last30Cutoff) return sum;
      if (expense.category !== "MATERIALS") return sum;
      return sum + Number(expense.amount ?? 0);
    }, 0);
    return acc + materials;
  }, 0);

  const weakestMarginJobs = jobRows
    .filter((row) => row.costing.revenue > 0)
    .sort((a, b) => a.costing.grossMarginPercent - b.costing.grossMarginPercent)
    .slice(0, 8);

  const weeklyPayrollEntries = isDemoMode()
    ? []
    : await prisma.timeEntry.findMany({
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

  const weeklyPayrollByWorker = new Map<
    string,
    { workerName: string; hours: number; pay: number; latestRate: number }
  >();
  for (const entry of weeklyPayrollEntries) {
    const row = weeklyPayrollByWorker.get(entry.workerId) ?? {
      workerName: entry.worker.fullName,
      hours: 0,
      pay: 0,
      latestRate: 0,
    };
    row.hours += getWorkedHours(entry);
    row.pay += getLaborCost(entry);
    row.latestRate = Number(entry.hourlyRateLoaded ?? 0);
    weeklyPayrollByWorker.set(entry.workerId, row);
  }
  const weeklyPayrollRows = [...weeklyPayrollByWorker.entries()]
    .map(([workerId, row]) => ({ workerId, ...row }))
    .sort((a, b) => b.pay - a.pay);
  const weeklyPayrollTotals = weeklyPayrollRows.reduce(
    (acc, row) => {
      acc.hours += row.hours;
      acc.pay += row.pay;
      return acc;
    },
    { hours: 0, pay: 0 },
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Financial Dashboard</h2>
        <p className="mt-1 text-xs text-slate-500">Live totals across jobs for margin, labor, materials, and collections.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Revenue</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(totals.revenue)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross Profit</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(totals.grossProfit)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross Margin</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{percent(grossMarginPercent)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Open Invoices</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(openInvoiceTotal)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{openInvoices.length} unpaid</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Labor Cost</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(totals.laborCost)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Materials</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(totals.materialCost)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Labor (30d)</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(last30Labor)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Materials (30d)</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(last30Materials)}</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Payroll Week (By Employee)</h2>
          <Link href="/time" className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
            Open Payroll
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}.
        </p>
        <div className="mt-3 space-y-2">
          {weeklyPayrollRows.map((row) => (
            <article key={row.workerId} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
              <div>
                <p className="font-medium text-slate-900">{row.workerName}</p>
                <p className="text-xs text-slate-500">{currency(row.latestRate)}/hr</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-slate-900">{row.hours.toFixed(2)}h</p>
                <p className="text-xs text-slate-500">{currency(row.pay)}</p>
              </div>
            </article>
          ))}
          {weeklyPayrollRows.length === 0 ? (
            <p className="text-sm text-slate-500">No completed time entries this week yet.</p>
          ) : null}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Week total: {weeklyPayrollTotals.hours.toFixed(2)}h - {currency(weeklyPayrollTotals.pay)}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Exports (CSV)</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <a href="/api/export/time-entries" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            Time Entries CSV
          </a>
          <a href="/api/export/expenses" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            Expenses CSV
          </a>
          <a href="/api/export/job-profitability" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            Job Profitability CSV
          </a>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Margin Watch (Lowest First)</h2>
        <p className="mt-1 text-xs text-slate-500">Fast way to spot jobs hurting margin.</p>
        <div className="mt-3 space-y-2">
          {weakestMarginJobs.map(({ job, costing }) => (
            <article key={job.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <div>
                <Link href={`/jobs/${job.id}`} className="font-semibold text-slate-900 hover:underline">
                  {job.jobName}
                </Link>
                <p className="text-xs text-slate-500">{job.customer.name}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-slate-900">{percent(costing.grossMarginPercent)}</p>
                <p className="text-xs text-slate-500">
                  {currency(costing.grossProfit)} / {currency(costing.revenue)}
                </p>
              </div>
            </article>
          ))}
          {weakestMarginJobs.length === 0 ? (
            <p className="text-sm text-slate-500">No margin data yet. Open jobs and start logging time, expenses, and invoices.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        {jobRows.map(({ job, costing }) => (
          <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
            <Link href={`/jobs/${job.id}`} className="font-semibold text-slate-900 hover:underline">
              {job.jobName}
            </Link>
            <p className="text-xs text-slate-500">{job.customer.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
              <p>Revenue: {currency(costing.revenue)}</p>
              <p>Total cost: {currency(costing.totalCost)}</p>
              <p>Gross profit: {currency(costing.grossProfit)}</p>
              <p>Margin: {percent(costing.grossMarginPercent)}</p>
            </div>
          </article>
        ))}
        {jobRows.length === 0 ? (
          <article className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No jobs yet. Once you add jobs and log time/expenses/invoices, this dashboard will populate.
          </article>
        ) : null}
      </section>
    </div>
  );
}
