import { Suspense } from "react";
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
import { AttendanceScheduleBoard } from "@/components/attendance-schedule-board";
import { ConfirmDeactivateForm } from "@/components/confirm-deactivate-form";
import { RoutePanelSkeleton } from "@/components/route-panel-skeleton";
import { TeamTabs } from "@/components/team-tabs";
import { requireAuth } from "@/lib/auth";
import { getOrgUsers } from "@/lib/data";
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
import { createRoutePerf } from "@/lib/route-perf";
import { getWorkedHours } from "@/lib/time-entry";
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

export default function AttendancePage(props: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <Suspense fallback={<RoutePanelSkeleton cards={4} sections={5} />}>
      <AttendancePageContent {...props} />
    </Suspense>
  );
}

async function AttendancePageContent({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const perf = createRoutePerf("/attendance");
  let orgId = "";
  let role = "";
  try {
    const params = await perf.time("search_params", () => searchParams);
    const editingWorkerId = params.edit ?? null;

    const auth = await perf.time("auth", () => requireAuth());
    orgId = auth.orgId;
    role = auth.role;

    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = addMinutes(dayStart, 24 * 60 - 1);
    const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const thisWeekEnd = endOfWeek(thisWeekStart, { weekStartsOn: 1 });
    const nextWeekStart = addDays(thisWeekStart, 7);
    const nextWeekEnd = endOfWeek(nextWeekStart, { weekStartsOn: 1 });
    const scheduleRangeStart = thisWeekStart;
    const scheduleRangeEnd = nextWeekEnd;
    const defaultDayIndex = (() => {
      const day = now.getDay();
      return day === 0 ? 6 : day - 1;
    })();
    const ongoingStatuses: JobStatus[] = [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.ON_HOLD];

    type BootstrapTuple = [
      { defaultClockInTime: string; clockGraceMinutes: number; workerCanEditOwnTimeSameDay: boolean; gpsTimeTrackingEnabled: boolean },
      Awaited<ReturnType<typeof getOrgUsers>>,
      Array<{ id: string; jobName: string }>,
      Array<{ id: string; workerId: string; jobId: string; start: Date; end: Date | null; job: { id: string; jobName: string } }>,
      Array<{ userId: string; job: { id: string; jobName: string; scheduleEvents: Array<{ id: string; startAt: Date; endAt: Date; createdAt?: Date }> } }>,
      Array<{ id: string; jobName: string; address: string; assignments: Array<{ userId: string }>; scheduleEvents: Array<{ id: string; startAt: Date; endAt: Date }> }>,
    ];

    let bootstrap: BootstrapTuple;
    if (isDemoMode()) {
      bootstrap = (await perf.time("bootstrap_demo", () =>
        Promise.all([
          Promise.resolve({
            defaultClockInTime: "07:00",
            clockGraceMinutes: 10,
            workerCanEditOwnTimeSameDay: false,
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
            [...demoJobAssignments, ...listDemoRuntimeAssignments()].map((assignment) => {
              const allEvents = [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()].filter(
                (event) => event.jobId === assignment.jobId,
              );
              const rangeEvents = allEvents.filter(
                (e) => new Date(e.startAt) >= scheduleRangeStart && new Date(e.startAt) <= scheduleRangeEnd,
              );
              return {
                ...assignment,
                job: {
                  ...(demoJobs.find((job) => job.id === assignment.jobId) ?? demoJobs[0]),
                  scheduleEvents: rangeEvents,
                },
              };
            }),
          ),
          Promise.resolve(
            demoJobs
              .map((job) => {
                const allAssignments = [...demoJobAssignments, ...listDemoRuntimeAssignments()].filter(
                  (a) => a.jobId === job.id,
                );
                const allEvents = [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()].filter(
                  (e) => e.jobId === job.id,
                );
                const rangeEvents = allEvents.filter(
                  (e) => new Date(e.startAt) >= scheduleRangeStart && new Date(e.startAt) <= scheduleRangeEnd,
                );
                if (rangeEvents.length === 0) return null;
                return {
                  ...job,
                  assignments: allAssignments,
                  scheduleEvents: rangeEvents,
                };
              })
              .filter((job) => job !== null),
          ),
        ]),
      )) as unknown as BootstrapTuple;
    } else {
      bootstrap = (await perf.time("bootstrap_live", () =>
        Promise.all([
          prisma.organizationSetting
            .findUnique({ where: { orgId: auth.orgId } })
            .then((value) =>
              value ?? {
                defaultClockInTime: "07:00",
                clockGraceMinutes: 10,
                workerCanEditOwnTimeSameDay: false,
                gpsTimeTrackingEnabled: false,
              },
            ),
          getOrgUsers(auth.orgId),
          prisma.job.findMany({
            where: { orgId: auth.orgId },
            select: { id: true, jobName: true },
            orderBy: { updatedAt: "desc" },
            take: 150,
          }),
          prisma.timeEntry.findMany({
            where: { job: { orgId: auth.orgId }, start: { gte: dayStart, lte: dayEnd } },
            select: {
              id: true,
              workerId: true,
              jobId: true,
              start: true,
              end: true,
              breakMinutes: true,
              job: { select: { id: true, jobName: true } },
            },
            orderBy: { start: "asc" },
          }),
          prisma.jobAssignment.findMany({
            where: { orgId: auth.orgId },
            include: {
              job: {
                select: {
                  id: true,
                  jobName: true,
                  scheduleEvents: {
                    where: { startAt: { gte: scheduleRangeStart, lte: scheduleRangeEnd } },
                    orderBy: { startAt: "asc" },
                    select: { id: true, startAt: true, endAt: true, createdAt: true },
                  },
                },
              },
            },
          }),
          prisma.job.findMany({
            where: {
              orgId: auth.orgId,
              status: { in: ongoingStatuses },
              scheduleEvents: { some: { startAt: { gte: scheduleRangeStart, lte: scheduleRangeEnd } } },
            },
            select: {
              id: true,
              jobName: true,
              address: true,
              assignments: { select: { userId: true } },
              scheduleEvents: {
                where: { startAt: { gte: scheduleRangeStart, lte: scheduleRangeEnd } },
                orderBy: { startAt: "asc" },
                select: { id: true, startAt: true, endAt: true },
              },
            },
            orderBy: { updatedAt: "desc" },
          }),
        ]),
      )) as unknown as BootstrapTuple;
    }

    const [settings, allUsers, jobs, todaysEntries, assignmentRowsWithWeek, ongoingJobsRaw] = bootstrap;

    const users = allUsers.filter((u) => u.isActive);
    const ongoingJobs = ongoingJobsRaw;

    const assignmentRows = assignmentRowsWithWeek;
    const clock = parseClockTime(settings?.defaultClockInTime);
    const graceMinutes = settings?.clockGraceMinutes ?? 10;
    const missedAt = addMinutes(
      setSeconds(setMinutes(setHours(dayStart, clock.hour), clock.minute), 0),
      graceMinutes,
    );

    const blocksByWorkerDay = new Map<
      string,
      Array<{ eventId: string; jobId: string; jobName: string; startAt: Date; endAt: Date }>
    >();
    for (const assignment of assignmentRows) {
      for (const event of assignment.job.scheduleEvents ?? []) {
        const startAt = new Date(event.startAt);
        const endAt = new Date(event.endAt);
        const dayKey = format(startAt, "yyyy-MM-dd");
        const key = `${assignment.userId}:${dayKey}`;
        const existing = blocksByWorkerDay.get(key) ?? [];
        existing.push({
          eventId: event.id,
          jobId: assignment.job.id,
          jobName: assignment.job.jobName,
          startAt,
          endAt,
        });
        blocksByWorkerDay.set(key, existing);
      }
    }
    for (const [key, blocks] of blocksByWorkerDay.entries()) {
      const byWindow = new Map<string, (typeof blocks)[number]>();
      for (const block of blocks) {
        byWindow.set(`${block.startAt.getTime()}-${block.endAt.getTime()}`, block);
      }
      blocksByWorkerDay.set(
        key,
        [...byWindow.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
      );
    }

    function getBlocksForDay(userId: string, day: Date) {
      return blocksByWorkerDay.get(`${userId}:${format(day, "yyyy-MM-dd")}`) ?? [];
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

    const crewRows = rows.filter((r) => r.user.role === Role.WORKER);
    const ownerRows = rows.filter((r) => r.user.role === Role.OWNER || r.user.role === Role.ADMIN);

    const weeklyScheduledMinutesByUser = new Map<string, number>();
    const nextWeekScheduledMinutesByUser = new Map<string, number>();
    for (const assignment of assignmentRows) {
      const events = assignment.job.scheduleEvents ?? [];
      for (const event of events) {
        const start = new Date(event.startAt);
        const end = new Date(event.endAt);
        const minutes = (end.getTime() - start.getTime()) / 60000;
        if (start >= thisWeekStart && start <= thisWeekEnd) {
          const prev = weeklyScheduledMinutesByUser.get(assignment.userId) ?? 0;
          weeklyScheduledMinutesByUser.set(assignment.userId, prev + Math.max(0, minutes));
        }
        if (start >= nextWeekStart && start <= nextWeekEnd) {
          const prev = nextWeekScheduledMinutesByUser.get(assignment.userId) ?? 0;
          nextWeekScheduledMinutesByUser.set(assignment.userId, prev + Math.max(0, minutes));
        }
      }
    }

    const scheduleBoardDays = Array.from({ length: 14 }, (_, index) => addDays(thisWeekStart, index));
    const scheduleBoardRows = crewRows.map((row) => ({
      userId: row.user.id,
      fullName: row.user.fullName,
      weeklyHoursThisWeek: (weeklyScheduledMinutesByUser.get(row.user.id) ?? 0) / 60,
      weeklyHoursNextWeek: (nextWeekScheduledMinutesByUser.get(row.user.id) ?? 0) / 60,
      dayBlocks: scheduleBoardDays.map((day) =>
        getBlocksForDay(row.user.id, day).map((block) => ({
          eventId: block.eventId,
          jobId: block.jobId,
          jobName: block.jobName,
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
        })),
      ),
    }));

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
          <AttendanceScheduleBoard
            rows={scheduleBoardRows}
            thisWeekStartIso={thisWeekStart.toISOString()}
            thisWeekEndIso={thisWeekEnd.toISOString()}
            nextWeekStartIso={nextWeekStart.toISOString()}
            nextWeekEndIso={nextWeekEnd.toISOString()}
            defaultDayIndex={defaultDayIndex}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Quick Clock-In by Job</h3>
          <p className="mt-1 text-xs text-slate-500">
            Start timers for an entire crew at once. Manage crew assignments from each job&apos;s Schedule tab.
          </p>
          <div className="mt-3 space-y-2">
            {ongoingJobs.map((job) => {
              const crewNames = job.assignments
                ?.map((a) => users.find((u) => u.id === a.userId)?.fullName)
                .filter(Boolean) ?? [];
              return (
                <article key={job.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{job.jobName}</p>
                    <p className="text-[11px] text-slate-500">{crewNames.length > 0 ? crewNames.join(", ") : "No crew assigned"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 ml-2">
                    <Link href={`/jobs/${job.id}`} className="text-[11px] text-slate-500 hover:text-slate-900">Schedule</Link>
                    {job.assignments && job.assignments.length > 0 ? (
                      <form action={ownerClockInCrewForJobAction} className="inline">
                        <input type="hidden" name="jobId" value={job.id} />
                        <button type="submit" className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">
                          Clock in crew
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {ongoingJobs.length === 0 ? <p className="text-sm text-slate-500">No jobs with upcoming visits this week.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Today Roster</h3>
            <p className="text-xs text-slate-500">
              {crewRows.length} crew | {crewRows.filter((r) => r.status === "on_time").length} on time, {crewRows.filter((r) => r.status === "late").length} late, {crewRows.filter((r) => r.status === "missing").length} missing
            </p>
          </div>
          {jobs.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">No jobs yet — create one first to clock employees in.</p>
          ) : null}
          {crewRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No crew members added yet. Add workers below.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {crewRows.map((row) => (
                <article key={row.user.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{row.user.fullName}</p>
                      {row.todaysBlocks.length > 0 ? (
                        <p className="mt-0.5 text-[11px] text-teal-700 truncate">
                          {row.todaysBlocks.map((b) => `${b.jobName} ${format(b.startAt, "h:mm a")}–${format(b.endAt, "h:mm a")}`).join(" · ")}
                        </p>
                      ) : row.todaysAssignedJobs.length > 0 && row.entries.length === 0 ? (
                        <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                          Assigned: {row.todaysAssignedJobs.map((j) => j.jobName).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${row.status === "missing" ? "bg-rose-100 text-rose-700" : row.status === "late" ? "bg-amber-100 text-amber-700" : row.status === "pending" ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>
                      {row.status === "on_time" ? "on time" : row.status}
                    </span>
                  </div>

                  {row.entries.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {row.entries.map((entry) => {
                        const end = entry.end;
                        const hours = getWorkedHours(entry);
                        const hoursStr = end ? ` · ${hours.toFixed(1)}h` : "";
                        return (
                          <li key={entry.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                            <span className="font-medium text-slate-800">{entry.job.jobName}</span>
                            <span className="text-slate-500">
                              {format(entry.start, "h:mm a")}{" → "}{end ? format(end, "h:mm a") : "running"}{hoursStr}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {row.running ? (
                    <form action={ownerClockOutEmployeeAction} className="mt-2">
                      <input type="hidden" name="workerId" value={row.user.id} />
                      <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Clock Out</button>
                    </form>
                  ) : (
                    <form action={ownerClockInEmployeeAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="workerId" value={row.user.id} />
                      <select
                        name="jobId"
                        required
                        defaultValue={row.defaultJobId}
                        disabled={row.clockInOptions.length === 0}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      >
                        <option value="">Select job</option>
                        {row.clockInOptions.map((job) => (
                          <option key={job.id} value={job.id}>{job.jobName}</option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={jobs.length === 0 || row.clockInOptions.length === 0}
                        className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                      >
                        Clock In
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}


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
          <h3 className="text-sm font-semibold text-slate-900">Manage Team</h3>
          <p className="mt-1 text-xs text-slate-500">Edit details or deactivate members.</p>
          <div className="mt-3 space-y-2 text-sm">
            {allUsers.filter((w) => w.isActive).map((worker) => {
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-900">{worker.fullName || "-"}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{roleLabel(worker.role)}</span>
                      <span className="flex items-center gap-2 ml-auto">
                        <Link href={`/attendance?edit=${encodeURIComponent(worker.id)}`} className="text-xs text-teal-600 underline">Edit</Link>
                        <ConfirmDeactivateForm
                          workerId={worker.id}
                          isActive={worker.isActive}
                          action={setWorkerActiveAction}
                          confirmMessage={`Deactivate ${worker.fullName || "this worker"}?`}
                          label="Deactivate"
                          className="inline-block"
                        />
                      </span>
                    </div>
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
  } finally {
    perf.flush({ orgId, role });
  }
}
