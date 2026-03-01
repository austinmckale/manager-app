"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type JobHubTabsProps = {
  jobId: string;
};

const tabs = [
  { href: "", label: "Schedule", key: "schedule" },
  { href: "/tasks", label: "Tasks", key: "tasks" },
  { href: "/photos", label: "Photos", key: "photos" },
  { href: "/costs", label: "Costs", key: "costs" },
  { href: "/finance", label: "Finance", key: "finance" },
] as const;

export function JobHubTabs({ jobId }: JobHubTabsProps) {
  const pathname = usePathname();
  const basePath = `/jobs/${jobId}`;

  function isActive(tabHref: string) {
    const fullPath = basePath + tabHref;
    if (tabHref === "") {
      // Schedule is the default — active when exactly on /jobs/[id]
      return pathname === basePath || pathname === basePath + "/";
    }
    return pathname.startsWith(fullPath);
  }

  return (
    <nav className="sticky top-0 z-10 -mx-1 bg-white/95 backdrop-blur-sm">
      <div
        className="flex gap-1 overflow-x-auto px-1 py-2 scrollbar-hide"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.key}
              href={`${basePath}${tab.href}`}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${active
                  ? "bg-teal-700 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
