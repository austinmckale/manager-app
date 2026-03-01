import { format } from "date-fns";
import {
    createExpenseAction,
} from "@/app/(app)/actions";
import { CostHealth } from "@/components/cost-health";
import { FileCapture } from "@/components/file-capture";
import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { getJobById } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { currency, getStoragePublicUrl, toNumber } from "@/lib/utils";

export default async function CostsPage({
    params,
}: {
    params: Promise<{ jobId: string }>;
}) {
    const auth = await requireAuth();
    const { jobId } = await params;

    const [job, orgVendorRows] = await Promise.all([
        getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId }),
        isDemoMode()
            ? Promise.resolve([] as Array<{ vendor: string }>)
            : prisma.expense.findMany({
                where: { job: { orgId: auth.orgId } },
                select: { vendor: true },
                distinct: ["vendor"],
                orderBy: { vendor: "asc" },
                take: 200,
            }),
    ]);

    const costing = computeJobCosting(job);
    const expenseRows = [...job.expenses].sort((a, b) => b.date.getTime() - a.date.getTime());
    const receiptProviderNames = Array.from(
        new Set(
            expenseRows
                .filter((expense) => expense.receipt)
                .map((expense) => expense.vendor.trim())
                .filter(Boolean),
        ),
    ).sort((a, b) => a.localeCompare(b));
    const vendorSuggestions = Array.from(
        new Set(
            [...orgVendorRows.map((row) => row.vendor), ...expenseRows.map((expense) => expense.vendor)]
                .map((value) => value.trim())
                .filter(Boolean),
        ),
    ).sort((a, b) => a.localeCompare(b));
    const vendorDatalistId = `expense-vendors-${job.id}`;
    const expenseCategoryRows = [
        { key: "MATERIALS", label: "Materials", value: costing.expensesByCategory.MATERIALS },
        { key: "SUBCONTRACTOR", label: "Subcontractor", value: costing.expensesByCategory.SUBCONTRACTOR },
        { key: "PERMIT", label: "Permit", value: costing.expensesByCategory.PERMIT },
        { key: "EQUIPMENT", label: "Equipment", value: costing.expensesByCategory.EQUIPMENT },
        { key: "MISC", label: "Misc", value: costing.expensesByCategory.MISC },
    ];

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Costs</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
                    <p className="font-medium">Labor Snapshot</p>
                    <p>Hours: {costing.laborHours.toFixed(2)}</p>
                    <p>Labor Cost: {currency(costing.laborCost)}</p>
                    {job.timeEntries.map((entry) => (
                        <p key={entry.id} className="text-xs text-slate-500">
                            {entry.worker.fullName}: {format(entry.start, "MMM d, h:mm a")} to {entry.end ? format(entry.end, "h:mm a") : "... running"}
                        </p>
                    ))}
                </div>
                <div className="space-y-2">
                    <form action={createExpenseAction} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                        <input type="hidden" name="jobId" value={job.id} />
                        <input
                            name="vendor"
                            required
                            placeholder="Vendor (e.g. Home Depot)"
                            list={vendorSuggestions.length > 0 ? vendorDatalistId : undefined}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                        {vendorSuggestions.length > 0 ? (
                            <datalist id={vendorDatalistId}>
                                {vendorSuggestions.map((vendor) => (
                                    <option key={vendor} value={vendor} />
                                ))}
                            </datalist>
                        ) : null}
                        <input name="amount" required type="number" step="0.01" placeholder="Amount" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <select name="category" defaultValue="MISC" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                            <option value="MATERIALS">Materials</option>
                            <option value="SUBCONTRACTOR">Subcontractor</option>
                            <option value="PERMIT">Permit</option>
                            <option value="EQUIPMENT">Equipment</option>
                            <option value="MISC">Misc</option>
                        </select>
                        <input name="date" type="date" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <input name="notes" placeholder="Description (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add Expense</button>
                    </form>

                    <details className="rounded-xl border border-slate-200 p-2">
                        <summary className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-center text-xs font-medium text-slate-700">
                            Add receipt
                        </summary>
                        <div className="mt-2">
                            <FileCapture jobId={job.id} fileType="RECEIPT" vendorSuggestions={vendorSuggestions} />
                        </div>
                    </details>

                    <div className="rounded-xl border border-slate-200 p-3 text-xs">
                        <p className="font-medium text-slate-900">Expense Summary (This Job)</p>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-slate-700">
                            {expenseCategoryRows.map((row) => (
                                <p key={row.key}>{row.label}: {currency(row.value)}</p>
                            ))}
                        </div>
                        <p className="mt-2 border-t border-slate-200 pt-2 font-medium text-slate-900">
                            Total Expenses: {currency(costing.expensesTotal)}
                        </p>
                    </div>
                </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <CostHealth label="Labor vs Budget" value={costing.costHealth.labor} />
                <CostHealth label="Materials vs Budget" value={costing.costHealth.materials} />
                <CostHealth label="Total vs Budget" value={costing.costHealth.total} />
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-900">Receipt providers</p>
                {receiptProviderNames.length > 0 ? (
                    <div className="mt-1 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
                        {receiptProviderNames.map((provider) => (
                            <p key={provider}>{provider}</p>
                        ))}
                    </div>
                ) : (
                    <p className="mt-1 text-xs text-slate-500">No receipt providers yet.</p>
                )}
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-900">Expense Ledger</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Each row shows source (receipt or manual). Click to open receipt when available.</p>
                <div className="mt-2 space-y-2">
                    {expenseRows.map((expense) => (
                        <article
                            key={expense.id}
                            className={`rounded-lg border p-2 text-xs ${expense.receipt ? "cursor-pointer border-teal-200 bg-teal-50/30 hover:bg-teal-50/60" : "border-slate-200 bg-slate-50/30"}`}
                        >
                            {expense.receipt ? (
                                <a href={getStoragePublicUrl(expense.receipt.storageKey)} target="_blank" rel="noreferrer" className="block">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-medium text-slate-900">{expense.vendor}</p>
                                            <p className="text-slate-500">{expense.category} - {format(expense.date, "MMM d, yyyy")}</p>
                                        </div>
                                        <p className="font-semibold text-slate-900">{currency(toNumber(expense.amount))}</p>
                                    </div>
                                    {expense.notes ? <p className="mt-1 text-slate-600">{expense.notes}</p> : null}
                                    <p className="mt-1.5 font-medium text-teal-700">View receipt</p>
                                </a>
                            ) : (
                                <>
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-medium text-slate-900">{expense.vendor}</p>
                                            <p className="text-slate-500">{expense.category} - {format(expense.date, "MMM d, yyyy")}</p>
                                        </div>
                                        <p className="font-semibold text-slate-900">{currency(toNumber(expense.amount))}</p>
                                    </div>
                                    {expense.notes ? <p className="mt-1 text-slate-600">{expense.notes}</p> : null}
                                    <p className="mt-1.5 text-slate-500">Source: Manual entry (no receipt attached)</p>
                                </>
                            )}
                        </article>
                    ))}
                    {expenseRows.length === 0 ? <p className="text-xs text-slate-500">No expenses logged for this job yet.</p> : null}
                </div>
            </div>
        </section>
    );
}
