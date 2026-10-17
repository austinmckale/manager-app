import { Suspense } from "react";
import Link from "next/link";
import { LeadStage } from "@prisma/client";
import { endOfDay, format, startOfDay } from "date-fns";
import { requireAuth } from "@/lib/auth";
import { getTodayOpsSummary } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { createRoutePerf } from "@/lib/route-perf";
import { RoutePanelSkeleton } from "@/components/route-panel-skeleton";
import { leadContactLinks, leadWaitAlert } from "@/lib/lead-contact";

/**
 * Today, for an owner who runs the jobs himself: who to call back, where he's working,
 * and what still needs a photo or a receipt. Crew tools (clock-ins, payroll) live off this screen.
 */
export default function TodayPage() {
  return (
    <Suspense fallback={<RoutePanelSkeleton cards={3} sections={3} />}>
      <TodayPageContent />
    </Suspense>
  );
}

type CallbackLead = {
  id: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  serviceType: string | null;
  createdAt: Date;
};

async function TodayPageContent() {
  const perf = createRoutePerf("/today");
  let orgId = "";
  let role = "";
  try {
    const auth = await perf.time("auth", () => requireAuth());
    orgId = auth.orgId;
    role = auth.role;

    const [ops, callbacks] = await perf.time("bootstrap", () =>
      Promise.all([
        getTodayOpsSummary({ orgId: auth.orgId, userId: auth.userId, role: auth.role }),
        isDemoMode()
          ? Promise.resolve<CallbackLead[]>([
              {
                id: "demo-lead-new",
                contactName: "Dana Miller",
                phone: "555-303-4040",
                email: "dana@example.com",
                serviceType: "Bathroom remodel",
                createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
              },
            ])
          : prisma.lead.findMany({
              where: { orgId: auth.orgId, stage: LeadStage.NEW, jobId: null },
              orderBy: { createdAt: "asc" },
              take: 5,
              select: { id: true, contactName: true, phone: true, email: true, serviceType: true, createdAt: true },
            }),
      ]),
    );

    const todayJobIds = [...new Set(ops.todayEvents.map((event) => event.job.id))];
    const photosToday = await perf.time("photos", async () => {
      if (isDemoMode() || todayJobIds.length === 0) return new Map<string, number>();
      const rows = await prisma.fileAsset.groupBy({
        by: ["jobId"],
        where: {
          jobId: { in: todayJobIds },
          type: "PHOTO",
          createdAt: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) },
        },
        _count: { _all: true },
      });
      return new Map(rows.map((row) => [row.jobId, row._count._all]));
    });

    const jobs = new Map<string, { id: string; name: string; address: string | null; events: typeof ops.todayEvents }>();
    for (const event of ops.todayEvents) {
      const existing = jobs.get(event.job.id) ?? {
        id: event.job.id,
        name: event.job.jobName,
        address: "address" in event.job ? (event.job.address as string | null) : null,
        events: [] as typeof ops.todayEvents,
      };
      existing.events.push(event);
      jobs.set(event.job.id, existing);
    }

    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Call back</h2>
            <Link href="/leads" className="text-xs font-semibold text-teal-700">
              All leads →
            </Link>
          </div>
          {callbacks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nobody waiting. Nice.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {callbacks.map((lead) => {
                const links = leadContactLinks(lead);
                const waiting = leadWaitAlert(lead.createdAt);
                return (
                  <li key={lead.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {lead.contactName}
                      {waiting ? (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 align-middle text-[10px] font-semibold text-red-700">
                          {waiting}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {lead.serviceType || "Service TBD"} · came in {format(lead.createdAt, "EEE h:mm a")}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {links.call ? (
                        <a href={links.call} className="rounded-xl bg-teal-600 py-2.5 text-center text-sm font-semibold text-white">
                          Call
                        </a>
                      ) : null}
                      {links.text ? (
                        <a href={links.text} className="rounded-xl border border-teal-600 py-2.5 text-center text-sm font-semibold text-teal-700">
                          Text
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Today&apos;s jobs</h2>
          {jobs.size === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing scheduled today. Add visits from a job&apos;s page.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...jobs.values()].map((job) => {
                const photos = photosToday.get(job.id) ?? 0;
                return (
                  <li key={job.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-900">{job.name}</p>
                    {job.address ? <p className="text-xs text-slate-500">{job.address}</p> : null}
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {job.events.map((event) => (
                        <li key={event.id}>
                          <span className="font-medium">
                            {format(event.startAt, "h:mm a")}–{format(event.endAt, "h:mm a")}
                          </span>
                          {event.notes ? <span className="text-slate-500"> · {event.notes}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {photos === 0 && !isDemoMode() ? (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                        No photos yet today. Snap a few before you leave.
                      </p>
                    ) : null}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Link href={`/jobs/${job.id}`} className="rounded-xl border border-slate-300 py-2 text-center text-xs font-semibold text-slate-700">
                        Open job
                      </Link>
                      <Link href={`/jobs/${job.id}/photos`} className="rounded-xl border border-slate-300 py-2 text-center text-xs font-semibold text-slate-700">
                        Photos
                      </Link>
                      {job.address ? (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                          className="rounded-xl border border-slate-300 py-2 text-center text-xs font-semibold text-slate-700"
                        >
                          Directions
                        </a>
                      ) : (
                        <span />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {ops.missingReceipts > 0 || ops.overdueTasksCount > 0 ? (
          <section className="grid grid-cols-2 gap-2">
            {ops.missingReceipts > 0 ? (
              <Link href="/capture" className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs text-sky-700">Expenses missing a receipt</p>
                <p className="mt-1 text-xl font-semibold text-sky-800">{ops.missingReceipts}</p>
              </Link>
            ) : null}
            {ops.overdueTasksCount > 0 ? (
              <Link href="/jobs#overdue-tasks" className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-700">Overdue to-dos</p>
                <p className="mt-1 text-xl font-semibold text-amber-800">{ops.overdueTasksCount}</p>
              </Link>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  } finally {
    perf.flush({ orgId, role });
  }
}
