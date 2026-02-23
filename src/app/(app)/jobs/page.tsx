import Link from "next/link";
import { format } from "date-fns";
import { JobStatus } from "@prisma/client";
import { createJobAction } from "@/app/(app)/actions";
import { JobStatusBadge } from "@/components/job-status-badge";
import { requireAuth } from "@/lib/auth";
import { getCustomers, getJobs } from "@/lib/data";
import { currency, toNumber } from "@/lib/utils";

const statusOptions: Array<JobStatus | "ALL"> = [
  "ALL",
  "LEAD",
  "ESTIMATE",
  "SCHEDULED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "PAID",
];

const viewOptions = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "all", label: "All" },
] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; view?: "today" | "week" | "all" }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;
  const status = params.status ?? "ALL";
  const q = params.q ?? "";
  const view = params.view ?? "all";

  const [customers, jobs] = await Promise.all([
    getCustomers(auth.orgId),
    getJobs({
      orgId: auth.orgId,
      role: auth.role,
      userId: auth.userId,
      status,
      q,
      view,
    }),
  ]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">New Job</h2>
        <form action={createJobAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <select name="customerId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <input name="jobName" required placeholder="Job name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="address" required placeholder="Address" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select name="status" defaultValue={JobStatus.LEAD} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {statusOptions
              .filter((option) => option !== "ALL")
              .map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
          </select>
          <input name="tags" placeholder="Tags comma-separated" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="startDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="endDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedLaborBudget" type="number" step="0.01" placeholder="Labor budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedMaterialsBudget" type="number" step="0.01" placeholder="Materials budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedTotalBudget" type="number" step="0.01" placeholder="Total budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
            Create Job
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <form className="grid gap-2 sm:grid-cols-3">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search jobs or customers"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <select name="status" defaultValue={status} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All statuses" : option.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select name="view" defaultValue={view} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {viewOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-3">
            Apply filters
          </button>
        </form>
      </section>

      <section className="space-y-2">
        {jobs.map((job) => {
          const invoiceTotal = job.invoices.reduce((acc, invoice) => acc + toNumber(invoice.total), 0);
          const expenseTotal = job.expenses.reduce((acc, expense) => acc + toNumber(expense.amount), 0);
          const nextEvent = job.scheduleEvents?.[0];

          return (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold text-slate-900">{job.jobName}</p>
                  <p className="text-sm text-slate-600">{job.customer.name}</p>
                  <p className="text-xs text-slate-500">{job.address}</p>
                  {nextEvent ? (
                    <p className="mt-1 text-xs text-teal-700">Next: {format(nextEvent.startAt, "EEE MMM d, h:mm a")}</p>
                  ) : null}
                </div>
                <JobStatusBadge status={job.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>Revenue: {currency(invoiceTotal)}</p>
                <p>Expenses: {currency(expenseTotal)}</p>
              </div>
            </Link>
          );
        })}
        {jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs found for this view.</p> : null}
      </section>
    </div>
  );
}
