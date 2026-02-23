"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Camera, Receipt, Timer, FileText, UserPlus } from "lucide-react";

const actions = [
  { href: "/time", label: "Start Timer", icon: Timer },
  { href: "/jobs", label: "Add Expense", icon: Receipt },
  { href: "/jobs", label: "Capture Photo", icon: Camera },
  { href: "/jobs", label: "Invoice/Estimate", icon: FileText },
  { href: "/settings/targets#add-worker-form", label: "Add Worker", icon: UserPlus },
];

export function QuickActionsFab() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-24 right-4 z-30">
      {open ? (
        <div className="mb-2 space-y-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"
              >
                <Icon className="h-4 w-4 text-teal-600" />
                <span>{action.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}
