import Link from "next/link";
import { subDays } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { demoCustomers, demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency, percent } from "@/lib/utils";

/** Margin bands for a quick read; a job's own target can replace these later. */
function marginHealth(marginPercent: number, revenue: number) {
  if (revenue <= 0) return { label: "No price yet", tone: "bg-slate-100 text-slate-600" };
  if (marginPercent >= 30) return { label: "On track", tone: "bg-emerald-100 text-emerald-800" };
  if (marginPercent >= 15) return { label: "Getting tight", tone: "bg-amber-100 text-amber-800" };
  return { label: "Losing money", tone: "bg-red-100 text-red-700" };
}

export default async function MoneyPage() {
  const auth = await requireAuth();
  const last30Cutoff = subDays(new Date(), 30);

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
        relationLoadStrategy: "join",
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
      acc.grossProfit += row.costing.grossProfit;
      return acc;
    },
    { revenue: 0, grossProfit: 0 },
  );
  const grossMarginPercent = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;

  const openInvoices = jobs
    .flatMap((job) => job.invoices)
    .filter((invoice) => invoice.status === "SENT" || invoice.status === "OVERDUE");
  const openInvoiceTotal = openInvoices.reduce((acc, invoice) => acc + Number(invoice.total ?? 0), 0);

  const last30Materials = jobs.reduce((acc, job) => {
    const materials = job.expenses.reduce((sum, expense) => {
      if (expense.date < last30Cutoff || expense.category !== "MATERIALS") return sum;
      return sum + Number(expense.amount ?? 0);
    }, 0);
    return acc + materials;
  }, 0);

  // Weakest margin first, so the job that needs attention is at the top.
  const sortedRows = [...jobRows].sort((a, b) => {
    if ((a.costing.revenue > 0) !== (b.costing.revenue > 0)) return a.costing.revenue > 0 ? -1 : 1;
    return a.costing.grossMarginPercent - b.costing.grossMarginPercent;
  });

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Money</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Profit so far</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(totals.grossProfit)}</p>
            <p className="text-xs text-slate-500">{percent(grossMarginPercent)} of {currency(totals.revenue)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Waiting to be paid</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(openInvoiceTotal)}</p>
            <p className="text-xs text-slate-500">
              {openInvoices.length} invoice{openInvoices.length === 1 ? "" : "s"}
            </p>
          </article>
          <article className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Materials bought, last 30 days</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currency(last30Materials)}</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">How each job is doing</h2>
        <p className="mt-1 text-xs text-slate-500">Jobs that need attention are at the top.</p>
        <ul className="mt-3 space-y-2">
          {sortedRows.map(({ job, costing }) => {
            const health = marginHealth(costing.grossMarginPercent, costing.revenue);
            return (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}/finance`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{job.jobName}</p>
                      <p className="truncate text-xs text-slate-500">{job.customer.name}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.tone}`}>
                      {health.label}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-700">
                    <p>
                      <span className="block text-slate-500">Price</span>
                      {currency(costing.revenue)}
                    </p>
                    <p>
                      <span className="block text-slate-500">Spent</span>
                      {currency(costing.totalCost)}
                    </p>
                    <p>
                      <span className="block text-slate-500">Profit</span>
                      {currency(costing.grossProfit)} ({percent(costing.grossMarginPercent)})
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
          {sortedRows.length === 0 ? (
            <li className="text-sm text-slate-500">No jobs yet. Import from Joist or add a job to see its numbers here.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">For the accountant</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <a href="/api/export/expenses" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              Expenses (spreadsheet)
            </a>
            <a href="/api/export/job-profitability" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              Job profit (spreadsheet)
            </a>
            <a href="/api/export/time-entries" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              Hours (spreadsheet)
            </a>
          </div>
        </details>
      </section>
    </div>
  );
}
