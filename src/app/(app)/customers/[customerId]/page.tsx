import Link from "next/link";
import { endOfDay, format, startOfDay } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getJobs } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { currency } from "@/lib/utils";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const auth = await requireAuth();
  const { customerId } = await params;

  const [customer, jobs] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, orgId: auth.orgId },
    }),
    getJobs({
      orgId: auth.orgId,
      role: auth.role,
      userId: auth.userId,
      status: "ALL",
      q: "",
      view: "all",
    }),
  ]);

  if (!customer) {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Customer not found.</p>
          <Link href="/customers" className="mt-2 inline-block text-xs text-teal-700 underline">
            Back to customers
          </Link>
        </section>
      </div>
    );
  }

  const customerJobs = jobs.filter((job) => job.customer.id === customer.id);
  const totalRevenue = customerJobs.reduce((sum, job) => {
    return (
      sum +
      job.invoices.reduce((acc, invoice) => {
        return acc + Number(invoice.total ?? 0);
      }, 0)
    );
  }, 0);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const todayJobs = customerJobs.filter((job) =>
    job.scheduleEvents?.some((event) => event.startAt >= todayStart && event.startAt <= todayEnd),
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Client Hub</p>
            <h2 className="text-xl font-semibold text-slate-900">{customer.name}</h2>
            {customer.address ? (
              <p className="text-sm text-slate-600">{customer.address}</p>
            ) : null}
            <div className="mt-1 space-y-0.5 text-xs text-slate-600">
              {customer.phone ? <p>Phone: {customer.phone}</p> : null}
              {customer.email ? <p>Email: {customer.email}</p> : null}
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Total billed (all jobs)</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{currency(totalRevenue)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link
            href={`/jobs?customerId=${customer.id}#new-job`}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
          >
            New job for this customer
          </Link>
          <Link
            href={`/jobs?q=${encodeURIComponent(customer.name)}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
          >
            View jobs list
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Today&apos;s visits for this client</h3>
        <p className="mt-1 text-xs text-slate-500">
          Jobs for this customer that have scheduled blocks today.
        </p>
        <div className="mt-2 space-y-2 text-sm">
          {todayJobs.map((job) => {
            const eventsToday =
              job.scheduleEvents?.filter(
                (event) => event.startAt >= todayStart && event.startAt <= todayEnd,
              ) ?? [];
            return (
              <article
                key={job.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{job.jobName}</p>
                    <p className="text-xs text-slate-500">{job.address}</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {eventsToday.map((event) => (
                        <li key={event.id}>
                          {format(event.startAt, "h:mm a")} – {format(event.endAt, "h:mm a")}
                          {event.notes ? <span className="text-slate-500"> · {event.notes}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 text-xs">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    >
                      Open hub
                    </Link>
                    <Link
                      href={`/time?jobId=${job.id}`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    >
                      Time
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
          {todayJobs.length === 0 ? (
            <p className="text-sm text-slate-500">No visits scheduled today for this client.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">All jobs for this client</h3>
        <p className="mt-1 text-xs text-slate-500">Tap a job to open its hub.</p>
        <div className="mt-2 space-y-2 text-sm">
          {customerJobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2"
            >
              <div>
                <p className="font-medium text-slate-900">{job.jobName}</p>
                <p className="text-xs text-slate-500">{job.address}</p>
              </div>
              <span className="text-xs text-slate-500">Open hub</span>
            </Link>
          ))}
          {customerJobs.length === 0 ? (
            <p className="text-sm text-slate-500">
              No jobs yet for this client. Use &quot;New job for this customer&quot; above to start one.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

