import { addDays, addMinutes, endOfWeek, format, setHours, setMinutes, setSeconds, startOfDay, startOfWeek } from "date-fns";
import { JobStatus, Role } from "@prisma/client";
import Link from "next/link";
import {
  createWorkerAction,
  ownerClockInEmployeeAction,
  ownerClockOutEmployeeAction,
  ownerClockInCrewForJobAction,
  saveJobAssignmentsAction,
  setWorkerActiveAction,
  updateWorkerAction,
} from "@/app/(app)/actions";
import { ConfirmDeactivateForm } from "@/components/confirm-deactivate-form";
import { TeamTabs } from "@/components/team-tabs";
import { requireAuth } from "@/lib/auth";
import { getJobs, getOrgUsers } from "@/lib/data";
import {
  demoJobAssignments,
  demoJobs,
  demoScheduleEvents,
  demoUsers,
  isDemoMode,
  listDemoRuntimeAssignments,
  listDemoRuntimeScheduleEvents,
  listDemoRuntimeTimeEntries,
} from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

function parseClockTime(value?: string | null) {
  const fallback = { hour: 7, minute: 0 };
  if (!value) return fallback;
  const [h, m] = value.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallback;
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
}

function roleLabel(role: string) {
  const map: Record<string, string> = { WORKER: "Worker", ADMIN: "Admin", OWNER: "Owner" };
  return map[role] ?? role;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const params = await searchParams;
  const editingWorkerId = params.edit ?? null;

  const auth = await requireAuth();

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addMinutes(dayStart, 24 * 60 - 1);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const ongoingStatuses: JobStatus[] = [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.ON_HOLD];

  const [settings, allUsers, jobs, todaysEntries, assignmentRowsWithWeek, allJobsWithAssignments, ongoingJobsRaw] =
    isDemoMode()
      ? await Promise.all([
          Promise.resolve({
            defaultClockInTime: "07:00",
            clockGraceMinutes: 10,
            workerCanEditOwnTimeSameDay: true,
            gpsTimeTrackingEnabled: false,
          }),
          Promise.resolve(demoUsers),
          Promise.resolve(demoJobs),
          Promise.resolve(
            listDemoRuntimeTimeEntries()
              .filter((entry) => entry.start >= dayStart)
              .map((entry) => ({
                ...entry,
                job: demoJobs.find((job) => job.id === entry.jobId) ?? demoJobs[0],
                worker: demoUsers.find((user) => user.id === entry.workerId) ?? demoUsers[0],
              })),
          ),
          Promise.resolve(
            [
              ...demoJobAssignments,
              ...listDemoRuntimeAssignments(),
            ].map((assignment) => {
              const allEvents = [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()].filter(
                (event) => event.jobId === assignment.jobId,
              );
              const weekEvents = allEvents.filter(
                (e) => new Date(e.startAt) >= weekStart && new Date(e.startAt) <= weekEnd,
              );
              return {
                ...assignment,
                job: {
                  ...(demoJobs.find((job) => job.id === assignment.jobId) ?? demoJobs[0]),
                  scheduleEvents: weekEvents.length > 0 ? weekEvents : allEvents,
                },
              };
            }),
          ),
          getJobs({ orgId: auth.orgId, role: auth.role, userId: auth.userId, view: "all" }),
          Promise.resolve(
            demoJobs
              .map((job) => {
                const allAssignments = [...demoJobAssignments, ...listDemoRuntimeAssignments()].filter(
                  (a) => a.jobId === job.id,
                );
                const allEvents = [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()].filter(
                  (e) => e.jobId === job.id,
                );
                const weekEvents = allEvents.filter(
                  (e) => new Date(e.startAt) >= weekStart && new Date(e.startAt) <= weekEnd,
                );
                const hasWeekEvents = weekEvents.length > 0;
                if (!hasWeekEvents) return null;
                return {
                  ...job,
                  assignments: allAssignments,
                  scheduleEvents: weekEvents,
                };
              })
              .filter((job) => job !== null),
          ),
        ])
      : await Promise.all([
          prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
          getOrgUsers(auth.orgId),
          prisma.job.findMany({
            where: { orgId: auth.orgId },
            orderBy: { updatedAt: "desc" },
            take: 150,
          }),
          prisma.timeEntry.findMany({
            where: { job: { orgId: auth.orgId }, start: { gte: dayStart } },
            include: { job: true, worker: true },
            orderBy: { start: "asc" },
          }),
          prisma.jobAssignment.findMany({
            where: { orgId: auth.orgId },
            include: {
              job: {
                include: {
                  scheduleEvents: {
                    where: { startAt: { gte: weekStart, lte: weekEnd } },
                    orderBy: { startAt: "asc" },
                  },
                },
              },
            },
          }),
          getJobs({ orgId: auth.orgId, role: auth.role, userId: auth.userId, view: "all" }),
          prisma.job.findMany({
            where: {
              orgId: auth.orgId,
              scheduleEvents: { some: { startAt: { gte: weekStart, lte: weekEnd } } },
            },
            include: {
              assignments: true,
              scheduleEvents: {
                where: { startAt: { gte: weekStart, lte: weekEnd } },
                orderBy: { startAt: "asc" },
              },
            },
            orderBy: { updatedAt: "desc" },
          }),
        ]);

  const users = allUsers.filter((u) => u.isActive);
  const ongoingJobs = ongoingJobsRaw;

  const assignmentRows = assignmentRowsWithWeek;
  const clock = parseClockTime(settings?.defaultClockInTime);
  const graceMinutes = settings?.clockGraceMinutes ?? 10;
  const missedAt = addMinutes(
    setSeconds(setMinutes(setHours(dayStart, clock.hour), clock.minute), 0),
    graceMinutes,
  );

  function getBlocksForDay(userId: string, day: Date) {
    const dayStartD = startOfDay(day);
    const dayEndD = addMinutes(dayStartD, 24 * 60 - 1);
    const raw = assignmentRows
      .filter((a) => a.userId === userId)
      .flatMap((a) =>
        (a.job.scheduleEvents ?? [])
          .filter((e) => {
            const start = new Date(e.startAt);
            return start >= dayStartD && start <= dayEndD;
          })
          .map((e) => ({
            eventId: e.id,
            jobId: a.job.id,
            jobName: a.job.jobName,
            startAt: new Date(e.startAt),
            endAt: new Date(e.endAt),
            createdAt: "createdAt" in e && e.createdAt ? new Date((e as any).createdAt) : new Date(0),
          })),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Deduplicate blocks that have the same time window (start/end) for this
    // worker/day. If multiple jobs share that exact window, keep the one that
    // was created last.
    const byWindow = new Map<string, (typeof raw)[number]>();
    for (const block of raw) {
      const key = `${block.startAt.getTime()}-${block.endAt.getTime()}`;
      byWindow.set(key, block);
    }

    return [...byWindow.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }

  const rows = users.map((user) => {
    const entries = todaysEntries.filter((entry) => entry.workerId === user.id);
    const first = entries[0];
    const running = entries.find((entry) => !entry.end);
    const assignedJobs = assignmentRows
      .filter((assignment) => assignment.userId === user.id)
      .map((assignment) => assignment.job);
    const uniqueAssignedJobs = assignedJobs.filter(
      (job, index, all) => all.findIndex((item) => item.id === job.id) === index,
    );
    const todaysAssignedJobs = uniqueAssignedJobs.filter((job) =>
      job.scheduleEvents.some((event) => event.startAt >= dayStart && event.startAt <= dayEnd),
    );
    const todaysBlocks = todaysAssignedJobs
      .flatMap((job) =>
        job.scheduleEvents
          .filter((event) => event.startAt >= dayStart && event.startAt <= dayEnd)
          .map((event) => ({
            id: event.id,
            jobName: job.jobName,
            startAt: event.startAt,
            endAt: event.endAt,
          })),
      )
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const clockInOptions = todaysAssignedJobs.length > 0 ? todaysAssignedJobs : uniqueAssignedJobs.length > 0 ? uniqueAssignedJobs : jobs;
    const defaultJobId = clockInOptions[0]?.id ?? "";

    let status = "on_time";
    if (!first && now > missedAt) status = "missing";
    else if (first && first.start > missedAt) status = "late";
    else if (!first) status = "pending";

    const scheduleBlocksDeduped = todaysBlocks.reduce<
      { id: string; jobName: string; startAt: Date; endAt: Date; count: number }[]
    >((acc, block) => {
      const key = `${block.jobName}-${block.startAt.getTime()}-${block.endAt.getTime()}`;
      const existing = acc.find(
        (b) => b.jobName === block.jobName && b.startAt.getTime() === block.startAt.getTime() && b.endAt.getTime() === block.endAt.getTime(),
      );
      if (existing) {
        existing.count += 1;
        return acc;
      }
      acc.push({ ...block, count: 1 });
      return acc;
    }, []);

    return { user, first, running, status, clockInOptions, defaultJobId, todaysAssignedJobs, todaysBlocks: scheduleBlocksDeduped, entries };
  });

  const weeklyScheduledMinutesByUser = new Map<string, number>();
  for (const assignment of assignmentRows) {
    const events = assignment.job.scheduleEvents ?? [];
    for (const event of events) {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      const minutes = (end.getTime() - start.getTime()) / 60000;
      const prev = weeklyScheduledMinutesByUser.get(assignment.userId) ?? 0;
      weeklyScheduledMinutesByUser.set(assignment.userId, prev + Math.max(0, minutes));
    }
  }

  return (
    <div className="space-y-4">
      <TeamTabs active="attendance" />

      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Attendance Dashboard</h2>
        <p className="mt-1 text-sm text-teal-800">
          See each employee&apos;s week, then clock everyone in/out in Today Roster. Add and manage workers at the bottom.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">This week’s schedule (by employee)</h3>
        <p className="mt-1 text-xs text-slate-500">
          {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}. Each row is an employee; cells show the jobs they are
          scheduled on.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          To change the plan, click a block to edit its visit on the job page. Day-of, use Today or the Payroll tab to clock people
          in and adjust actual hours.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="bg-slate-50 px-2 py-2 text-left font-medium text-slate-700">Employee</th>
                {weekDays.map((day) => (
                  <th key={day.toISOString()} className="bg-slate-50 px-2 py-2 text-center font-medium text-slate-700">
                    {format(day, "EEE")} {format(day, "d")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const minutes = weeklyScheduledMinutesByUser.get(row.user.id) ?? 0;
                const hours = minutes / 60;
                return (
                  <tr key={row.user.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 font-medium text-slate-900">
                      <div className="flex flex-col">
                        <Link
                          href={`/time?workerId=${row.user.id}`}
                          className="max-w-[180px] truncate text-slate-900 hover:underline"
                        >
                          {row.user.fullName}
                        </Link>
                        {hours > 0 ? (
                          <span className="text-[11px] text-slate-500">Scheduled: {hours.toFixed(1)}h</span>
                        ) : null}
                      </div>
                    </td>
                    {weekDays.map((day) => {
                      const blocks = getBlocksForDay(row.user.id, day);
                      const isToday = format(day, "yyyy-MM-dd") === format(now, "yyyy-MM-dd");
                      return (
                        <td
                          key={day.toISOString()}
                          className={`px-2 py-1.5 align-top ${isToday ? "bg-amber-50/50" : ""}`}
                        >
                          {blocks.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {blocks.map((b, i) => (
                                <li key={b.eventId ?? i} className="text-xs text-slate-700">
                                  {b.jobId && b.eventId ? (
                                    <Link
                                      href={`/jobs/${b.jobId}?edit=${b.eventId}#schedule`}
                                      className="inline-flex flex-wrap items-baseline gap-0.5 rounded px-0.5 -mx-0.5 hover:bg-slate-100 hover:text-slate-900"
                                    >
                                      <span className="font-medium text-slate-800">{b.jobName}</span>
                                      <span className="text-slate-500">
                                        {" "}
                                        {format(b.startAt, "h:mm a")}–{format(b.endAt, "h:mm a")}
                                      </span>
                                    </Link>
                                  ) : (
                                    <>
                                      <span className="font-medium text-slate-800">{b.jobName}</span>
                                      <span className="text-slate-500">
                                        {" "}
                                        {format(b.startAt, "h:mm a")}–{format(b.endAt, "h:mm a")}
                                      </span>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Assign crew to ongoing jobs</h3>
        <p className="mt-1 text-xs text-slate-500">
          Quick way to attach workers to jobs for the week. Only workers are listed; add workers below to assign more crew. Use
          "Clock in crew" to start timers on this job for everyone assigned.
        </p>
        <div className="mt-3 space-y-3">
          {ongoingJobs.map((job) => {
            const assigned = new Set(job.assignments?.map((a) => a.userId) ?? []);
            return (
              <article key={job.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{job.jobName}</p>
                    <p className="text-xs text-slate-500">{job.address}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Link href={`/jobs/${job.id}#schedule`} className="text-xs text-slate-600 underline hover:text-slate-900">
                      Edit schedule
                    </Link>
                    {job.assignments && job.assignments.length > 0 ? (
                      <form action={ownerClockInCrewForJobAction} className="inline">
                        <input type="hidden" name="jobId" value={job.id} />
                        <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-[11px]">
                          Clock in crew
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <form action={saveJobAssignmentsAction} className="mt-2">
                  <input type="hidden" name="jobId" value={job.id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {allUsers
                      .filter((u) => u.isActive && u.role === Role.WORKER)
                      .map((user) => (
                        <label key={user.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                          <input type="checkbox" name="workerIds" value={user.id} defaultChecked={assigned.has(user.id)} />
                          {user.fullName}
                        </label>
                      ))}
                  </div>
                  <button type="submit" className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-xs">
                    Save assignments
                  </button>
                </form>
              </article>
            );
          })}
          {ongoingJobs.length === 0 ? <p className="text-sm text-slate-500">No ongoing jobs. Create or open a job, then assign crew here or on the job page.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Today Roster</h3>
          <p className="text-xs text-slate-500">
            All employees ({rows.length}) · {rows.filter((r) => r.status === "on_time").length} on time, {rows.filter((r) => r.status === "late").length} late, {rows.filter((r) => r.status === "missing").length} missing
          </p>
        </div>
        {jobs.length === 0 ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No jobs available. Create a job first, then return here to clock employees in.
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <article key={row.user.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{row.user.fullName}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${row.status === "missing" ? "bg-rose-100 text-rose-700" : row.status === "late" ? "bg-amber-100 text-amber-700" : row.status === "pending" ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {row.status.replaceAll("_", " ")}
                </span>
              </div>
              {(() => {
                const minutes = weeklyScheduledMinutesByUser.get(row.user.id) ?? 0;
                if (minutes <= 0) return null;
                const hours = minutes / 60;
                return (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Scheduled this week: {hours.toFixed(1)}h
                  </p>
                );
              })()}

              {/* Time logged today — actual punch in/out */}
              <div className="mt-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Time logged today</p>
                {row.entries.length === 0 ? (
                  <p className="mt-0.5 text-xs text-slate-500">No time logged yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {row.entries.map((entry) => {
                      const end = entry.end;
                      const minutes = end
                        ? (end.getTime() - entry.start.getTime()) / 60000
                        : null;
                      const hoursStr = minutes !== null ? ` (${(minutes / 60).toFixed(1)}h)` : "";
                      return (
                        <li key={entry.id} className="flex items-center justify-between gap-2 rounded bg-slate-100 px-2 py-1 text-xs">
                          <span className="font-medium text-slate-800">{entry.job.jobName}</span>
                          <span className="text-slate-600">
                            {format(entry.start, "h:mm a")} → {end ? format(end, "h:mm a") : "… running"}
                            {hoursStr}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Scheduled today — planned blocks (for context) */}
              {row.todaysBlocks.length > 0 ? (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Scheduled today</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    {row.todaysBlocks.map((block) => (
                      <span key={block.id} className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-800">
                        {block.jobName}: {format(block.startAt, "h:mm a")}–{format(block.endAt, "h:mm a")}
                        {block.count > 1 ? ` (×${block.count})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {row.todaysAssignedJobs.length > 0 && row.entries.length === 0 ? (
                <p className="mt-1.5 text-xs text-teal-700">
                  Assigned: {row.todaysAssignedJobs.map((j) => j.jobName).join(", ")}
                </p>
              ) : null}

              {row.running ? (
                <form action={ownerClockOutEmployeeAction} className="mt-2">
                  <input type="hidden" name="workerId" value={row.user.id} />
                  <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Clock Out</button>
                </form>
              ) : (
                <form action={ownerClockInEmployeeAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input type="hidden" name="workerId" value={row.user.id} />
                  <select
                    name="jobId"
                    required
                    defaultValue={row.defaultJobId}
                    disabled={row.clockInOptions.length === 0}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Select job</option>
                    {row.clockInOptions.map((job) => (
                      <option key={job.id} value={job.id}>{job.jobName}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={jobs.length === 0 || row.clockInOptions.length === 0}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Clock In
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4" id="add-worker-form">
        <h3 className="text-sm font-semibold text-slate-900">Add worker</h3>
        <form action={createWorkerAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="fullName" required placeholder="Full name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="email" type="email" required placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select name="role" defaultValue="WORKER" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="WORKER">Worker</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input name="hourlyRateDefault" type="number" step="0.01" placeholder="Hourly rate" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">+ Add worker</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Active workers</h3>
        <p className="mt-1 text-xs text-slate-500">Edit to change details; confirm before deactivating.</p>
        <div className="mt-3 space-y-2 text-sm">
          {allUsers.map((worker) => {
            const isEditing = editingWorkerId === worker.id;
            return (
              <article key={worker.id} className="rounded-xl border border-slate-200 p-2">
                {isEditing ? (
                  <form action={updateWorkerAction} className="grid gap-2 sm:grid-cols-5">
                    <input type="hidden" name="workerId" value={worker.id} />
                    <input name="fullName" defaultValue={worker.fullName} className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-2" />
                    <input name="phone" defaultValue={worker.phone ?? ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                    <select name="role" defaultValue={worker.role} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                      <option value="WORKER">Worker</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                    </select>
                    <input name="hourlyRateDefault" type="number" step="0.01" defaultValue={toNumber(worker.hourlyRateDefault) || ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Save</button>
                      <Link href="/attendance" className="text-xs text-slate-500 underline">Cancel</Link>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-900">{worker.fullName || "—"}</span>
                      <span className="flex items-center gap-2">
                        <Link href={`/attendance?edit=${encodeURIComponent(worker.id)}`} className="text-xs text-teal-600 underline">Edit</Link>
                        <ConfirmDeactivateForm
                          workerId={worker.id}
                          isActive={worker.isActive}
                          action={setWorkerActiveAction}
                          confirmMessage={`${worker.isActive ? "Deactivate" : "Activate"} ${worker.fullName || "this worker"}?`}
                          label={worker.isActive ? "Deactivate" : "Activate"}
                          className="inline-block"
                        />
                      </span>
                    </div>
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs text-slate-500 underline">Phone, role, pay</summary>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-600">
                        <dt>Phone</dt>
                        <dd>{worker.phone || "—"}</dd>
                        <dt>Role</dt>
                        <dd>{roleLabel(worker.role)}</dd>
                        <dt>Rate</dt>
                        <dd>{worker.hourlyRateDefault != null ? `$${Number(worker.hourlyRateDefault).toFixed(2)}/hr` : "—"}</dd>
                      </dl>
                    </details>
                  </>
                )}
                {isEditing ? (
                  <ConfirmDeactivateForm
                    workerId={worker.id}
                    isActive={worker.isActive}
                    action={setWorkerActiveAction}
                    confirmMessage={`${worker.isActive ? "Deactivate" : "Activate"} ${worker.fullName || "this worker"}?`}
                    label={worker.isActive ? "Deactivate" : "Activate"}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
