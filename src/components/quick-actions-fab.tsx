"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Camera, Receipt, FileText, PhoneIncoming, BriefcaseBusiness } from "lucide-react";

const actions = [
  { href: "/leads#new-lead-form", label: "New Lead (estimate)", icon: PhoneIncoming },
  { href: "/jobs#new-job", label: "New Job (already sold)", icon: BriefcaseBusiness },
  { href: "/attendance#add-worker-form", label: "Add Worker", icon: Plus },
  { href: "/jobs?view=today", label: "Open Job Expenses", icon: Receipt },
  { href: "/jobs?view=today", label: "Open Photo Capture", icon: Camera },
  { href: "/leads#joist-import", label: "Joist Import (from CSV)", icon: FileText },
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
