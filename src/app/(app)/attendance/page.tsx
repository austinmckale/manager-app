import { addMinutes, setHours, setMinutes, setSeconds, startOfDay } from "date-fns";
import {
  ownerClockInEmployeeAction,
  ownerClockOutEmployeeAction,
  sendClockRemindersAction,
  updateOrgSettingsAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
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
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function parseClockTime(value?: string | null) {
  const fallback = { hour: 7, minute: 0 };
  if (!value) return fallback;
  const [h, m] = value.split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallback;
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
}

export default async function AttendancePage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">Attendance is owner/admin only.</section>;
  }

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addMinutes(dayStart, 24 * 60 - 1);

  const [settings, users, jobs, todaysEntries, assignmentRows] = isDemoMode()
    ? [
        {
          defaultClockInTime: "07:00",
          clockGraceMinutes: 10,
          workerCanEditOwnTimeSameDay: true,
          gpsTimeTrackingEnabled: false,
        },
        demoUsers,
        demoJobs,
        listDemoRuntimeTimeEntries()
          .filter((entry) => entry.start >= dayStart)
          .map((entry) => ({
            ...entry,
            job: demoJobs.find((job) => job.id === entry.jobId) ?? demoJobs[0],
            worker: demoUsers.find((user) => user.id === entry.workerId) ?? demoUsers[0],
          })),
        [
          ...demoJobAssignments,
          ...listDemoRuntimeAssignments(),
        ].map((assignment) => ({
          ...assignment,
          job: {
            ...(demoJobs.find((job) => job.id === assignment.jobId) ?? demoJobs[0]),
            scheduleEvents: [...demoScheduleEvents, ...listDemoRuntimeScheduleEvents()].filter(
              (event) => event.jobId === assignment.jobId,
            ),
          },
        })),
      ]
    : await Promise.all([
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        prisma.userProfile.findMany({ where: { orgId: auth.orgId, isActive: true }, orderBy: { fullName: "asc" } }),
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
                  where: { startAt: { gte: dayStart, lte: dayEnd } },
                  orderBy: { startAt: "asc" },
                },
              },
            },
          },
        }),
      ]);

  const clock = parseClockTime(settings?.defaultClockInTime);
  const scheduledAt = setSeconds(setMinutes(setHours(dayStart, clock.hour), clock.minute), 0);
  const graceMinutes = settings?.clockGraceMinutes ?? 10;
  const missedAt = addMinutes(scheduledAt, graceMinutes);
  const escalateAt = addMinutes(scheduledAt, 30);

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
    const clockInOptions = todaysAssignedJobs.length > 0 ? todaysAssignedJobs : uniqueAssignedJobs.length > 0 ? uniqueAssignedJobs : jobs;
    const defaultJobId = clockInOptions[0]?.id ?? "";

    let status = "on_time";
    if (!first && now > missedAt) status = "missing";
    else if (first && first.start > missedAt) status = "late";
    else if (!first) status = "pending";

    return { user, first, running, status, clockInOptions, defaultJobId, todaysAssignedJobs };
  });

  const reminderCandidates = rows.filter((row) => !row.first).map((row) => row.user);
  const reminderType = now > escalateAt ? "escalation" : now > missedAt ? "missed_clock_in" : "pre_shift";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Owner Attendance Console</h2>
        <p className="mt-1 text-sm text-teal-800">Clock employees in/out per job, track late/missing punches, and run reminders.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Clock Rules</h3>
        <form action={updateOrgSettingsAction} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input type="time" name="defaultClockInTime" defaultValue={settings?.defaultClockInTime ?? "07:00"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input type="number" min={0} name="clockGraceMinutes" defaultValue={settings?.clockGraceMinutes ?? 10} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Grace minutes" />
          <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Save</button>
          <label className="flex items-center gap-2 text-xs sm:col-span-3">
            <input type="checkbox" name="workerCanEditOwnTimeSameDay" defaultChecked={settings?.workerCanEditOwnTimeSameDay ?? true} />
            Worker same-day edits
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-3">
            <input type="checkbox" name="gpsTimeTrackingEnabled" defaultChecked={settings?.gpsTimeTrackingEnabled ?? false} />
            GPS capture (optional)
          </label>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Reminder Queue</h3>
        <p className="mt-1 text-xs text-slate-500">Scheduled {scheduledAt.toLocaleTimeString()} • Grace {graceMinutes}m</p>
        <div className="mt-3 space-y-2 text-sm">
          {reminderCandidates.map((user) => (
            <article key={user.id} className="rounded-xl border border-amber-200 bg-amber-50 p-2">
              <p className="font-medium text-amber-900">{user.fullName}</p>
              <p className="text-xs text-amber-700">Missing clock-in</p>
            </article>
          ))}
          {reminderCandidates.length === 0 ? <p className="text-sm text-slate-500">No reminder candidates right now.</p> : null}
        </div>
        <form action={sendClockRemindersAction} className="mt-3">
          <input type="hidden" name="count" value={reminderCandidates.length} />
          <input type="hidden" name="reminderType" value={reminderType} />
          <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm" type="submit" disabled={reminderCandidates.length === 0}>
            Log Reminder Batch ({reminderCandidates.length})
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Today Roster</h3>
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

              <p className="mt-1 text-xs text-slate-500">
                {row.first ? `First clock-in: ${row.first.start.toLocaleTimeString()}` : "No clock-in yet"}
                {row.running ? ` • Running on ${row.running.job.jobName}` : ""}
              </p>
              {row.todaysAssignedJobs.length > 0 ? (
                <p className="mt-1 text-xs text-teal-700">
                  Assigned today: {row.todaysAssignedJobs.map((job) => job.jobName).join(", ")}
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
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Select job</option>
                    {row.clockInOptions.map((job) => (
                      <option key={job.id} value={job.id}>{job.jobName}</option>
                    ))}
                  </select>
                  <button type="submit" disabled={jobs.length === 0} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                    Clock In
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}


