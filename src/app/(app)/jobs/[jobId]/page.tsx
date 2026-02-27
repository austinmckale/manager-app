import { TaskStatus } from "@prisma/client";
import { addDays, endOfWeek, format, startOfDay, startOfWeek } from "date-fns";
import {
  addPaymentAction,
  approveChangeOrderAction,
  approveEstimateAction,
  convertEstimateToInvoiceAction,
  createChangeOrderAction,
  createEstimateAction,
  createExpenseAction,
  createTaskAction,
  deleteScheduleEventAction,
  quickScheduleCrewAction,
  sendInvoiceAction,
  togglePortfolioAction,
  updateJobServiceTagsAction,
  updateJobStatusAction,
  updateScheduleEventAction,
  updateTaskStatusAction,
} from "@/app/(app)/actions";
import { CostHealth } from "@/components/cost-health";
import { FileCapture } from "@/components/file-capture";
import { JobStatusBadge } from "@/components/job-status-badge";
import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { getJobById, getOrgUsers } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { SERVICE_TAG_OPTIONS, normalizeServiceTags } from "@/lib/service-tags";
import { buildAbsoluteUrl, currency, getStoragePublicUrl, percent, toNumber } from "@/lib/utils";

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

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{
    shareToken?: string;
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

  const [job, users] = await Promise.all([
    getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId }),
    getOrgUsers(auth.orgId),
  ]);

  const costing = computeJobCosting(job);
  const controlledCategoryTags = normalizeServiceTags(job.categoryTags);
  const assignedUserIds = new Set(job.assignments?.map((assignment) => assignment.userId) ?? []);
  const assignedCrew = users.filter((user) => assignedUserIds.has(user.id));
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
    while (out.length < 15) {
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
    const minutes = (entry.end.getTime() - entry.start.getTime()) / 60000;
    const hours = minutes / 60;
    const pay = hours * toNumber(entry.hourlyRateLoaded);
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
  const scheduleReady = (job.scheduleEvents?.length ?? 0) > 0;
  const photoAssets = job.fileAssets.filter((asset) => asset.type === "PHOTO");
  const receiptAssets = job.fileAssets.filter((asset) => asset.type === "RECEIPT");
  const documentAssets = job.fileAssets.filter((asset) => asset.type === "DOCUMENT");
  const galleryAssetIds = photoAssets
    .filter((asset) => asset.isPortfolio || asset.isClientVisible)
    .slice(0, 20)
    .map((asset) => asset.id)
    .join(",");
  const todayStart = startOfDay(new Date());
  const tomorrowStart = addDays(todayStart, 1);
  const todayPhotoAssets = photoAssets.filter(
    (asset) => asset.createdAt >= todayStart && asset.createdAt < tomorrowStart,
  );
  const earlierPhotoAssets = photoAssets.filter(
    (asset) => asset.createdAt < todayStart || asset.createdAt >= tomorrowStart,
  );
  const todayReceiptAssets = receiptAssets.filter(
    (asset) => asset.createdAt >= todayStart && asset.createdAt < tomorrowStart,
  );
  const earlierReceiptAssets = receiptAssets.filter(
    (asset) => asset.createdAt < todayStart || asset.createdAt >= tomorrowStart,
  );
  const photosCaptured = photoAssets.length;
  const receiptsCaptured = receiptAssets.length;
  const openTasks = job.tasks.filter((task) => task.status !== TaskStatus.DONE).length;
  const sentInvoices = job.invoices.filter((invoice) => ["SENT", "PAID", "OVERDUE"].includes(invoice.status)).length;
  const expenseRows = [...job.expenses].sort((a, b) => b.date.getTime() - a.date.getTime());
  const expenseCategoryRows = [
    { key: "MATERIALS", label: "Materials", value: costing.expensesByCategory.MATERIALS },
    { key: "SUBCONTRACTOR", label: "Subcontractor", value: costing.expensesByCategory.SUBCONTRACTOR },
    { key: "PERMIT", label: "Permit", value: costing.expensesByCategory.PERMIT },
    { key: "EQUIPMENT", label: "Equipment", value: costing.expensesByCategory.EQUIPMENT },
    { key: "MISC", label: "Misc", value: costing.expensesByCategory.MISC },
  ];
  const executionChecklist = [
    { label: "Crew scheduled", done: scheduleReady, href: "#schedule" },
    { label: "Photos captured", done: photosCaptured > 0, href: "#capture" },
    { label: "Receipts logged", done: receiptsCaptured > 0, href: "#capture" },
    { label: "Punch list closed", done: openTasks === 0, href: "#tasks" },
    { label: "Invoice sent", done: sentInvoices > 0, href: "#finance" },
  ];
  const executionDone = executionChecklist.filter((item) => item.done).length;
  const shareLinks = isDemoMode()
    ? []
    : await prisma.shareLink.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "desc" }, take: 5 });

  const weeklyVisitSummaries = (() => {
    const events = job.scheduleEvents ?? [];
    const inWeek = events.filter((event) => {
      const start = new Date(event.startAt);
      return start >= weekStart && start <= weekEnd;
    });
    const bySlot = new Map<
      string,
      {
        count: number;
        firstDate: Date;
        lastDate: Date;
        startTime: Date;
        endTime: Date;
      }
    >();
    for (const event of inWeek) {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      const key = `${start.getHours()}:${start.getMinutes()}-${end.getHours()}:${end.getMinutes()}`;
      const existing = bySlot.get(key);
      if (!existing) {
        bySlot.set(key, {
          count: 1,
          firstDate: start,
          lastDate: start,
          startTime: start,
          endTime: end,
        });
      } else {
        existing.count += 1;
        if (start < existing.firstDate) existing.firstDate = start;
        if (start > existing.lastDate) existing.lastDate = start;
      }
    }
    return [...bySlot.values()].sort((a, b) => a.firstDate.getTime() - b.firstDate.getTime());
  })();

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Job Hub</p>
            <h2 className="text-xl font-semibold text-slate-900">{job.jobName}</h2>
            <p className="text-sm text-slate-600">{job.customer.name} - {job.address}</p>
          </div>
          <JobStatusBadge status={job.status} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <p>Revenue: {currency(costing.revenue)}</p>
          <p>Cost: {currency(costing.totalCost)}</p>
          <p>Profit: {currency(costing.grossProfit)}</p>
          <p>Margin: {percent(costing.grossMarginPercent)}</p>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Revenue comes from sent/paid invoices (or approved estimates if no invoices yet) in section 4. Budget fields are for cost tracking only (Labor/Materials vs Budget bars).</p>

        {!scheduleReady ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Next step: schedule the first visit</p>
            <p className="mt-1 text-amber-800">This job won’t show on Today/Team until a visit is scheduled.</p>
            <a href="#schedule" className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs">
              Schedule now
            </a>
          </div>
        ) : null}

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-medium text-slate-900">Service Tags (Website Routing)</p>
          <p className="mt-1 text-[11px] text-slate-500">Starred portfolio photos route by these tags.</p>
          {controlledCategoryTags.length === 0 ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              This job has legacy tags. Select at least one controlled service tag and save.
            </p>
          ) : null}
          <form action={updateJobServiceTagsAction} className="mt-2 space-y-2 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <div className="grid gap-2 sm:grid-cols-3">
              {SERVICE_TAG_OPTIONS.map((tag) => (
                <label key={tag.slug} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input type="checkbox" name="serviceTags" value={tag.slug} defaultChecked={controlledCategoryTags.includes(tag.slug)} />
                  {tag.label}
                </label>
              ))}
            </div>
            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
              Save Service Tags
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Execution Checklist</h3>
        <p className="mt-1 text-xs text-slate-500">Progress {executionDone}/{executionChecklist.length} complete for this job.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {executionChecklist.map((item) => (
            <a key={item.label} href={item.href} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span>{item.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {item.done ? "Done" : "Needs action"}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section id="schedule" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">0) Schedule + Crew</h3>
        {conflictActive ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Schedule conflict</p>
            <p className="mt-1 text-amber-800">
              One of the crew is already scheduled on{" "}
              <span className="font-semibold">{query.conflictJobName ?? "another job"}</span>
              {conflictStart && conflictEnd
                ? ` between ${format(conflictStart, "MMM d h:mm a")} – ${format(conflictEnd, "h:mm a")}.`
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
        <form
          id="quick-schedule-form"
          action={quickScheduleCrewAction}
          className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-3 text-sm"
        >
          <input type="hidden" name="jobId" value={job.id} />
          <div>
            <p className="font-medium">Crew on this job</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              These people are attached to this job&apos;s crew. The visits you schedule below are for the job as a whole; each
              worker&apos;s actual hours still come from clock-in on Team/Payroll.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {users.map((user) => (
                <label key={user.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    name="workerIds"
                    value={user.id}
                    defaultChecked={
                      draftWorkerIds.length > 0 ? draftWorkerSet.has(user.id) : assignedUserIds.has(user.id)
                    }
                  />
                  {user.fullName}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="font-medium">Dates (M–F, next 3 weeks)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-5">
              {quickDates.map((dateValue, index) => {
                const dateKey = format(dateValue, "yyyy-MM-dd");
                const shouldCheck = draftDates.length > 0 ? draftDateSet.has(dateKey) : index === 0;
                return (
                <label key={dateValue.toISOString()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input type="checkbox" name="dates" value={dateKey} defaultChecked={shouldCheck} />
                  {format(dateValue, "EEE M/d")}
                </label>
              );})}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Weekdays only. Or add another date:</p>
            <input
              type="date"
              name="customDate"
              defaultValue={draftCustomDate}
              className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
          </div>

          <div>
            <p className="font-medium">Time Block</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="AM" defaultChecked={(draftSlot || "FULL") === "AM"} />
                AM (8-12)
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="PM" defaultChecked={draftSlot === "PM"} />
                PM (1-5)
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="FULL" defaultChecked={draftSlot ? draftSlot === "FULL" : true} />
                Full (8-5)
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="CUSTOM" defaultChecked={draftSlot === "CUSTOM"} />
                Custom
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2" data-slot-custom>
              <span className="text-[11px] text-slate-500">Custom times (when Custom is selected):</span>
              <label className="inline-flex items-center gap-1 text-xs">
                Start
                <input type="time" name="startTime" defaultValue={draftStartTime} className="rounded border border-slate-300 px-1.5 py-0.5" />
              </label>
              <label className="inline-flex items-center gap-1 text-xs">
                End
                <input type="time" name="endTime" defaultValue={draftEndTime} className="rounded border border-slate-300 px-1.5 py-0.5" />
              </label>
            </div>
          </div>

          <input
            name="notes"
            placeholder="Block notes (optional)"
            defaultValue={draftNotes}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-xl bg-slate-900 px-3 py-2 text-white">Save Crew + Schedule</button>
        </form>

        <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900">
          <p className="font-medium">
            Job crew this week:{" "}
            {assignedCrew.length > 0 ? assignedCrew.map((user) => user.fullName).join(", ") : "None selected yet"}
          </p>
          <p className="mt-1 text-teal-700">
            These people show up on Attendance/Today when you clock in crews for this job. Their exact hours still come from
            clock-in on Team/Payroll.
          </p>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled visits (plan)</p>
          <p className="mb-2 text-[11px] text-slate-500">
            These visits are the plan for this job&apos;s crew. They feed the weekly grid on Team and the Today run sheet, but
            actual hours per worker still come from clock-in on Team/Payroll.
          </p>
          {editingEvent ? (
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
          {weeklyVisitSummaries.length > 0 ? (
            <div className="mb-2 space-y-0.5 text-[11px] text-slate-600">
              {weeklyVisitSummaries.map((summary, index) => (
                <p key={index}>
                  This week:{" "}
                  <span className="font-medium">
                    {format(summary.firstDate, "EEE MMM d")} – {format(summary.lastDate, "EEE MMM d")}
                  </span>{" "}
                  ·{" "}
                  {`${format(summary.startTime, "h:mm a")} – ${format(summary.endTime, "h:mm a")}`} ·{" "}
                  {summary.count === 1 ? "1 visit" : `${summary.count} visits`}
                </p>
              ))}
            </div>
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
                  const dateStr = format(start, "EEE, MMM d");
                  const timeStr = `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
                  const calendarUrl = buildGoogleCalendarUrl({
                    title: `${job.jobName} site visit`,
                    start,
                    end,
                    details: event.notes ?? "",
                    location: job.address ?? "",
                  });
                  return (
                    <article
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{dateStr}</span>
                          <span className="text-slate-600">{timeStr}</span>
                        </div>
                        {event.notes ? <p className="mt-1 text-xs text-slate-500">{event.notes}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <a
                          href={`/jobs/${job.id}?edit=${event.id}#schedule`}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          Edit
                        </a>
                        <a
                          href={calendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                        >
                          Add to Google Calendar
                        </a>
                        <form action={deleteScheduleEventAction} className="inline">
                          <input type="hidden" name="eventId" value={event.id} />
                          <input type="hidden" name="jobId" value={job.id} />
                          <button
                            type="submit"
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-900">This Job Labor (This Week)</p>
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
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Joist / Scope of work</h3>
        <p className="mt-1 text-xs text-slate-500">Upload your Joist estimate or scope-of-work PDF so price and scope are on file for this job.</p>
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
                      {asset.description ? <span className="ml-1 text-slate-500">· {asset.description}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      <section id="tasks" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">1) Tasks / Punch List</h3>
        <form action={createTaskAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={job.id} />
          <input name="title" required placeholder="Task / punch item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select name="assignedTo" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.fullName}</option>
            ))}
          </select>
          <input name="dueDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add Task</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.tasks.map((task) => (
            <article key={task.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{task.title}</p>
              <p className="text-xs text-slate-500">{task.assignee?.fullName ?? "Unassigned"} · Due {task.dueDate ? format(task.dueDate, "MMM d, yyyy") : "—"}</p>
              <form action={updateTaskStatusAction} className="mt-2 flex gap-2">
                <input type="hidden" name="taskId" value={task.id} />
                <select name="status" defaultValue={task.status} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  {Object.values(TaskStatus).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Update</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section id="capture" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">2) Field capture (photos & receipts)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Use this section in the field to document work and receipts. Today&apos;s captures are grouped first; older items stay
          available below.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-slate-900 px-2 py-1.5 text-white"
              >
                Add job photos
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-slate-900"
              >
                Add receipt
              </button>
            </div>
            <FileCapture jobId={job.id} fileType="PHOTO" />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Photos ({photoAssets.length})</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Today first, then earlier. Tap to view full size.</p>
              {photoAssets.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No photos uploaded yet.</p>
              ) : (
                <div className="mt-1 space-y-2">
                  {todayPhotoAssets.length > 0 ? (
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Today</p>
                      <div className="grid grid-cols-3 gap-2">
                        {todayPhotoAssets.map((asset) => (
                          <div key={asset.id} className="group relative">
                            <a href={getStoragePublicUrl(asset.storageKey)} target="_blank" rel="noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={getStoragePublicUrl(asset.storageKey)}
                                alt={asset.description ?? "asset"}
                                className="aspect-square w-full rounded-xl object-cover"
                              />
                            </a>
                            <form action={togglePortfolioAction} className="absolute right-1 top-1">
                              <input type="hidden" name="assetId" value={asset.id} />
                              <button
                                type="submit"
                                title={asset.isPortfolio ? "Remove from portfolio" : "Add to portfolio"}
                                className={`rounded-lg px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm ${
                                  asset.isPortfolio
                                    ? "bg-teal-600/90 text-white"
                                    : "bg-white/80 text-slate-600 opacity-0 group-hover:opacity-100"
                                }`}
                              >
                                {asset.isPortfolio ? "Portfolio On" : "Add Portfolio"}
                              </button>
                            </form>
                            {asset.stage ? (
                              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                {asset.stage}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {earlierPhotoAssets.length > 0 ? (
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Earlier</p>
                      <div className="grid grid-cols-3 gap-2">
                        {earlierPhotoAssets.map((asset) => (
                          <div key={asset.id} className="group relative">
                            <a href={getStoragePublicUrl(asset.storageKey)} target="_blank" rel="noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={getStoragePublicUrl(asset.storageKey)}
                                alt={asset.description ?? "asset"}
                                className="aspect-square w-full rounded-xl object-cover"
                              />
                            </a>
                            <form action={togglePortfolioAction} className="absolute right-1 top-1">
                              <input type="hidden" name="assetId" value={asset.id} />
                              <button
                                type="submit"
                                title={asset.isPortfolio ? "Remove from portfolio" : "Add to portfolio"}
                                className={`rounded-lg px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm ${
                                  asset.isPortfolio
                                    ? "bg-teal-600/90 text-white"
                                    : "bg-white/80 text-slate-600 opacity-0 group-hover:opacity-100"
                                }`}
                              >
                                {asset.isPortfolio ? "Portfolio On" : "Add Portfolio"}
                              </button>
                            </form>
                            {asset.stage ? (
                              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                {asset.stage}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-2 text-xs">
              <p className="font-medium text-slate-700">Receipts ({receiptAssets.length})</p>
              <div className="mt-1 space-y-1 text-xs">
                {receiptAssets.length === 0 ? (
                  <p className="text-slate-500">No receipts uploaded yet.</p>
                ) : (
                  <>
                    {todayReceiptAssets.length > 0 ? (
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Today</p>
                        <div className="mt-0.5 space-y-0.5">
                          {todayReceiptAssets.map((asset) => (
                            <a
                              key={asset.id}
                              href={getStoragePublicUrl(asset.storageKey)}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-teal-700 underline"
                            >
                              {asset.fileName}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {earlierReceiptAssets.length > 0 ? (
                      <div className="mt-1">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Earlier</p>
                        <div className="mt-0.5 space-y-0.5">
                          {earlierReceiptAssets.map((asset) => (
                            <a
                              key={asset.id}
                              href={getStoragePublicUrl(asset.storageKey)}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-teal-700 underline"
                            >
                              {asset.fileName}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">3) Time + Expenses + Cost Health</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
            <p className="font-medium">Labor Snapshot</p>
            <p>Hours: {costing.laborHours.toFixed(2)}</p>
            <p>Labor Cost: {currency(costing.laborCost)}</p>
            {job.timeEntries.map((entry) => (
              <p key={entry.id} className="text-xs text-slate-500">
                {entry.worker.fullName}: {format(entry.start, "MMM d, h:mm a")} → {entry.end ? format(entry.end, "h:mm a") : "… running"}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <form action={createExpenseAction} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <input type="hidden" name="jobId" value={job.id} />
              <input name="vendor" required placeholder="Vendor (e.g. Home Depot)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="amount" required type="number" step="0.01" placeholder="Amount" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <select name="category" defaultValue="MISC" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="MATERIALS">Materials</option>
                <option value="SUBCONTRACTOR">Subcontractor</option>
                <option value="PERMIT">Permit</option>
                <option value="EQUIPMENT">Equipment</option>
                <option value="MISC">Misc</option>
              </select>
              <input name="date" type="date" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="notes" placeholder="Description (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
              <p className="text-[11px] text-slate-500 sm:col-span-2">Add a receipt in section 2) Photo + Receipt Capture and link it to this expense after saving.</p>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add Expense</button>
            </form>

            <div className="rounded-xl border border-slate-200 p-3 text-xs">
              <p className="font-medium text-slate-900">Expense Summary (This Job)</p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-slate-700">
                {expenseCategoryRows.map((row) => (
                  <p key={row.key}>{row.label}: {currency(row.value)}</p>
                ))}
              </div>
              <p className="mt-2 border-t border-slate-200 pt-2 font-medium text-slate-900">
                Total Expenses: {currency(costing.expensesTotal)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <CostHealth label="Labor vs Budget" value={costing.costHealth.labor} />
          <CostHealth label="Materials vs Budget" value={costing.costHealth.materials} />
          <CostHealth label="Total vs Budget" value={costing.costHealth.total} />
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-900">Expense Ledger</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Each row shows source (receipt or manual). Click to open receipt when available.</p>
          <div className="mt-2 space-y-2">
            {expenseRows.map((expense) => (
              <article
                key={expense.id}
                className={`rounded-lg border p-2 text-xs ${expense.receipt ? "cursor-pointer border-teal-200 bg-teal-50/30 hover:bg-teal-50/60" : "border-slate-200 bg-slate-50/30"}`}
              >
                {expense.receipt ? (
                  <a href={getStoragePublicUrl(expense.receipt.storageKey)} target="_blank" rel="noreferrer" className="block">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{expense.vendor}</p>
                        <p className="text-slate-500">{expense.category} · {format(expense.date, "MMM d, yyyy")}</p>
                      </div>
                      <p className="font-semibold text-slate-900">{currency(toNumber(expense.amount))}</p>
                    </div>
                    {expense.notes ? <p className="mt-1 text-slate-600">{expense.notes}</p> : null}
                    <p className="mt-1.5 font-medium text-teal-700">View receipt →</p>
                  </a>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{expense.vendor}</p>
                        <p className="text-slate-500">{expense.category} · {format(expense.date, "MMM d, yyyy")}</p>
                      </div>
                      <p className="font-semibold text-slate-900">{currency(toNumber(expense.amount))}</p>
                    </div>
                    {expense.notes ? <p className="mt-1 text-slate-600">{expense.notes}</p> : null}
                    <p className="mt-1.5 text-slate-500">Source: Manual entry (no receipt attached)</p>
                  </>
                )}
              </article>
            ))}
            {expenseRows.length === 0 ? <p className="text-xs text-slate-500">No expenses logged for this job yet.</p> : null}
          </div>
        </div>
      </section>

      <section id="finance" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">4) Estimates / Change Orders / Invoices</h3>

        <form action={createEstimateAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={job.id} />
          <input name="description" required placeholder="Estimate line item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input name="quantity" type="number" step="0.01" required defaultValue="1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="unitPrice" type="number" step="0.01" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Estimate</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.estimates.map((estimate) => (
            <article key={estimate.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Estimate {estimate.version} - {estimate.status}</p>
              <p>Total: {currency(toNumber(estimate.total))}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {estimate.status !== "APPROVED" ? (
                  <form action={approveEstimateAction}>
                    <input type="hidden" name="estimateId" value={estimate.id} />
                    <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">Approve</button>
                  </form>
                ) : null}
                <form action={convertEstimateToInvoiceAction}>
                  <input type="hidden" name="estimateId" value={estimate.id} />
                  <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">To Invoice</button>
                </form>
                <a className="rounded-lg border border-slate-300 px-2 py-1 text-xs" href={`/api/pdf/estimate/${estimate.id}`}>PDF</a>
              </div>
            </article>
          ))}
        </div>

        <form action={createChangeOrderAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={job.id} />
          <input name="description" required placeholder="Change order description" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input name="quantity" type="number" step="0.01" defaultValue="1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="unitPrice" type="number" step="0.01" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Change Order</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.changeOrders.map((changeOrder) => (
            <article key={changeOrder.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Change Order - {changeOrder.status}</p>
              <p>{changeOrder.description}</p>
              <p>Total: {currency(toNumber(changeOrder.total))}</p>
              {changeOrder.status !== "APPROVED" ? (
                <form action={approveChangeOrderAction} className="mt-2">
                  <input type="hidden" name="changeOrderId" value={changeOrder.id} />
                  <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">Approve</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {job.invoices.map((invoice) => (
            <article key={invoice.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Invoice - {invoice.status}</p>
              <p>Total: {currency(toNumber(invoice.total))}</p>
              <p className="text-xs text-slate-500">
                {invoice.sentAt ? `Sent ${format(invoice.sentAt, "MMM d, yyyy")}` : "Not sent yet"}
                {invoice.dueDate ? ` · Due ${format(invoice.dueDate, "MMM d, yyyy")}` : ""}
              </p>
              <a className="mt-1 inline-block text-xs text-teal-700 underline" href={`/api/pdf/invoice/${invoice.id}`}>Download PDF</a>
              <form action={sendInvoiceAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="jobId" value={job.id} />
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  {invoice.status === "DRAFT" ? "Send Invoice" : "Update Sent Date"}
                </button>
              </form>
              <form action={addPaymentAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input name="amount" type="number" step="0.01" placeholder="Amount" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <input name="date" type="date" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <input name="method" placeholder="cash/check/card" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Add payment</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">5) Share links</h3>
        <p className="mt-1 text-xs text-slate-500">Generate a link to share timeline or photos with the client (e.g. by text or email).</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <form action="/api/share/create" method="get" className="rounded-xl border border-slate-200 p-3 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="type" value="TIMELINE" />
            <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-white" type="submit">Generate timeline link</button>
          </form>
          <form action="/api/share/create" method="get" className="rounded-xl border border-slate-200 p-3 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="type" value="GALLERY" />
            <input type="hidden" name="selectedAssetIds" value={galleryAssetIds} />
            <button className="rounded-lg bg-slate-700 px-3 py-1.5 text-white" type="submit">Generate gallery link</button>
          </form>
        </div>

        {query.shareToken ? (
          <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Share: {buildAbsoluteUrl(`/share/${query.shareToken}`)}</p>
        ) : null}

        <div className="mt-2 text-xs text-slate-600">
          {shareLinks.map((link) => (
            <p key={link.id}>Share ({link.type}): {buildAbsoluteUrl(`/share/${link.token}`)}</p>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Closeout Checklist</h3>
        <p className="mt-1 text-xs text-slate-500">To move a job to completed, confirm closeout items first.</p>
        <form action={updateJobStatusAction} className="mt-3 space-y-2 text-sm">
          <input type="hidden" name="jobId" value={job.id} />
          <select name="status" defaultValue={job.status} className="w-full rounded-xl border border-slate-300 px-3 py-2">
            <option value="LEAD">Lead</option>
            <option value="ESTIMATE">Estimate</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="COMPLETED">Completed</option>
            <option value="PAID">Paid</option>
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmFinalPhotos" /> Final photos captured
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmPunchList" /> Punch list complete
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmReceipts" /> Receipts logged
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmInvoiceSent" /> Invoice sent
          </label>
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Update Status</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Activity Feed</h3>
        <div className="mt-3 space-y-2 text-sm">
          {job.activityLogs.map((log) => (
            <article key={log.id} className="rounded-xl border border-slate-200 p-2">
              <p className="font-medium">{log.action}</p>
              <p className="text-xs text-slate-500">{log.actor?.fullName ?? "System"} · {format(log.createdAt, "MMM d, h:mm a")}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

