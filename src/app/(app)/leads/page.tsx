import { LeadSource, LeadStage } from "@prisma/client";
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
      });

  const stageCounts = new Map(stageOrder.map((stage) => [stage, 0]));
  for (const lead of leads) {
    stageCounts.set(lead.stage, (stageCounts.get(lead.stage) ?? 0) + 1);
  }
  const openPipelineCount = leads.filter((lead) => ![LeadStage.WON, LeadStage.LOST].includes(lead.stage)).length;
  const leadsByStage = new Map(stageOrder.map((stage) => [stage, leads.filter((lead) => lead.stage === stage)]));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Lead Intake</h2>
        <p className="mt-1 text-sm text-teal-800">Capture website forms, phone calls, and text leads in one place.</p>
        <p className="mt-1 text-xs text-teal-700">
          Auto-intake webhook: <span className="font-mono">/api/leads/intake</span> (use <span className="font-mono">x-lead-intake-key</span> header).
        </p>
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4" id="new-lead-form">
        <h3 className="text-sm font-semibold text-slate-900">New Lead</h3>
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
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Save Lead</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Joist CSV Import</h3>
        <p className="mt-1 text-xs text-slate-500">Upload Joist estimate/invoice export to auto-create and update leads.</p>
        <form action={importJoistCsvAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input name="csvFile" type="file" accept=".csv,text/csv" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Import CSV</button>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stageOrder.map((stage) => (
          <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{stage.replaceAll("_", " ")}</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{stageCounts.get(stage) ?? 0}</p>
          </article>
        ))}
      </section>

      <section className="space-y-3">
        {stageOrder.map((stage) => {
          const stageLeads = leadsByStage.get(stage) ?? [];
          return (
            <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">{stage.replaceAll("_", " ")}</h4>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{stageLeads.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {stageLeads.map((lead) => (
                  <article key={lead.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{lead.contactName}</p>
                        <p className="text-xs text-slate-500">{lead.serviceType || "Service TBD"} • {lead.source.replaceAll("_", " ")}</p>
                        <p className="text-xs text-slate-500">{lead.phone || "No phone"} {lead.email ? `• ${lead.email}` : ""}</p>
                      </div>
                    </div>

                    <form action={updateLeadStageAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <select name="stage" defaultValue={lead.stage} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                        {stageOrder.map((nextStage) => (
                          <option key={nextStage} value={nextStage}>{nextStage.replaceAll("_", " ")}</option>
                        ))}
                      </select>
                      <input name="lostReason" placeholder="Lost reason (if lost)" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                      <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Save Stage</button>
                    </form>

                    {lead.stage !== LeadStage.WON ? (
                      <form action={convertLeadToJobAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input type="hidden" name="leadId" value={lead.id} />
                        <input name="jobName" placeholder="Optional job name override" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white">Convert To Job</button>
                      </form>
                    ) : null}
                  </article>
                ))}
                {stageLeads.length === 0 ? <p className="text-xs text-slate-500">No leads in this stage.</p> : null}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

