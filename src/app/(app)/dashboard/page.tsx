import { endOfDay, format, startOfDay, subDays } from "date-fns";
import Link from "next/link";
import { LeadSource } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { computeDashboardKpis } from "@/lib/kpis";
import { prisma } from "@/lib/prisma";
import { currency, percent, toNumber } from "@/lib/utils";

export default async function DashboardPage() {
  const auth = await requireAuth();
  const kpis = await computeDashboardKpis(auth.orgId);

  const websiteLeadWhere = {
    orgId: auth.orgId,
    source: LeadSource.WEBSITE_FORM,
  };

  const [unbilledJobsCount, unpaidInvoicesTotal, laborHours7d, newLeads7d, formSubmissionStats, recentFormLeads] =
    isDemoMode()
      ? [
          2,
          12450,
          86.5,
          7,
          { today: 2, last7: 5, last30: 12 },
          [
            { id: "1", contactName: "Jane Doe", serviceType: "Kitchen Remodel", createdAt: new Date() },
            { id: "2", contactName: "John Smith", serviceType: "Bathroom", createdAt: new Date() },
          ] as { id: string; contactName: string; serviceType: string | null; createdAt: Date }[],
        ]
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
              const minutes = (end.getTime() - row.start.getTime()) / 60000;
              return acc + minutes / 60;
            }, 0),
          ),
          prisma.lead.count({
            where: {
              orgId: auth.orgId,
              createdAt: { gte: startOfDay(subDays(new Date(), 7)), lte: endOfDay(new Date()) },
            },
          }),
          Promise.all([
            prisma.lead.count({
              where: {
                ...websiteLeadWhere,
                createdAt: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) },
              },
            }),
            prisma.lead.count({
              where: {
                ...websiteLeadWhere,
                createdAt: { gte: startOfDay(subDays(new Date(), 7)), lte: endOfDay(new Date()) },
              },
            }),
            prisma.lead.count({
              where: {
                ...websiteLeadWhere,
                createdAt: { gte: startOfDay(subDays(new Date(), 30)), lte: endOfDay(new Date()) },
              },
            }),
          ]).then(([today, last7, last30]) => ({ today, last7, last30 })),
          prisma.lead.findMany({
            where: websiteLeadWhere,
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { id: true, contactName: true, serviceType: true, createdAt: true },
          }),
        ]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Daily Scoreboard</h2>
        <p className="text-xs text-slate-500">Manager view: money, momentum, and labor in one glance.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Unbilled Jobs</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{unbilledJobsCount}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Unpaid Invoices</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{currency(unpaidInvoicesTotal)}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">New Leads (7d)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{newLeads7d}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Labor (7d)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{laborHours7d.toFixed(1)}h</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Company health</h2>
        <p className="mt-1 text-xs text-slate-500">
          Margin and ratios use <strong>completed jobs only</strong> (last ~3 months): revenue from sent/paid invoices on those jobs, <strong>labor from time logged on each job</strong>, <strong>materials from job expenses</strong> (category Materials). Lead win rate from leads; avg days to pay from invoice sent → payment. 0% means no completed jobs with invoices yet.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          To get useful numbers: mark jobs Complete, log time and expenses on job hubs, then send and collect invoices. Set targets in Settings → Targets.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            title="Profit after labor and materials, as % of revenue. Higher is better."
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross margin</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{percent(kpis.grossMarginPercent)}</p>
          </article>
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            title="Cents of every revenue dollar that go to labor. Lower leaves more for margin."
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Labor % of revenue</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{percent(kpis.laborPercentRevenue)}</p>
          </article>
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            title="Cents of every revenue dollar spent on materials (completed jobs only)."
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Materials % of revenue</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{percent(kpis.materialsPercentRevenue)}</p>
          </article>
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            title="Won leads ÷ (won + lost). How often you close when a lead is decided."
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Lead win rate</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{percent(kpis.leadToWinRate)}</p>
          </article>
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            title="Average days from invoice sent to payment received."
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg days to pay</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{kpis.averageDaysToPayment.toFixed(1)}</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Form submissions (website)</h2>
          <Link
            href="/leads?source=WEBSITE_FORM"
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            View all
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="text-slate-500">Today:</span>
          <span className="font-medium text-slate-900">{formSubmissionStats.today}</span>
          <span className="text-slate-500">7d:</span>
          <span className="font-medium text-slate-900">{formSubmissionStats.last7}</span>
          <span className="text-slate-500">30d:</span>
          <span className="font-medium text-slate-900">{formSubmissionStats.last30}</span>
        </div>
        {recentFormLeads.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No website form submissions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentFormLeads.map((lead) => (
              <li key={lead.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href="/leads" className="font-medium text-slate-900 hover:underline">
                  {lead.contactName}
                </Link>
                <span className="text-slate-500">
                  {lead.serviceType ?? "-"} · {format(lead.createdAt, "MMM d, yyyy")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

