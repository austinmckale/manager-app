import Link from "next/link";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { JobStatus } from "@prisma/client";
import { createJobAction } from "@/app/(app)/actions";
import { JobStatusBadge } from "@/components/job-status-badge";
import { requireAuth } from "@/lib/auth";
import { getCustomers, getJobs, getJobsPageAlerts } from "@/lib/data";
import { canManageOrg } from "@/lib/permissions";
import { SERVICE_TAG_OPTIONS } from "@/lib/service-tags";
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
  searchParams: Promise<{ status?: string; q?: string; view?: "today" | "week" | "all"; customerId?: string }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;
  const status = params.status ?? "ALL";
  const q = params.q ?? "";
  // Default to "This Week" so the jobs list stays focused on active work.
  const view = params.view ?? "week";
  const preselectedCustomerId = params.customerId ?? "";

  const [customers, jobs, alerts] = await Promise.all([
    getCustomers(auth.orgId),
    getJobs({
      orgId: auth.orgId,
      role: auth.role,
      userId: auth.userId,
      status,
      q,
      view,
    }),
    canManageOrg(auth.role) ? getJobsPageAlerts({ orgId: auth.orgId, role: auth.role, userId: auth.userId }) : Promise.resolve({ overdueTasks: [], jobIdsWithMissingReceipts: [] }),
  ]);

  const hasOverdue = alerts.overdueTasks.length > 0;
  const hasMissingReceipts = alerts.jobIdsWithMissingReceipts.length > 0;
  const jobNamesById = new Map(jobs.map((j) => [j.id, j.jobName]));

  return (
    <div className="space-y-4">
      {(hasOverdue || hasMissingReceipts) ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Needs attention</h2>
          <p className="mt-0.5 text-xs text-slate-600">From Today’s Priority Queue — fix these from the job page.</p>
          {hasOverdue ? (
            <div id="overdue-tasks" className="mt-3">
              <p className="text-xs font-medium text-amber-800">Overdue tasks ({alerts.overdueTasks.length})</p>
              <ul className="mt-1 space-y-1">
                {alerts.overdueTasks.map((task) => (
                  <li key={task.id}>
                    <Link href={`/jobs/${task.job.id}`} className="text-sm text-amber-900 underline hover:no-underline">
                      {task.title} — {task.job.jobName}
                    </Link>
                    <span className="ml-1 text-xs text-slate-500">Due {task.dueDate ? format(task.dueDate, "MMM d, yyyy") : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hasMissingReceipts ? (
            <div id="missing-receipts" className="mt-3">
              <p className="text-xs font-medium text-sky-800">Jobs with expenses missing receipts ({alerts.jobIdsWithMissingReceipts.length})</p>
              <ul className="mt-1 space-y-1">
                {alerts.jobIdsWithMissingReceipts.map((jobId) => (
                  <li key={jobId}>
                    <Link href={`/jobs/${jobId}#finance`} className="text-sm text-sky-900 underline hover:no-underline">
                      {jobNamesById.get(jobId) ?? "Job"} — add receipt in Expense Ledger (section 3) or Photo + Receipt Capture (section 2)
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section id="new-job" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">New Job</h2>
        <p className="mt-1 text-xs text-slate-500">
          Create a job, then link an existing client or add a new one. Or <Link href="/leads" className="text-teal-600 hover:underline">convert a lead to a job</Link> on Leads.
        </p>
        <form action={createJobAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="jobName" required placeholder="Job name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input name="address" required placeholder="Job address" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select name="status" defaultValue={JobStatus.LEAD} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {statusOptions
              .filter((option) => option !== "ALL")
              .map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
          </select>
          <input name="tags" placeholder="Optional extra tags (legacy comma-separated)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <fieldset className="rounded-xl border border-slate-200 p-3 text-sm sm:col-span-2">
            <legend className="px-1 text-xs font-medium text-slate-600">Service Tags (website routing)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {SERVICE_TAG_OPTIONS.map((tag) => (
                <label key={tag.slug} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input type="checkbox" name="serviceTags" value={tag.slug} defaultChecked={tag.slug === "general-remodeling"} />
                  {tag.label}
                </label>
              ))}
            </div>
          </fieldset>
          <input name="startDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="endDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedLaborBudget" type="number" step="0.01" placeholder="Labor budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedMaterialsBudget" type="number" step="0.01" placeholder="Materials budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedTotalBudget" type="number" step="0.01" placeholder="Total budget" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <p className="text-[11px] text-slate-500 sm:col-span-2">Budgets = your cost targets (drive the &quot;Labor vs Budget&quot; / &quot;Materials vs Budget&quot; bars on the job). Revenue comes from estimates &amp; invoices (section 4 on the job).</p>

          <div className="mt-2 border-t border-slate-200 pt-3 sm:col-span-2">
            <p className="text-xs font-medium text-slate-600">Client (who is this job for?)</p>
            <select name="customerId" defaultValue={preselectedCustomerId} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">+ New client (fill in below)</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input name="newCustomerName" placeholder="New client name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
              <input name="newCustomerPhone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="newCustomerEmail" type="email" placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="newCustomerAddress" placeholder="Client address (if different from job)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            </div>
          </div>

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
          const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
          const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
          const hoursByWorker = new Map<string, { name: string; hours: number }>();
          for (const entry of job.timeEntries) {
            if (!entry.end) continue;
            if (entry.start < weekStart || entry.start > weekEnd) continue;
            const hours = (entry.end.getTime() - entry.start.getTime()) / (1000 * 60 * 60);
            const name = entry.worker?.fullName ?? "—";
            const cur = hoursByWorker.get(entry.workerId) ?? { name, hours: 0 };
            cur.hours += hours;
            hoursByWorker.set(entry.workerId, cur);
          }
          const laborSummary = [...hoursByWorker.values()].sort((a, b) => b.hours - a.hours).map((w) => `${w.name} (${w.hours.toFixed(1)}h)`).join(", ");

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
                  {laborSummary ? (
                    <p className="mt-1 text-xs text-slate-600">This week: {laborSummary}</p>
                  ) : null}
                </div>
                <JobStatusBadge status={job.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>Revenue: {currency(invoiceTotal)}</p>
                <p>Expenses: {currency(expenseTotal)}</p>
              </div>
              {job.categoryTags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {job.categoryTags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{tag}</span>
                  ))}
                </div>
              ) : null}
            </Link>
          );
        })}
        {jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs found for this view.</p> : null}
      </section>
    </div>
  );
}
