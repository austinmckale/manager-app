import { addDays, endOfWeek, format, startOfDay, startOfWeek } from "date-fns";
import {
  deleteScheduleEventAction,
  quickScheduleCrewAction,
  updateJobCrewAction,
  updateScheduleEventAction,
} from "@/app/(app)/actions";
import { FileCapture } from "@/components/file-capture";
import { requireAuth } from "@/lib/auth";
import { getJobById, getOrgUsers } from "@/lib/data";
import { canManageOrg } from "@/lib/permissions";
import { getLaborCost, getWorkedHours } from "@/lib/time-entry";
import { currency, getStoragePublicUrl } from "@/lib/utils";

function toGoogleCalendarDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildGoogleCalendarUrl(params: { title: string; start: Date; end: Date; details?: string | null; location?: string | null }) {
  const start = toGoogleCalendarDate(params.start);
  const end = toGoogleCalendarDate(params.end);
  const title = encodeURIComponent(params.title);
  const details = encodeURIComponent(params.details ?? "");
  const location = encodeURIComponent(params.location ?? "");
  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{
    edit?: string;
    conflict?: string;
    conflictAction?: string;
    conflictJobId?: string;
    conflictJobName?: string;
    conflictStart?: string;
    conflictEnd?: string;
    slot?: string;
    notes?: string;
    startTime?: string;
    endTime?: string;
    customDate?: string;
    dates?: string | string[];
    workerIds?: string | string[];
    editStartAt?: string;
    editEndAt?: string;
    editNotes?: string;
  }>;
}) {
  const auth = await requireAuth();
  const { jobId } = await params;
  const query = await searchParams;
  const editEventId = query.edit ?? null;
  const toArray = (value?: string | string[]) => (value ? (Array.isArray(value) ? value : [value]) : []);
  const draftDates = toArray(query.dates);
  const draftWorkerIds = toArray(query.workerIds);
  const draftSlot = query.slot ?? "";
  const draftNotes = query.notes ?? "";
  const draftStartTime = query.startTime ?? "08:00";
  const draftEndTime = query.endTime ?? "17:00";
  const draftCustomDate = query.customDate ?? "";
  const conflictActive = query.conflict === "1";
  const conflictAction = query.conflictAction ?? "";
  const conflictStart = query.conflictStart ? new Date(query.conflictStart) : null;
  const conflictEnd = query.conflictEnd ? new Date(query.conflictEnd) : null;
  const draftDateSet = new Set(draftDates);
  const draftWorkerSet = new Set(draftWorkerIds);
  const canManageSchedule = canManageOrg(auth.role);

  const [job, users] = await Promise.all([
    getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId }),
    getOrgUsers(auth.orgId),
  ]);

  const assignedUserIds = new Set(job.assignments?.map((assignment) => assignment.userId) ?? []);
  const assignedCrew = users.filter((user) => assignedUserIds.has(user.id));
  const assignedCrewLabel = assignedCrew.length > 0 ? assignedCrew.map((user) => user.fullName).join(", ") : "No crew assigned";
  const editingEvent = editEventId ? job.scheduleEvents?.find((e) => e.id === editEventId) : null;
  const editStartValue =
    conflictAction === "edit" && query.editStartAt
      ? query.editStartAt
      : editingEvent
        ? format(new Date(editingEvent.startAt), "yyyy-MM-dd'T'HH:mm")
        : "";
  const editEndValue =
    conflictAction === "edit" && query.editEndAt
      ? query.editEndAt
      : editingEvent
        ? format(new Date(editingEvent.endAt), "yyyy-MM-dd'T'HH:mm")
        : "";
  const editNotesValue =
    conflictAction === "edit" && query.editNotes !== undefined ? query.editNotes : editingEvent?.notes ?? "";
  const quickDates = (() => {
    const out: Date[] = [];
    let d = startOfDay(new Date());
    while (out.length < 5) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) out.push(new Date(d));
      d = addDays(d, 1);
    }
    return out;
  })();
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const weeklyLaborByWorker = new Map<string, { workerName: string; hours: number; pay: number }>();

  for (const entry of job.timeEntries) {
    if (!entry.end) continue;
    if (entry.start < weekStart || entry.start > weekEnd) continue;
    const hours = getWorkedHours(entry);
    const pay = getLaborCost(entry);
    const row = weeklyLaborByWorker.get(entry.workerId) ?? {
      workerName: entry.worker.fullName,
      hours: 0,
      pay: 0,
    };
    row.hours += hours;
    row.pay += pay;
    weeklyLaborByWorker.set(entry.workerId, row);
  }
  const weeklyLaborRows = [...weeklyLaborByWorker.values()].sort((a, b) => b.pay - a.pay);
  const weeklyLaborTotals = weeklyLaborRows.reduce(
    (acc, row) => {
      acc.hours += row.hours;
      acc.pay += row.pay;
      return acc;
    },
    { hours: 0, pay: 0 },
  );
  const documentAssets = job.fileAssets.filter((asset) => asset.type === "DOCUMENT");

  return (
    <>
      <section id="schedule" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Schedule</h3>
        {canManageSchedule && conflictActive ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Schedule conflict</p>
            <p className="mt-1 text-amber-800">
              One of the crew is already scheduled on{" "}
              <span className="font-semibold">{query.conflictJobName ?? "another job"}</span>
              {conflictStart && conflictEnd
                ? ` between ${format(conflictStart, "MMM d h:mm a")} - ${format(conflictEnd, "h:mm a")}.`
                : "."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {conflictAction === "quick" ? (
                <button
                  form="quick-schedule-form"
                  name="overrideConflicts"
                  value="1"
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Schedule anyway
                </button>
              ) : null}
              {conflictAction === "edit" ? (
                <button
                  form="edit-schedule-form"
                  name="overrideConflicts"
                  value="1"
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Save anyway
                </button>
              ) : null}
              {query.conflictJobId ? (
                <a
                  href={`/jobs/${query.conflictJobId}`}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900"
                >
                  View conflicting job
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        {canManageSchedule ? (
          <form
            id="quick-schedule-form"
            action={quickScheduleCrewAction}
            className="mt-3 space-y-3 rounded-xl border border-slate-200 p-3"
          >
            <input type="hidden" name="jobId" value={job.id} />

            {/* ── Who ── */}
            <div>
              <p className="text-xs font-medium text-slate-700">Who&apos;s going?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {users.map((user) => {
                  const isAssigned = draftWorkerIds.length > 0 ? draftWorkerSet.has(user.id) : assignedUserIds.has(user.id);
                  return (
                    <label
                      key={user.id}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50 has-[:checked]:font-medium has-[:checked]:text-teal-800"
                    >
                      <input
                        type="checkbox"
                        name="workerIds"
                        value={user.id}
                        defaultChecked={isAssigned}
                        className="sr-only"
                      />
                      {user.fullName}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* ── When ── */}
            <div>
              <p className="text-xs font-medium text-slate-700">When?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {quickDates.map((dateValue, index) => {
                  const dateKey = format(dateValue, "yyyy-MM-dd");
                  const shouldCheck = draftDates.length > 0 ? draftDateSet.has(dateKey) : index === 0;
                  return (
                    <label
                      key={dateValue.toISOString()}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:font-medium has-[:checked]:text-white"
                    >
                      <input type="checkbox" name="dates" value={dateKey} defaultChecked={shouldCheck} className="sr-only" />
                      {format(dateValue, "EEE M/d")}
                    </label>
                  );
                })}
                <input
                  type="date"
                  name="customDate"
                  defaultValue={draftCustomDate}
                  className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500"
                  title="Pick a custom date"
                />
              </div>
            </div>

            {/* ── Time + Notes ── */}
            <div className="flex flex-wrap items-end gap-2">
              <select name="slot" defaultValue={draftSlot || "FULL"} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                <option value="FULL">Full day (8–5)</option>
                <option value="AM">Morning (8–12)</option>
                <option value="PM">Afternoon (1–5)</option>
                <option value="CUSTOM">Custom</option>
              </select>
              <input type="time" name="startTime" defaultValue={draftStartTime} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              <input type="time" name="endTime" defaultValue={draftEndTime} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              <input
                name="notes"
                placeholder="Notes (optional)"
                defaultValue={draftNotes}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>

            <button type="submit" className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">
              Schedule Visit
            </button>
          </form>
        ) : (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Schedule editing is limited to owners/admins. You can still view visits below.
          </p>
        )}

        <div className="mt-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled visits (plan)</p>
          <p className="mb-2 text-[11px] text-slate-500">
            Each date shows the planned time block and assigned crew.
          </p>
          {canManageSchedule && editingEvent ? (
            <form id="edit-schedule-form" action={updateScheduleEventAction} className="mb-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm">
              <input type="hidden" name="eventId" value={editingEvent.id} />
              <input type="hidden" name="jobId" value={job.id} />
              <p className="mb-1 font-medium text-slate-900">Edit scheduled visit</p>
              <p className="mb-2 text-xs text-slate-600">
                Change the start/end time or notes for this visit. This updates the plan (Team weekly grid and Today run sheet),
                but does not change any existing time entries or payroll.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-0.5 text-xs">
                  Start
                  <input
                    type="datetime-local"
                    name="startAt"
                    required
                    defaultValue={editStartValue}
                    className="rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  End
                  <input
                    type="datetime-local"
                    name="endAt"
                    required
                    defaultValue={editEndValue}
                    className="rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </label>
              </div>
              <input name="notes" placeholder="Notes (optional)" defaultValue={editNotesValue} className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <div className="mt-2 flex gap-2">
                <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">Save</button>
                <a href={`/jobs/${job.id}#schedule`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel</a>
              </div>
            </form>
          ) : null}
          {(job.scheduleEvents?.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-500">No schedule events yet.</p>
          ) : (
            <div className="space-y-1.5">
              {job.scheduleEvents
                ?.slice()
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
                .map((event) => {
                  const start = new Date(event.startAt);
                  const end = new Date(event.endAt);
                  const now = new Date();
                  const isToday = start.toDateString() === now.toDateString();
                  const isPast = end < now && !isToday;
                  const plannedHours = ((end.getTime() - start.getTime()) / 3600000).toFixed(1);
                  const dateStr = format(start, "EEE, MMM d");
                  const timeStr = `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
                  const statusLabel = isToday ? "Today" : isPast ? "Done" : "Upcoming";
                  const statusClass = isToday
                    ? "border-teal-200 bg-teal-50 text-teal-700"
                    : isPast
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-blue-200 bg-blue-50 text-blue-700";
                  const cardBorder = isToday ? "border-teal-300" : isPast ? "border-slate-100" : "border-slate-200";
                  return (
                    <article
                      key={event.id}
                      className={`flex items-start justify-between rounded-lg border ${cardBorder} ${isPast ? "bg-slate-50/30" : "bg-white"} px-3 py-2 text-sm`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium ${isPast ? "text-slate-500" : "text-slate-900"}`}>{dateStr}</p>
                          <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${statusClass}`}>
                            {statusLabel}
                          </span>
                          <span className="text-[10px] text-slate-400">{plannedHours}h planned</span>
                        </div>
                        <p className={`text-xs ${isPast ? "text-slate-400" : "text-slate-600"}`}>{timeStr}</p>
                        <p className="text-[11px] text-slate-400">Crew: {assignedCrewLabel}</p>
                        {event.notes ? <p className="text-[11px] text-slate-400 italic">{event.notes}</p> : null}
                      </div>
                      {canManageSchedule ? (
                        <div className="flex shrink-0 items-center gap-1 ml-2">
                          <a
                            href={`/jobs/${job.id}?edit=${event.id}#schedule`}
                            className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                          >
                            Edit
                          </a>
                          <form action={deleteScheduleEventAction} className="inline">
                            <input type="hidden" name="eventId" value={event.id} />
                            <input type="hidden" name="jobId" value={job.id} />
                            <button type="submit" className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-red-50 hover:text-red-600">
                              ✕
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
            </div>
          )}
        </div>

        <details className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-900">Labor this week</summary>
          <p className="mt-1 text-xs text-slate-500">{format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}</p>
          <div className="mt-2 space-y-1">
            {weeklyLaborRows.map((row) => (
              <div key={row.workerName} className="flex items-center justify-between text-xs text-slate-700">
                <p>{row.workerName}</p>
                <p>{row.hours.toFixed(2)}h - {currency(row.pay)}</p>
              </div>
            ))}
            {weeklyLaborRows.length === 0 ? <p className="text-xs text-slate-500">No labor logged on this job this week.</p> : null}
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-700">
            <p>Week Total: {weeklyLaborTotals.hours.toFixed(2)}h - {currency(weeklyLaborTotals.pay)}</p>
          </div>
        </details>
      </section >

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="inline-flex cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
            Open Joist docs ({documentAssets.length})
          </summary>
          <p className="mt-2 text-xs text-slate-500">Upload one Joist PDF. We auto-extract customer, address, estimate/invoice number, and total.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FileCapture jobId={job.id} fileType="DOCUMENT" />
            <div className="space-y-2">
              <p className="text-xs text-slate-600">Uploaded documents ({documentAssets.length})</p>
              <div className="rounded-xl border border-slate-200 p-2 text-xs">
                {documentAssets.length === 0 ? (
                  <p className="text-slate-500">No Joist/scope documents yet. Upload a PDF above.</p>
                ) : (
                  <ul className="space-y-1">
                    {documentAssets.map((asset) => (
                      <li key={asset.id}>
                        <a
                          href={getStoragePublicUrl(asset.storageKey)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-teal-700 underline"
                        >
                          {asset.fileName}
                        </a>
                        {asset.description ? (
                          <p className="mt-0.5 text-slate-500">{asset.description}</p>
                        ) : (
                          <p className="mt-0.5 text-amber-700">No extracted details yet. Re-upload the PDF to process details.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </details>
      </section>
    </>
  );
}
