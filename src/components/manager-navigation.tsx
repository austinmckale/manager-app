"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Inbox, Files, ChartColumnBig, Menu } from "lucide-react";

const primary = [
  { href: "/marketing", label: "Inbox", icon: Inbox },
  { href: "/marketing/saved", label: "Content", icon: Files },
  { href: "/marketing/results", label: "Results", icon: ChartColumnBig },
];
const secondary = [
  { title: "Marketing tools", links: [["/capture", "Add photos"], ["/marketing/intake", "Upload access"], ["/marketing/delivery", "AI processing"], ["/marketing/photo-prep", "Auto-enhance photos"], ["/marketing/buffer", "Buffer"], ["/marketing/connections", "Post to Facebook"], ["/marketing/performance", "Campaign scorecard"]] },
  { title: "Business tools", links: [["/today", "Overview"], ["/leads", "Leads"], ["/jobs", "Jobs & Joist imports"], ["/reports", "Business reports"], ["/attendance", "Team"], ["/settings/targets", "Settings"]] },
];
export function ManagerNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <nav aria-label="Workspace" className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    {open ? <div id="workspace-more" className="mx-auto max-h-[65dvh] max-w-5xl overflow-y-auto border-b border-slate-200 bg-white px-5 py-4 shadow-lg"><div className="flex items-center justify-between"><p className="font-semibold text-slate-900">More tools</p><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-slate-900">Close</button></div><div className="mt-3 grid gap-4 sm:grid-cols-2">{secondary.map((group) => <section key={group.title}><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{group.title}</h2><div className="mt-2 grid gap-1">{group.links.map(([href, label]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-sm font-medium text-slate-900 hover:bg-slate-100">{label}</Link>)}</div></section>)}</div></div> : null}
    <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1 px-2 py-2">{primary.map(({ href, label, icon: Icon }) => {
      const active = href === "/marketing" ? pathname === href : pathname.startsWith(href);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold ${active ? "bg-teal-50 text-teal-950" : "text-slate-900 hover:bg-slate-100"}`}><Icon aria-hidden="true" className="h-5 w-5" />{label}</Link>;
    })}<button type="button" aria-expanded={open} aria-controls="workspace-more" onClick={() => setOpen(!open)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold ${open ? "bg-teal-50 text-teal-950" : "text-slate-900"}`}><Menu aria-hidden="true" className="h-5 w-5" />More</button></div>
  </nav>;
}
