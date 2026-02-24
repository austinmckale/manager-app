import Link from "next/link";
import { BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ReceiptText, Settings, PhoneIncoming, ClipboardCheck } from "lucide-react";
import { QuickActionsFab } from "@/components/quick-actions-fab";

type AppShellProps = {
  title: string;
  userName: string;
  children: React.ReactNode;
};

const navItems = [
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/leads", label: "Leads", icon: PhoneIncoming },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "/dashboard", label: "Dashboard", icon: ChartNoAxesCombined },
  { href: "/accounting", label: "Accounting", icon: ReceiptText },
  { href: "/settings/targets", label: "Settings", icon: Settings },
];

export function AppShell({ title, userName, children }: AppShellProps) {
  return (
    <div className="mx-auto min-h-dvh max-w-5xl bg-white pb-24">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">FieldFlow Manager</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">{userName}</span>
        </div>
      </header>
      <main className="px-4 py-4">{children}</main>
      <QuickActionsFab />
      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-7 gap-1 px-1 py-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center rounded-xl px-2 py-2 text-[11px] text-slate-600 hover:bg-slate-100"
              >
                <Icon className="h-4 w-4" />
                <span className="mt-1">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
