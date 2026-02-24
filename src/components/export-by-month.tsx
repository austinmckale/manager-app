"use client";

import { useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ExportByMonth() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  const href = `/api/export/monthly?month=${monthParam}`;

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Year</span>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Month</span>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <a
        href={href}
        download
        className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200"
      >
        Download ZIP (Excel / Sheets)
      </a>
    </div>
  );
}
