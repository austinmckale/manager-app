import { ExportByMonth } from "@/components/export-by-month";
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
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">How invoice & expense tracking works</h2>
        <ol className="mt-2 list-decimal list-inside space-y-1 text-sm text-teal-800">
          <li><strong>Expenses:</strong> Log on each job hub (section 3 → Add Expense). Attach receipts from Capture. They feed cost health and the monthly export.</li>
          <li><strong>Invoices:</strong> On the job hub (section 4): Create Estimate → Approve → To Invoice → Send Invoice. Download PDF for the client. When paid, Add payment on that invoice.</li>
          <li><strong>Export:</strong> Use &quot;Export by month&quot; below to download time and job profitability (labor + P&amp;L). Expenses stay in the app and in your bank/CC feed — no expense export to avoid double-counting.</li>
        </ol>
        <p className="mt-2 text-xs text-teal-700">Unpaid total below = invoices you’ve sent (SENT/OVERDUE) not yet fully paid.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Accounting</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Unpaid invoices (total owed)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(outstandingTotal)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Open invoices (count)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{outstandingCount}</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Export by month</h3>
        <p className="mt-1 text-xs text-slate-500">Download a ZIP with time and job profitability for the chosen month. Open the CSVs in Excel or Google Sheets. Expenses are not included (use your bank/CC feed for those).</p>
        <ExportByMonth />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Joist import</h3>
        <p className="mt-1 text-xs text-slate-500">Export from Joist and upload on the Leads page to update pipeline status.</p>
        <a href="/leads" className="mt-3 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm">Open Leads Import</a>
      </section>
    </div>
  );
}
