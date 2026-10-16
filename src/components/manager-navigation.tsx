"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Inbox, Files, ChartColumnBig, Menu } from "lucide-react";

const primary = [
  { href: "/marketing", label: "Inbox", icon: Inbox },
  { href: "/marketing/saved", label: "Drafts", icon: Files },
  { href: "/marketing/performance", label: "Results", icon: ChartColumnBig },
];
const secondary = [
  { title: "Marketing tools", links: [["/capture", "Add photos"], ["/marketing/intake", "Upload access"], ["/marketing/delivery", "Processing & delivery"], ["/marketing/connections", "Account connections"], ["/marketing/results", "Weekly report"]] },
  { title: "Business tools", links: [["/today", "Overview"], ["/leads", "Leads"], ["/jobs", "Jobs & Joist imports"], ["/reports", "Business reports"], ["/attendance", "Team"], ["/settings/targets", "Settings"]] },
];
export function ManagerNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <nav aria-label="Workspace" className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    {open ? <div id="workspace-more" className="mx-auto max-h-[65dvh] max-w-5xl overflow-y-auto border-b border-slate-200 px-5 py-4 shadow-lg"><div className="flex items-center justify-between"><p className="font-semibold">More tools</p><button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600">Close</button></div><div className="mt-3 grid gap-4 sm:grid-cols-2">{secondary.map((group) => <section key={group.title}><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h2><div className="mt-2 grid gap-1">{group.links.map(([href, label]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-sm text-slate-700 hover:bg-slate-100">{label}</Link>)}</div></section>)}</div></div> : null}
    <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1 px-2 py-2">{primary.map(({ href, label, icon: Icon }) => {
      const active = href === "/marketing" ? pathname === href : pathname.startsWith(href);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs ${active ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-600 hover:bg-slate-100"}`}><Icon aria-hidden="true" className="h-5 w-5" />{label}</Link>;
    })}<button aria-expanded={open} aria-controls="workspace-more" onClick={() => setOpen(!open)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs ${open ? "bg-teal-50 text-teal-800" : "text-slate-600"}`}><Menu aria-hidden="true" className="h-5 w-5" />More</button></div>
  </nav>;
}
