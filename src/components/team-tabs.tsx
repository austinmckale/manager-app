import Link from "next/link";

type TeamTabsProps = {
  active: "attendance" | "payroll";
};

const tabs = [
  { href: "/attendance", label: "Attendance", key: "attendance" as const },
  { href: "/time", label: "Payroll Dashboard", key: "payroll" as const },
];

export function TeamTabs({ active }: TeamTabsProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-1">
      <div className="grid grid-cols-2 gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}
            className={`rounded-xl px-3 py-2 text-center text-xs font-semibold transition-colors ${
              active === tab.key
                ? "bg-teal-700 text-white shadow-sm ring-2 ring-teal-200"
                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            <span>{tab.label}</span>
            {active === tab.key ? <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-teal-100">Current</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
