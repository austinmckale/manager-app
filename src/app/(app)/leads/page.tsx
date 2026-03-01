import { Suspense } from "react";
import Link from "next/link";
import { LeadSource, LeadStage } from "@prisma/client";
import { format, subDays } from "date-fns";
import { convertLeadToJobAction, createLeadAction, updateLeadDetailsAction, updateLeadStageAction } from "@/app/(app)/actions";
import { RoutePanelSkeleton } from "@/components/route-panel-skeleton";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { createRoutePerf } from "@/lib/route-perf";

const stageOrder: LeadStage[] = [
  LeadStage.NEW,
  LeadStage.CONTACTED,
  LeadStage.ESTIMATE_SENT,
  LeadStage.WON,
  LeadStage.LOST,
];
const openStages: LeadStage[] = [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.ESTIMATE_SENT];
const closedStages: LeadStage[] = [LeadStage.WON, LeadStage.LOST];

const sourceOptions: LeadSource[] = [
  LeadSource.WEBSITE_FORM,
  LeadSource.PHONE_CALL,
  LeadSource.TEXT,
  LeadSource.REFERRAL,
  LeadSource.OTHER,
];

export default function LeadsPage() {
  return (
    <Suspense fallback={<RoutePanelSkeleton cards={4} sections={5} />}>
      <LeadsPageContent />
    </Suspense>
  );
}

async function LeadsPageContent() {
  const perf = createRoutePerf("/leads");
  let orgId = "";
  let role = "";
  try {
    const auth = await perf.time("auth", () => requireAuth());
    orgId = auth.orgId;
    role = auth.role;

    const leads = await perf.time("leads_query", async () =>
      isDemoMode()
        ? [
          {
            id: "demo-lead-1",
            jobId: null,
            contactName: "Samantha Reed",
            phone: "555-101-9090",
            email: "samantha@example.com",
            address: "14 Cedar St",
            serviceType: "Water Damage",
            source: LeadSource.WEBSITE_FORM,
            stage: LeadStage.ESTIMATE_SENT,
            notes: "Needs insurance scope",
            lostReason: null,
            convertedAt: null,
            createdAt: new Date(),
          },
          {
            id: "demo-lead-2",
            jobId: null,
            contactName: "John Ortiz",
            phone: "555-777-1212",
            email: null,
            address: "800 North Ave",
            serviceType: "Bathroom Remodel",
            source: LeadSource.PHONE_CALL,
            stage: LeadStage.CONTACTED,
            notes: null,
            lostReason: null,
            convertedAt: null,
            createdAt: new Date(),
          },
        ]
        : await prisma.lead.findMany({
          where: { orgId: auth.orgId },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            jobId: true,
            contactName: true,
            phone: true,
            email: true,
            address: true,
            serviceType: true,
            source: true,
            stage: true,
            notes: true,
            createdAt: true,
          },
        }),
    );

    type LeadRow = (typeof leads)[number];
    const leadsByStage = new Map<LeadStage, LeadRow[]>();
    for (const stage of stageOrder) {
      leadsByStage.set(stage, []);
    }
    let openCount = 0;
    let hiddenLinkedOpenCount = 0;

    for (const lead of leads) {
      if (lead.jobId && openStages.includes(lead.stage)) {
        hiddenLinkedOpenCount += 1;
        continue;
      }

      // Treat SITE_VISIT_SET leads as CONTACTED (stage was removed from UI)
      const displayStage = lead.stage === LeadStage.SITE_VISIT_SET ? LeadStage.CONTACTED : lead.stage;
      const bucket = leadsByStage.get(displayStage);
      if (bucket) {
        bucket.push(lead as LeadRow);
      }

      if (openStages.includes(displayStage)) {
        openCount += 1;
      }
    }

    const closedCutoff = subDays(new Date(), 30);
    const wonCount = (leadsByStage.get(LeadStage.WON) ?? []).length;

    return (
      <div className="space-y-4">
        {/* Header with counts + New Lead button */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Leads</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {openCount} open{wonCount > 0 ? ` · ${wonCount} won` : ""}
              </p>
            </div>
            <details className="relative">
              <summary className="cursor-pointer rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
                + New Lead
              </summary>
              <form action={createLeadAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input name="contactName" required placeholder="Contact name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <select name="source" defaultValue={LeadSource.WEBSITE_FORM} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>{source.replaceAll("_", " ")}</option>
                  ))}
                </select>
                <input name="phone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <input name="email" type="email" placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <input name="address" placeholder="Address" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                <input name="serviceType" placeholder="Service type (kitchen, roof, water damage)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                <textarea name="notes" rows={2} placeholder="Notes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                <button type="submit" className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Save Lead</button>
              </form>
            </details>
          </div>
        </section>

        {/* Pipeline buckets */}
        <section className="space-y-3">
          {hiddenLinkedOpenCount > 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {hiddenLinkedOpenCount} imported lead{hiddenLinkedOpenCount === 1 ? "" : "s"} already linked to jobs (hidden).
            </p>
          ) : null}
          {openStages.map((stage) => {
            const stageLeads = leadsByStage.get(stage) ?? [];
            return (
              <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">{stage.replaceAll("_", " ")}</h4>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {stageLeads.map((lead) => {
                    const hasJob = !!lead.jobId;
                    const jobId = lead.jobId;
                    return (
                      <article key={lead.id} className="rounded-xl border border-slate-200 p-3">
                        {/* Lead info */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{lead.contactName}</p>
                            <p className="text-xs text-slate-500">
                              {lead.serviceType || "Service TBD"} · {lead.source.replaceAll("_", " ")}
                            </p>
                            <p className="text-xs text-slate-500">
                              {lead.phone || "No phone"}{lead.email ? ` · ${lead.email}` : ""}
                            </p>
                            {"address" in lead && lead.address ? (
                              <p className="mt-0.5 text-xs text-slate-600">{lead.address}</p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[10px] text-slate-400">{format(lead.createdAt, "MMM d")}</span>
                        </div>

                        {"notes" in lead && lead.notes ? (
                          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                            {lead.notes}
                          </div>
                        ) : null}

                        {/* Actions row — stage + convert inline */}
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <form action={updateLeadStageAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="leadId" value={lead.id} />
                            <select
                              name="stage"
                              defaultValue={lead.stage}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            >
                              {stageOrder.map((s) => (
                                <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                              ))}
                            </select>
                            <input
                              name="lostReason"
                              placeholder="Lost reason"
                              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            />
                            <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                              Update
                            </button>
                          </form>

                          {hasJob && jobId ? (
                            <Link href={`/jobs/${jobId}`} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                              Open job
                            </Link>
                          ) : (
                            <form action={convertLeadToJobAction} className="flex items-center gap-1.5">
                              <input type="hidden" name="leadId" value={lead.id} />
                              <input
                                name="jobName"
                                placeholder="Job name (optional)"
                                className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                              />
                              <button type="submit" className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800">
                                Convert
                              </button>
                            </form>
                          )}
                        </div>

                        {/* Edit details — collapsed */}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">Edit details</summary>
                          <form action={updateLeadDetailsAction} className="mt-2 grid gap-2">
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input name="contactName" required defaultValue={lead.contactName} placeholder="Contact name" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input name="phone" defaultValue={lead.phone ?? ""} placeholder="Phone" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                              <input name="email" type="email" defaultValue={lead.email ?? ""} placeholder="Email" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                            </div>
                            <input name="address" defaultValue={lead.address ?? ""} placeholder="Address" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input name="serviceType" defaultValue={lead.serviceType ?? ""} placeholder="Service type" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                              <select name="source" defaultValue={lead.source} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                                {sourceOptions.map((source) => (
                                  <option key={source} value={source}>{source.replaceAll("_", " ")}</option>
                                ))}
                              </select>
                            </div>
                            <textarea name="notes" rows={2} defaultValue={lead.notes ?? ""} placeholder="Notes" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                            <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Save</button>
                          </form>
                        </details>
                      </article>
                    );
                  })}
                  {stageLeads.length === 0 ? <p className="text-xs text-slate-500">No leads in this stage.</p> : null}
                </div>
              </article>
            );
          })}
        </section>

        {/* Won/Lost archive */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              Won / Lost (last 30 days)
            </summary>
            <div className="mt-3 space-y-3">
              {closedStages.map((stage) => {
                const stageLeads = leadsByStage.get(stage) ?? [];
                const visibleLeads = stageLeads.filter((lead) => lead.createdAt >= closedCutoff);
                return (
                  <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-900">{stage.replaceAll("_", " ")}</h4>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                        {visibleLeads.length}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {visibleLeads.map((lead) => {
                        const hasJob = !!lead.jobId;
                        const jobId = lead.jobId;
                        return (
                          <article key={lead.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-900">{lead.contactName}</p>
                                <p className="text-xs text-slate-500">
                                  {lead.serviceType || "Service TBD"} · {lead.source.replaceAll("_", " ")}
                                </p>
                                {hasJob && jobId ? (
                                  <Link href={`/jobs/${jobId}`} className="mt-1 inline-block text-xs text-emerald-700 underline">
                                    Open job
                                  </Link>
                                ) : null}
                              </div>
                              <span className="shrink-0 text-[10px] text-slate-400">{format(lead.createdAt, "MMM d")}</span>
                            </div>
                          </article>
                        );
                      })}
                      {visibleLeads.length === 0 ? <p className="text-xs text-slate-500">No leads in this stage.</p> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        </section>
      </div>
    );
  } finally {
    perf.flush({ orgId, role });
  }
}
