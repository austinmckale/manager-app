"use client";

import { useEffect, useMemo, useState } from "react";
import type { TodoGroup } from "@/lib/implementation-todos";

const STORAGE_KEY = "fieldflow_todo_checks_v1";

export function TodoBoard({ groups }: { groups: TodoGroup[] }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
  }, [checks]);

  const totals = useMemo(() => {
    const allIds = groups.flatMap((group) => group.items.map((item) => item.id));
    const completed = allIds.filter((id) => checks[id]).length;
    return { completed, total: allIds.length };
  }, [groups, checks]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Execution To-Do Board</h2>
        <p className="mt-1 text-sm text-teal-800">
          Track completion in one place. Progress: {totals.completed}/{totals.total}
        </p>
      </section>

      {groups.map((group) => (
        <section key={group.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
          <div className="mt-3 space-y-2 text-sm">
            {group.items.map((item) => (
              <label key={item.id} className="flex items-start gap-2 rounded-xl border border-slate-200 p-2">
                <input
                  type="checkbox"
                  checked={Boolean(checks[item.id])}
                  onChange={(event) =>
                    setChecks((prev) => ({
                      ...prev,
                      [item.id]: event.target.checked,
                    }))
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-900">{item.title}</span>
                  {item.details ? <span className="mt-0.5 block text-xs text-slate-500">{item.details}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
