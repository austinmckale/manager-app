import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { getJobById } from "@/lib/data";
import { canManageOrg } from "@/lib/permissions";
import { SERVICE_TAG_OPTIONS, normalizeServiceTags } from "@/lib/service-tags";
import { currency, percent } from "@/lib/utils";
import { JobStatusBadge } from "@/components/job-status-badge";
import { JobHubTabs } from "@/components/job-hub-tabs";
import { updateJobServiceTagsAction } from "@/app/(app)/actions";

export default async function JobHubLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ jobId: string }>;
}) {
    const auth = await requireAuth();
    const { jobId } = await params;
    const job = await getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId });
    const costing = computeJobCosting(job);
    const controlledCategoryTags = normalizeServiceTags(job.categoryTags);
    const scheduleReady = (job.scheduleEvents?.length ?? 0) > 0;

    return (
        <div className="space-y-4">
            {/* ── Header ── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Job Hub</p>
                        <h2 className="text-xl font-semibold text-slate-900">{job.jobName}</h2>
                        <p className="text-sm text-slate-600">{job.customer.name} - {job.address}</p>
                    </div>
                    <JobStatusBadge status={job.status} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <p>Revenue: {currency(costing.revenue)}</p>
                    <p>Cost: {currency(costing.totalCost)}</p>
                    <p>Profit: {currency(costing.grossProfit)}</p>
                    <p>Margin: {percent(costing.grossMarginPercent)}</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Revenue comes from sent/paid invoices (or approved estimates if no invoices yet) in section 4. Budget fields are for cost tracking only (Labor/Materials vs Budget bars).</p>

                {!scheduleReady ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        <p className="font-medium">Next step: schedule the first visit</p>
                        <p className="mt-1 text-amber-800">This job won&apos;t show on Today/Team until a visit is scheduled.</p>
                        <a href={`/jobs/${jobId}`} className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs">
                            Schedule now
                        </a>
                    </div>
                ) : null}

                <div className="mt-3 rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-slate-900">Service tags</p>
                        <details>
                            <summary className="cursor-pointer rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-700">
                                + Add tag
                            </summary>
                            <form action={updateJobServiceTagsAction} className="mt-2 space-y-2 text-sm">
                                <input type="hidden" name="jobId" value={job.id} />
                                <div className="grid gap-1 sm:grid-cols-2">
                                    {SERVICE_TAG_OPTIONS.map((tag) => (
                                        <label key={tag.slug} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                                            <input type="checkbox" name="serviceTags" value={tag.slug} defaultChecked={controlledCategoryTags.includes(tag.slug)} />
                                            {tag.label}
                                        </label>
                                    ))}
                                </div>
                                <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
                                    Save tags
                                </button>
                            </form>
                        </details>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {controlledCategoryTags.length > 0 ? (
                            controlledCategoryTags.map((tag) => (
                                <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                                    {tag}
                                </span>
                            ))
                        ) : (
                            <span className="text-[11px] text-slate-500">No service tags set yet.</span>
                        )}
                    </div>
                </div>
            </section>

            {/* ── Tab Bar ── */}
            <JobHubTabs jobId={jobId} />

            {/* ── Active Tab Content ── */}
            {children}
        </div>
    );
}
