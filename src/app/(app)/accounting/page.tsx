import Link from "next/link";
import { startOfMonth, subDays, format } from "date-fns";
import { ExportByMonth } from "@/components/export-by-month";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getLaborCost } from "@/lib/time-entry";
import { currency, toNumber } from "@/lib/utils";

export default async function AccountingPage() {
  const auth = await requireAuth();
  const now = new Date();
  const monthStart = startOfMonth(now);
  const last30Start = subDays(now, 30);

  type InvoicePreview = {
    id: string;
    status: string;
    total: number;
    dueDate: Date | null;
    sentAt: Date | null;
    createdAt: Date;
    job: { id: string; jobName: string; customer: { name: string } };
  };
  type PaymentPreview = {
    id: string;
    amount: number;
    date: Date;
    method: string;
    invoice: { job: { id: string; jobName: string; customer: { name: string } } };
  };
  type ExpensePreview = {
    id: string;
    vendor: string;
    amount: number;
    date: Date;
    category: string;
    job: { id: string; jobName: string; customer: { name: string } };
  };

  const demoInvoices: InvoicePreview[] = [
    {
      id: "inv1",
      status: "OVERDUE",
      total: 6500,
      dueDate: subDays(now, 5),
      sentAt: subDays(now, 20),
      createdAt: subDays(now, 25),
      job: { id: "job1", jobName: "Re-roof - Maple St", customer: { name: "Lewis" } },
    },
    {
      id: "inv2",
      status: "SENT",
      total: 4200,
      dueDate: subDays(now, -4),
      sentAt: subDays(now, 2),
      createdAt: subDays(now, 3),
      job: { id: "job2", jobName: "Kitchen Remodel", customer: { name: "Patel" } },
    },
    {
      id: "inv3",
      status: "SENT",
      total: 1750,
      dueDate: subDays(now, 10),
      sentAt: subDays(now, 12),
      createdAt: subDays(now, 13),
      job: { id: "job3", jobName: "Siding Repair", customer: { name: "Nguyen" } },
    },
  ];
  const demoPayments: PaymentPreview[] = [
    { id: "pay1", amount: 2200, date: subDays(now, 2), method: "Card", invoice: { job: { id: "job4", jobName: "Deck Build", customer: { name: "Harris" } } } },
    { id: "pay2", amount: 1800, date: subDays(now, 9), method: "ACH", invoice: { job: { id: "job5", jobName: "Bath Update", customer: { name: "Garcia" } } } },
  ];
  const demoExpenses: ExpensePreview[] = [
    { id: "exp1", vendor: "Home Depot", amount: 480, date: subDays(now, 3), category: "MATERIALS", job: { id: "job2", jobName: "Kitchen Remodel", customer: { name: "Patel" } } },
    { id: "exp2", vendor: "ABC Rentals", amount: 220, date: subDays(now, 6), category: "EQUIPMENT", job: { id: "job1", jobName: "Re-roof - Maple St", customer: { name: "Lewis" } } },
  ];

  const [
    outstandingTotal,
    outstandingCount,
    mtdInvoiced,
    mtdCollected,
    last30Expenses,
    last30Labor,
    unpaidInvoicesRaw,
    recentPaymentsRaw,
    recentExpensesRaw,
  ] = isDemoMode()
    ? [
        12450,
        3,
        18200,
        9650,
        2140,
        5280,
        demoInvoices,
        demoPayments,
        demoExpenses,
      ]
    : await Promise.all([
        prisma.invoice
          .aggregate({
            where: { job: { orgId: auth.orgId }, status: { in: ["SENT", "OVERDUE"] } },
            _sum: { total: true },
          })
          .then((v) => toNumber(v._sum.total)),
        prisma.invoice.count({ where: { job: { orgId: auth.orgId }, status: { in: ["SENT", "OVERDUE"] } } }),
        prisma.invoice
          .aggregate({
            where: {
              job: { orgId: auth.orgId },
              status: { in: ["SENT", "PAID", "OVERDUE"] },
              createdAt: { gte: monthStart },
            },
            _sum: { total: true },
          })
          .then((v) => toNumber(v._sum.total)),
        prisma.payment
          .aggregate({
            where: { invoice: { job: { orgId: auth.orgId } }, date: { gte: monthStart } },
            _sum: { amount: true },
          })
          .then((v) => toNumber(v._sum.amount)),
        prisma.expense
          .aggregate({
            where: { job: { orgId: auth.orgId }, date: { gte: last30Start } },
            _sum: { amount: true },
          })
          .then((v) => toNumber(v._sum.amount)),
        prisma.timeEntry
          .findMany({
            where: { job: { orgId: auth.orgId }, start: { gte: last30Start } },
            select: { start: true, end: true, breakMinutes: true, hourlyRateLoaded: true },
            take: 2000,
            orderBy: { start: "desc" },
          })
          .then((rows) =>
            rows.reduce((sum, entry) => {
              return sum + getLaborCost(entry);
            }, 0),
          ),
        prisma.invoice.findMany({
          where: { job: { orgId: auth.orgId }, status: { in: ["SENT", "OVERDUE"] } },
          include: { job: { include: { customer: true } } },
          orderBy: [{ dueDate: "asc" }, { sentAt: "asc" }],
          take: 8,
        }),
        prisma.payment.findMany({
          where: { invoice: { job: { orgId: auth.orgId } } },
          include: { invoice: { include: { job: { include: { customer: true } } } } },
          orderBy: { date: "desc" },
          take: 8,
        }),
        prisma.expense.findMany({
          where: { job: { orgId: auth.orgId } },
          include: { job: { include: { customer: true } } },
          orderBy: { date: "desc" },
          take: 8,
        }),
      ]);

  const unpaidInvoices: InvoicePreview[] = unpaidInvoicesRaw.map((invoice) => ({
    id: invoice.id,
    status: invoice.status,
    total: toNumber(invoice.total),
    dueDate: invoice.dueDate ?? null,
    sentAt: invoice.sentAt ?? null,
    createdAt: invoice.createdAt ?? now,
    job: { id: invoice.job.id, jobName: invoice.job.jobName, customer: { name: invoice.job.customer.name } },
  }));
  const recentPayments: PaymentPreview[] = recentPaymentsRaw.map((payment) => ({
    id: payment.id,
    amount: toNumber(payment.amount),
    date: payment.date,
    method: payment.method,
    invoice: { job: { id: payment.invoice.job.id, jobName: payment.invoice.job.jobName, customer: { name: payment.invoice.job.customer.name } } },
  }));
  const recentExpenses: ExpensePreview[] = recentExpensesRaw.map((expense) => ({
    id: expense.id,
    vendor: expense.vendor,
    amount: toNumber(expense.amount),
    date: expense.date,
    category: expense.category,
    job: { id: expense.job.id, jobName: expense.job.jobName, customer: { name: expense.job.customer.name } },
  }));

  const agingBuckets = [
    { label: "0–7 days", min: 0, max: 7, total: 0, count: 0 },
    { label: "8–30 days", min: 8, max: 30, total: 0, count: 0 },
    { label: "31–60 days", min: 31, max: 60, total: 0, count: 0 },
    { label: "61+ days", min: 61, max: 9999, total: 0, count: 0 },
  ];
  for (const invoice of unpaidInvoices) {
    const anchor = invoice.dueDate ?? invoice.sentAt ?? invoice.createdAt ?? now;
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(anchor).getTime()) / 86400000));
    const bucket = agingBuckets.find((b) => ageDays >= b.min && ageDays <= b.max);
    if (!bucket) continue;
    bucket.total += invoice.total;
    bucket.count += 1;
  }

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
        <h2 className="text-base font-semibold text-slate-900">Accounting overview</h2>
        <p className="mt-1 text-xs text-slate-500">Month-to-date and last 30 days snapshot for cash flow and payroll load.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Invoiced (MTD)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(mtdInvoiced)}</p>
            <p className="mt-1 text-[11px] text-slate-500">Since {format(monthStart, "MMM d")}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Collected (MTD)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(mtdCollected)}</p>
            <p className="mt-1 text-[11px] text-slate-500">Payments received</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Unpaid invoices (total owed)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(outstandingTotal)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Open invoices (count)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{outstandingCount}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Labor cost (last 30)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(last30Labor)}</p>
            <p className="mt-1 text-[11px] text-slate-500">Time entries since {format(last30Start, "MMM d")}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Expenses (last 30)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{currency(last30Expenses)}</p>
            <p className="mt-1 text-[11px] text-slate-500">Materials, subs, permits, etc.</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Accounts receivable aging</h3>
        <p className="mt-1 text-xs text-slate-500">Age is based on due date (or sent date if due date is missing).</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {agingBuckets.map((bucket) => (
            <article key={bucket.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">{bucket.label}</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{currency(bucket.total)}</p>
              <p className="text-[11px] text-slate-500">{bucket.count} invoice{bucket.count === 1 ? "" : "s"}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Unpaid invoices</h3>
        <p className="mt-1 text-xs text-slate-500">Top open balances for follow-up.</p>
        <div className="mt-3 space-y-2 text-sm">
          {unpaidInvoices.map((invoice) => (
            <article key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <Link href={`/jobs/${invoice.job.id}`} className="font-medium text-slate-900 hover:underline">
                  {invoice.job.jobName}
                </Link>
                <p className="text-xs text-slate-500">{invoice.job.customer.name}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">
                  {invoice.status} · Due {invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d") : "—"}
                </p>
                <p className="font-semibold text-slate-900">{currency(invoice.total)}</p>
              </div>
            </article>
          ))}
          {unpaidInvoices.length === 0 ? <p className="text-sm text-slate-500">No unpaid invoices.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent payments</h3>
        <p className="mt-1 text-xs text-slate-500">Latest payments received.</p>
        <div className="mt-3 space-y-2 text-sm">
          {recentPayments.map((payment) => (
            <article key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <Link href={`/jobs/${payment.invoice.job.id}`} className="font-medium text-slate-900 hover:underline">
                  {payment.invoice.job.jobName}
                </Link>
                <p className="text-xs text-slate-500">{payment.invoice.job.customer.name}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{payment.method} · {format(new Date(payment.date), "MMM d")}</p>
                <p className="font-semibold text-slate-900">{currency(payment.amount)}</p>
              </div>
            </article>
          ))}
          {recentPayments.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent expenses</h3>
        <p className="mt-1 text-xs text-slate-500">Latest expenses logged on job hubs.</p>
        <div className="mt-3 space-y-2 text-sm">
          {recentExpenses.map((expense) => (
            <article key={expense.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <p className="font-medium text-slate-900">{expense.vendor}</p>
                <p className="text-xs text-slate-500">
                  {expense.job.customer.name} ·{" "}
                  <Link href={`/jobs/${expense.job.id}`} className="hover:underline">
                    {expense.job.jobName}
                  </Link>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{expense.category} · {format(new Date(expense.date), "MMM d")}</p>
                <p className="font-semibold text-slate-900">{currency(expense.amount)}</p>
              </div>
            </article>
          ))}
          {recentExpenses.length === 0 ? <p className="text-sm text-slate-500">No expenses logged yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Export by month</h3>
        <p className="mt-1 text-xs text-slate-500">Download a ZIP with time and job profitability for the chosen month. Open the CSVs in Excel or Google Sheets. Expenses are not included (use your bank/CC feed for those).</p>
        <ExportByMonth />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Joist import</h3>
        <p className="mt-1 text-xs text-slate-500">Export from Joist and upload on the Jobs page to update pipeline status.</p>
        <Link href="/jobs#joist-import" className="mt-3 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm">Open Joist Import</Link>
      </section>
    </div>
  );
}
