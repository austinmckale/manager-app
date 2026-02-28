import Link from "next/link";
import { LeadSource, LeadStage } from "@prisma/client";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import { convertLeadToJobAction, createLeadAction, importJoistCsvAction, updateLeadStageAction } from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";

const stageOrder: LeadStage[] = [
  LeadStage.NEW,
  LeadStage.CONTACTED,
  LeadStage.SITE_VISIT_SET,
  LeadStage.ESTIMATE_SENT,
  LeadStage.WON,
  LeadStage.LOST,
];
const openStages = [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.SITE_VISIT_SET, LeadStage.ESTIMATE_SENT];
const closedStages = [LeadStage.WON, LeadStage.LOST];

const sourceOptions: LeadSource[] = [
  LeadSource.WEBSITE_FORM,
  LeadSource.PHONE_CALL,
  LeadSource.TEXT,
  LeadSource.REFERRAL,
  LeadSource.OTHER,
];

export default async function LeadsPage() {
  const auth = await requireAuth();

  const leads = isDemoMode()
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
      });

  type LeadRow = (typeof leads)[number];
  const stageCounts = new Map(stageOrder.map((stage) => [stage, 0]));
  const leadsByStage = new Map<LeadStage, LeadRow[]>();
  for (const stage of stageOrder) {
    leadsByStage.set(stage, []);
  }
  let openPipelineCount = 0;

  for (const lead of leads) {
    stageCounts.set(lead.stage, (stageCounts.get(lead.stage) ?? 0) + 1);
    const bucket = leadsByStage.get(lead.stage);
    if (bucket) {
      bucket.push(lead as LeadRow);
    }

    const isClosed = lead.stage === LeadStage.WON || lead.stage === LeadStage.LOST;
    if (!isClosed) {
      openPipelineCount += 1;
    }
  }

  const websiteFormLeads = leads.filter((l) => l.source === LeadSource.WEBSITE_FORM);
  const now = new Date();
  const closedCutoff = subDays(now, 30);
  const formSubmissionStats = {
    today: websiteFormLeads.filter((l) => l.createdAt >= startOfDay(now) && l.createdAt <= endOfDay(now)).length,
    last7: websiteFormLeads.filter((l) => l.createdAt >= startOfDay(subDays(now, 7)) && l.createdAt <= endOfDay(now)).length,
    last30: websiteFormLeads.filter((l) => l.createdAt >= startOfDay(subDays(now, 30)) && l.createdAt <= endOfDay(now)).length,
  };
  const recentFormLeads = websiteFormLeads.slice(0, 8);

  return (
    <div className="space-y-4">
      <section
        id="joist-import"
        className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"
      >
        <h3 className="text-sm font-semibold text-emerald-900">Upload from Joist (CSV or PDF)</h3>
        <p className="mt-2 text-xs text-emerald-800">
          Upload Joist exports here (CSV bulk exports or estimate/invoice PDFs). We auto-create or update leads from each
          document.
        </p>
        <form action={importJoistCsvAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            name="csvFile"
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            multiple
            required
            className="rounded-xl border border-emerald-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl border border-emerald-400 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Import Joist Files
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Pipeline Command</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Open Pipeline</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{openPipelineCount}</p>
          </article>
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Won Leads</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">{stageCounts.get(LeadStage.WON) ?? 0}</p>
          </article>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Stage summary
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stageOrder.map((stage) => (
              <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{stage.replaceAll("_", " ")}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{stageCounts.get(stage) ?? 0}</p>
              </article>
            ))}
          </div>
        </details>
      </section>

      <section className="space-y-3">
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{lead.contactName}</p>
                          <p className="text-xs text-slate-500">
                            {lead.serviceType || "Service TBD"} - {lead.source.replaceAll("_", " ")}
                          </p>
                          <p className="text-xs text-slate-500">
                            {lead.phone || "No phone"} {lead.email ? ` · ${lead.email}` : ""}
                          </p>
                          {"address" in lead && lead.address ? (
                            <p className="mt-1 text-xs text-slate-600">📍 {lead.address}</p>
                          ) : null}
                          {"notes" in lead && lead.notes ? (
                            <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                              {lead.notes}
                            </div>
                          ) : null}
                      {hasJob && jobId ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              <Link href={`/jobs/${jobId}`} className="rounded-full border border-emerald-200 px-2 py-0.5 text-emerald-700">
                                Open job
                              </Link>
                              <Link href={`/jobs/${jobId}#schedule`} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600">
                                Schedule first visit
                              </Link>
                            </div>
                          ) : lead.stage === LeadStage.WON ? (
                            <p className="mt-2 text-[11px] text-amber-700">
                              Won lead with no job yet. Convert to create a job + client from this lead.
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <form action={updateLeadStageAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input type="hidden" name="leadId" value={lead.id} />
                        <select
                          name="stage"
                          defaultValue={lead.stage}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        >
                          {stageOrder.map((nextStage) => (
                            <option key={nextStage} value={nextStage}>
                              {nextStage.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                        <input
                          name="lostReason"
                          placeholder="Lost reason (if lost)"
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                          Save Stage
                        </button>
                      </form>

                      {!hasJob ? (
                        <form action={convertLeadToJobAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                          <input type="hidden" name="leadId" value={lead.id} />
                          <input
                            name="jobName"
                            placeholder="Optional job name override"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white">
                            Convert To Job
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
                {stageLeads.length === 0 ? <p className="text-xs text-slate-500">No leads in this stage.</p> : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Won/Lost archive (last 30 days)
          </summary>
          <p className="mt-2 text-xs text-slate-500">
            Converted leads are hidden from the main pipeline. Open the archive if you need to review them.
          </p>
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
                                {lead.serviceType || "Service TBD"} - {lead.source.replaceAll("_", " ")}
                              </p>
                              {hasJob && jobId ? (
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                  <Link href={`/jobs/${jobId}`} className="rounded-full border border-emerald-200 px-2 py-0.5 text-emerald-700">
                                    Open job
                                  </Link>
                                </div>
                              ) : null}
                            </div>
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4" id="new-lead-form">
        <details>
          <summary className="cursor-pointer rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Website form log
          </summary>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="text-slate-500">Today:</span>
            <span className="font-medium text-slate-900">{formSubmissionStats.today}</span>
            <span className="text-slate-500">7d:</span>
            <span className="font-medium text-slate-900">{formSubmissionStats.last7}</span>
            <span className="text-slate-500">30d:</span>
            <span className="font-medium text-slate-900">{formSubmissionStats.last30}</span>
          </div>
          {recentFormLeads.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No website form submissions yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recentFormLeads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-900">{lead.contactName}</span>
                  <span className="text-slate-500">
                    {(lead as LeadRow).serviceType ?? "-"} · {format(lead.createdAt, "MMM d, yyyy")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}
