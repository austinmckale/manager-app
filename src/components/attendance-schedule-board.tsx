"use client";

import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import Link from "next/link";

type ScheduleBlock = {
  eventId: string;
  jobId: string;
  jobName: string;
  startAt: string;
  endAt: string;
};

type ScheduleRow = {
  userId: string;
  fullName: string;
  weeklyHoursThisWeek: number;
  weeklyHoursNextWeek: number;
  dayBlocks: ScheduleBlock[][];
};

export function AttendanceScheduleBoard(props: {
  rows: ScheduleRow[];
  thisWeekStartIso: string;
  thisWeekEndIso: string;
  nextWeekStartIso: string;
  nextWeekEndIso: string;
  defaultDayIndex: number;
}) {
  const [weekView, setWeekView] = useState<"this" | "next">("this");
  const [dayIndex, setDayIndex] = useState(
    Math.max(0, Math.min(6, Number.isFinite(props.defaultDayIndex) ? props.defaultDayIndex : 0)),
  );

  const thisWeekStart = useMemo(() => parseISO(props.thisWeekStartIso), [props.thisWeekStartIso]);
  const thisWeekEnd = useMemo(() => parseISO(props.thisWeekEndIso), [props.thisWeekEndIso]);
  const nextWeekStart = useMemo(() => parseISO(props.nextWeekStartIso), [props.nextWeekStartIso]);
  const nextWeekEnd = useMemo(() => parseISO(props.nextWeekEndIso), [props.nextWeekEndIso]);

  const thisWeekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(thisWeekStart, index)),
    [thisWeekStart],
  );
  const nextWeekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(nextWeekStart, index)),
    [nextWeekStart],
  );

  const activeDays = weekView === "this" ? thisWeekDays : nextWeekDays;
  const weekOffset = weekView === "this" ? 0 : 7;
  const activeStart = weekView === "this" ? thisWeekStart : nextWeekStart;
  const activeEnd = weekView === "this" ? thisWeekEnd : nextWeekEnd;
  const heading = weekView === "this" ? "This week's schedule (by employee)" : "Next week's schedule (by employee)";
  const selectedDay = activeDays[dayIndex] ?? activeDays[0];

  return (
    <>
      <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
      <p className="mt-1 text-xs text-slate-500">
        {format(activeStart, "MMM d")} - {format(activeEnd, "MMM d, yyyy")}. Each row is an employee; cells show the jobs they are
        scheduled on.
      </p>
      <p className="mt-1 text-xs text-slate-600">
        To change the plan, click a block to edit its visit on the job page. Day-of, use Today or the Payroll tab to clock people
        in and adjust actual hours.
      </p>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setWeekView("this")}
          className={`rounded-full px-3 py-1 ${weekView === "this" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          This Week
        </button>
        <button
          type="button"
          onClick={() => setWeekView("next")}
          className={`rounded-full px-3 py-1 ${weekView === "next" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          Next Week
        </button>
      </div>

      <div className="mt-2 flex gap-1 overflow-x-auto pb-1 text-xs sm:hidden">
        {activeDays.map((day, index) => {
          const active = index === dayIndex;
          return (
            <button
              key={`${weekView}-${day.toISOString()}`}
              type="button"
              onClick={() => setDayIndex(index)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 ${active ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {format(day, "EEE d")}
            </button>
          );
        })}
      </div>

      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-2 sm:hidden">
        <p className="text-xs font-medium text-slate-700">Showing {format(selectedDay, "EEE, MMM d")}</p>
        <div className="mt-2 space-y-2">
          {props.rows.map((row) => {
            const blocks = row.dayBlocks[weekOffset + dayIndex] ?? [];
            const weekHours = weekView === "this" ? row.weeklyHoursThisWeek : row.weeklyHoursNextWeek;
            return (
              <article key={`${row.userId}-${weekView}-${dayIndex}`} className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/time?workerId=${row.userId}`} className="text-sm font-medium text-slate-900 hover:underline">
                    {row.fullName}
                  </Link>
                  {weekHours > 0 ? <span className="text-[11px] text-slate-500">{weekHours.toFixed(1)}h wk</span> : null}
                </div>
                {blocks.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">No scheduled visit.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {blocks.map((block, index) => (
                      <li key={`${block.eventId}-${index}`} className="text-xs text-slate-700">
                        <Link
                          href={`/jobs/${block.jobId}?edit=${block.eventId}#schedule`}
                          className="inline-flex flex-wrap items-baseline gap-1 rounded px-0.5 -mx-0.5 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <span className="font-medium text-slate-800">{block.jobName}</span>
                          <span className="text-slate-500">
                            {format(new Date(block.startAt), "h:mm a")} - {format(new Date(block.endAt), "h:mm a")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="bg-slate-50 px-2 py-2 text-left font-medium text-slate-700">Employee</th>
              {activeDays.map((day) => (
                <th key={`${weekView}-head-${day.toISOString()}`} className="bg-slate-50 px-2 py-2 text-center font-medium text-slate-700">
                  {format(day, "EEE")} {format(day, "d")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => {
              const weekHours = weekView === "this" ? row.weeklyHoursThisWeek : row.weeklyHoursNextWeek;
              return (
                <tr key={`${row.userId}-${weekView}`} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-medium text-slate-900">
                    <div className="flex flex-col">
                      <Link href={`/time?workerId=${row.userId}`} className="max-w-[180px] truncate text-slate-900 hover:underline">
                        {row.fullName}
                      </Link>
                      {weekHours > 0 ? <span className="text-[11px] text-slate-500">Scheduled: {weekHours.toFixed(1)}h</span> : null}
                    </div>
                  </td>
                  {Array.from({ length: 7 }, (_, dayIndexInWeek) => {
                    const blocks = row.dayBlocks[weekOffset + dayIndexInWeek] ?? [];
                    return (
                      <td key={`${row.userId}-${weekView}-${dayIndexInWeek}`} className="px-2 py-1.5 align-top">
                        {blocks.length === 0 ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {blocks.map((block, index) => (
                              <li key={`${block.eventId}-${index}`} className="text-xs text-slate-700">
                                <Link
                                  href={`/jobs/${block.jobId}?edit=${block.eventId}#schedule`}
                                  className="inline-flex flex-wrap items-baseline gap-0.5 rounded px-0.5 -mx-0.5 hover:bg-slate-100 hover:text-slate-900"
                                >
                                  <span className="font-medium text-slate-800">{block.jobName}</span>
                                  <span className="text-slate-500">
                                    {" "}
                                    {format(new Date(block.startAt), "h:mm a")} - {format(new Date(block.endAt), "h:mm a")}
                                  </span>
                                </Link>
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
    </>
  );
}
