import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency, toNumber } from "@/lib/utils";

export default async function AccountingPage() {
  const auth = await requireAuth();

  const [outstandingTotal, outstandingCount] = isDemoMode()
    ? [12450, 3]
    : await Promise.all([
        prisma.invoice
          .aggregate({
            where: { job: { orgId: auth.orgId }, status: { in: ["SENT", "OVERDUE"] } },
            _sum: { total: true },
          })
          .then((v) => toNumber(v._sum.total)),
        prisma.invoice.count({ where: { job: { orgId: auth.orgId }, status: { in: ["SENT", "OVERDUE"] } } }),
      ]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Accounting Bridge</h2>
        <p className="mt-1 text-sm text-slate-600">Joist for estimates/invoices. This app for job documentation and cost tracking.</p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding AR</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(outstandingTotal)}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open Invoices</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{outstandingCount}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Exports for QuickBooks</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <a href="/api/export/time-entries" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Time CSV</a>
          <a href="/api/export/expenses" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Expenses CSV</a>
          <a href="/api/export/job-profitability" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Profitability CSV</a>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Joist Import Workflow</h3>
        <p className="mt-1 text-xs text-slate-500">Export from Joist and upload on the Leads page to update pipeline status.</p>
        <a href="/leads" className="mt-3 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm">Open Leads Import</a>
      </section>
    </div>
  );
}
