import { computeJobCosting } from "@/lib/costing";
import { requireAuth } from "@/lib/auth";
import { demoCustomers, demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency, percent } from "@/lib/utils";

export default async function ReportsPage() {
  const auth = await requireAuth();

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

  return (
    <div className="space-y-4">
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

      <section className="space-y-2">
        {jobs.map((job) => {
          const costing = computeJobCosting(job);
          return (
            <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold text-slate-900">{job.jobName}</p>
              <p className="text-xs text-slate-500">{job.customer.name}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
                <p>Revenue: {currency(costing.revenue)}</p>
                <p>Total cost: {currency(costing.totalCost)}</p>
                <p>Gross profit: {currency(costing.grossProfit)}</p>
                <p>Margin: {percent(costing.grossMarginPercent)}</p>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
