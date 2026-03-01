import { format } from "date-fns";
import {
    addPaymentAction,
    approveChangeOrderAction,
    approveEstimateAction,
    convertEstimateToInvoiceAction,
    createChangeOrderAction,
    createEstimateAction,
    sendInvoiceAction,
    updateJobStatusAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getJobById } from "@/lib/data";
import { currency, toNumber } from "@/lib/utils";

export default async function FinancePage({
    params,
}: {
    params: Promise<{ jobId: string }>;
}) {
    const auth = await requireAuth();
    const { jobId } = await params;
    const job = await getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId });
    const financeOpenItems = (job.estimates?.length ?? 0) + (job.changeOrders?.length ?? 0) + (job.invoices?.length ?? 0);

    return (
        <>
            <section id="finance" className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                    Finance (Estimates, Change Orders, Invoices)
                    <span className="ml-2 text-xs font-normal text-slate-500">({financeOpenItems})</span>
                </h3>

                <form action={createEstimateAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input name="description" required placeholder="Estimate line item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <input name="quantity" type="number" step="0.01" required defaultValue="1" placeholder="Qty" aria-label="Estimate quantity" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <input name="unitPrice" type="number" step="0.01" required placeholder="Unit price ($)" aria-label="Estimate unit price" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Estimate</button>
                </form>

                <div className="mt-3 space-y-2">
                    {job.estimates.map((estimate) => (
                        <article key={estimate.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                            <p className="font-semibold">Estimate {estimate.version} - {estimate.status}</p>
                            <p>Total: {currency(toNumber(estimate.total))}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {estimate.status !== "APPROVED" ? (
                                    <form action={approveEstimateAction}>
                                        <input type="hidden" name="estimateId" value={estimate.id} />
                                        <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">Approve</button>
                                    </form>
                                ) : null}
                                <form action={convertEstimateToInvoiceAction}>
                                    <input type="hidden" name="estimateId" value={estimate.id} />
                                    <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">To Invoice</button>
                                </form>
                                <a className="rounded-lg border border-slate-300 px-2 py-1 text-xs" href={`/api/pdf/estimate/${estimate.id}`}>PDF</a>
                            </div>
                        </article>
                    ))}
                </div>

                <form action={createChangeOrderAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input name="description" required placeholder="Change order description" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <input name="quantity" type="number" step="0.01" defaultValue="1" placeholder="Qty" aria-label="Change order quantity" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <input name="unitPrice" type="number" step="0.01" required placeholder="Unit price ($)" aria-label="Change order unit price" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Change Order</button>
                </form>

                <div className="mt-3 space-y-2">
                    {job.changeOrders.map((changeOrder) => (
                        <article key={changeOrder.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                            <p className="font-semibold">Change Order - {changeOrder.status}</p>
                            <p>{changeOrder.description}</p>
                            <p>Total: {currency(toNumber(changeOrder.total))}</p>
                            {changeOrder.status !== "APPROVED" ? (
                                <form action={approveChangeOrderAction} className="mt-2">
                                    <input type="hidden" name="changeOrderId" value={changeOrder.id} />
                                    <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs" type="submit">Approve</button>
                                </form>
                            ) : null}
                        </article>
                    ))}
                </div>

                <div className="mt-3 space-y-2">
                    {job.invoices.map((invoice) => (
                        <article key={invoice.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                            <p className="font-semibold">Invoice - {invoice.status}</p>
                            <p>Total: {currency(toNumber(invoice.total))}</p>
                            <p className="text-xs text-slate-500">
                                {invoice.sentAt ? `Sent ${format(invoice.sentAt, "MMM d, yyyy")}` : "Not sent yet"}
                                {invoice.dueDate ? ` - Due ${format(invoice.dueDate, "MMM d, yyyy")}` : ""}
                            </p>
                            <a className="mt-1 inline-block text-xs text-teal-700 underline" href={`/api/pdf/invoice/${invoice.id}`}>Download PDF</a>
                            <form action={sendInvoiceAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                                <input type="hidden" name="invoiceId" value={invoice.id} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input
                                    name="dueDate"
                                    type="date"
                                    defaultValue={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""}
                                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                />
                                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                                    {invoice.status === "DRAFT" ? "Send Invoice" : "Update Sent Date"}
                                </button>
                            </form>
                            <form action={addPaymentAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                                <input type="hidden" name="invoiceId" value={invoice.id} />
                                <input name="amount" type="number" step="0.01" placeholder="Amount" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                                <input name="date" type="date" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                                <input name="method" placeholder="cash/check/card" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Add payment</button>
                            </form>
                        </article>
                    ))}
                </div>
            </section>

            <section id="closeout" className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Closeout &amp; Status</h3>
                <p className="mt-1 text-xs text-slate-500">Update job status or close out the job. Confirm checklist items before marking as completed.</p>
                <form action={updateJobStatusAction} className="mt-3 space-y-2 text-sm">
                    <input type="hidden" name="jobId" value={job.id} />
                    <select name="status" defaultValue={job.status} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                        <option value="LEAD">Lead</option>
                        <option value="ESTIMATE">Estimate</option>
                        <option value="SCHEDULED">Scheduled</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="ON_HOLD">On Hold</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="PAID">Paid</option>
                    </select>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                        <p className="text-xs font-medium text-slate-600">Closeout checklist</p>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" name="confirmFinalPhotos" /> Final photos captured
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" name="confirmPunchList" /> Punch list complete
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" name="confirmReceipts" /> Receipts logged
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" name="confirmInvoiceSent" /> Invoice sent
                        </label>
                    </div>
                    <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Update Status</button>
                </form>
                {job.status !== "COMPLETED" && job.status !== "PAID" ? (
                    <form action={updateJobStatusAction} className="mt-3">
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="status" value="COMPLETED" />
                        <button
                            type="submit"
                            className="w-full rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                        >
                            Archive Job
                        </button>
                        <p className="mt-1 text-[11px] text-slate-400 text-center">
                            Removes from active board. All data (invoices, costs, hours) is kept for reports.
                        </p>
                    </form>
                ) : (
                    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 text-center">
                        ✓ This job is archived ({job.status.replace("_", " ").toLowerCase()})
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <details>
                    <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">Activity Feed</summary>
                    <div className="mt-3 space-y-2 text-sm">
                        {job.activityLogs.map((log) => (
                            <article key={log.id} className="rounded-xl border border-slate-200 p-2">
                                <p className="font-medium">{log.action}</p>
                                <p className="text-xs text-slate-500">{log.actor?.fullName ?? "System"} - {format(log.createdAt, "MMM d, h:mm a")}</p>
                            </article>
                        ))}
                    </div>
                </details>
            </section>
        </>
    );
}
