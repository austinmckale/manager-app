import Link from "next/link";

type TeamTabsProps = {
  active: "attendance" | "payroll";
};

const tabs = [
  { href: "/attendance", label: "Attendance", key: "attendance" as const },
  { href: "/time", label: "Payroll", key: "payroll" as const },
];

export function TeamTabs({ active }: TeamTabsProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-1">
      <div className="grid grid-cols-2 gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded-xl px-3 py-2 text-center text-xs font-medium ${
              active === tab.key
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
