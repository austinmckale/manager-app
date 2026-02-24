import { TaskStatus } from "@prisma/client";
import { addDays, format } from "date-fns";
import {
  addPaymentAction,
  approveChangeOrderAction,
  approveEstimateAction,
  convertEstimateToInvoiceAction,
  createChangeOrderAction,
  createEstimateAction,
  createExpenseAction,
  createTaskAction,
  quickScheduleCrewAction,
  updateJobStatusAction,
  updateTaskStatusAction,
} from "@/app/(app)/actions";
import { CostHealth } from "@/components/cost-health";
import { FileCapture } from "@/components/file-capture";
import { JobStatusBadge } from "@/components/job-status-badge";
import { requireAuth } from "@/lib/auth";
import { computeJobCosting } from "@/lib/costing";
import { getJobById, getOrgUsers } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { buildAbsoluteUrl, currency, getStoragePublicUrl, percent, toNumber } from "@/lib/utils";

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ shareToken?: string; portalToken?: string }>;
}) {
  const auth = await requireAuth();
  const { jobId } = await params;
  const query = await searchParams;

  const [job, users] = await Promise.all([
    getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId }),
    getOrgUsers(auth.orgId),
  ]);

  const costing = computeJobCosting(job);
  const assignedUserIds = new Set(job.assignments?.map((assignment) => assignment.userId) ?? []);
  const quickDates = Array.from({ length: 7 }, (_, index) => addDays(new Date(), index));
  const [shareLinks, portalLinks] = isDemoMode()
    ? [[], []]
    : await Promise.all([
        prisma.shareLink.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.portalLink.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "desc" }, take: 5 }),
      ]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Job Hub</p>
            <h2 className="text-xl font-semibold text-slate-900">{job.jobName}</h2>
            <p className="text-sm text-slate-600">{job.customer.name} • {job.address}</p>
          </div>
          <JobStatusBadge status={job.status} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <p>Revenue: {currency(costing.revenue)}</p>
          <p>Cost: {currency(costing.totalCost)}</p>
          <p>Profit: {currency(costing.grossProfit)}</p>
          <p>Margin: {percent(costing.grossMarginPercent)}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">0) Schedule + Crew</h3>
        <form action={quickScheduleCrewAction} className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <input type="hidden" name="jobId" value={job.id} />
          <div>
            <p className="font-medium">Crew (check all working this block)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {users.map((user) => (
                <label key={user.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input type="checkbox" name="workerIds" value={user.id} defaultChecked={assignedUserIds.has(user.id)} />
                  {user.fullName}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="font-medium">Dates (next 7 days)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {quickDates.map((dateValue) => (
                <label key={dateValue.toISOString()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <input type="checkbox" name="dates" value={format(dateValue, "yyyy-MM-dd")} />
                  {format(dateValue, "EEE M/d")}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="font-medium">Time Block</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="AM" />
                AM (8-12)
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="PM" />
                PM (1-5)
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1">
                <input type="radio" name="slot" value="FULL" defaultChecked />
                Full (8-5)
              </label>
            </div>
          </div>

          <input name="notes" placeholder="Block notes (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-slate-900 px-3 py-2 text-white">Save Crew + Schedule</button>
        </form>

        <div className="mt-3 space-y-2 text-sm">
          {job.scheduleEvents?.map((event) => (
            <article key={event.id} className="rounded-xl border border-slate-200 p-2">
              <p className="font-medium text-slate-900">{new Date(event.startAt).toLocaleString()} - {new Date(event.endAt).toLocaleString()}</p>
              {event.notes ? <p className="text-xs text-slate-500">{event.notes}</p> : null}
            </article>
          ))}
          {(job.scheduleEvents?.length ?? 0) === 0 ? <p className="text-xs text-slate-500">No schedule events yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">1) Tasks / Punch List</h3>
        <form action={createTaskAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={job.id} />
          <input name="title" required placeholder="Task / punch item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select name="assignedTo" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.fullName}</option>
            ))}
          </select>
          <input name="dueDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add Task</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.tasks.map((task) => (
            <article key={task.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{task.title}</p>
              <p className="text-xs text-slate-500">{task.assignee?.fullName ?? "Unassigned"} • Due {task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "-"}</p>
              <form action={updateTaskStatusAction} className="mt-2 flex gap-2">
                <input type="hidden" name="taskId" value={task.id} />
                <select name="status" defaultValue={task.status} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  {Object.values(TaskStatus).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Update</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">2) Photo + Receipt Capture</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FileCapture jobId={job.id} fileType="PHOTO" />
          <div className="space-y-2">
            <p className="text-xs text-slate-600">Recent client-visible photos</p>
            <div className="grid grid-cols-3 gap-2">
              {job.fileAssets.slice(0, 9).map((asset) => (
                <a key={asset.id} href={getStoragePublicUrl(asset.storageKey)} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getStoragePublicUrl(asset.storageKey)} alt={asset.description ?? "asset"} className="aspect-square w-full rounded-xl object-cover" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">3) Time + Expenses + Cost Health</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
            <p className="font-medium">Labor Snapshot</p>
            <p>Hours: {costing.laborHours.toFixed(2)}</p>
            <p>Labor Cost: {currency(costing.laborCost)}</p>
            {job.timeEntries.map((entry) => (
              <p key={entry.id} className="text-xs text-slate-500">
                {entry.worker.fullName}: {entry.start.toLocaleString()} {entry.end ? `- ${entry.end.toLocaleString()}` : "(running)"}
              </p>
            ))}
          </div>
          <form action={createExpenseAction} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <input name="vendor" required placeholder="Vendor (required)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="amount" required type="number" step="0.01" placeholder="Amount (required)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="category" defaultValue="MISC" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="MATERIALS">Materials</option>
              <option value="SUBCONTRACTOR">Subcontractor</option>
              <option value="PERMIT">Permit</option>
              <option value="EQUIPMENT">Equipment</option>
              <option value="MISC">Misc</option>
            </select>
            <input name="date" type="date" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Add Expense</button>
          </form>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <CostHealth label="Labor vs Budget" value={costing.costHealth.labor} />
          <CostHealth label="Materials vs Budget" value={costing.costHealth.materials} />
          <CostHealth label="Total vs Budget" value={costing.costHealth.total} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">4) Estimates / Change Orders / Invoices</h3>

        <form action={createEstimateAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={job.id} />
          <input name="description" required placeholder="Estimate line item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input name="quantity" type="number" step="0.01" required defaultValue="1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="unitPrice" type="number" step="0.01" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Estimate</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.estimates.map((estimate) => (
            <article key={estimate.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Estimate {estimate.version} • {estimate.status}</p>
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
          <input name="quantity" type="number" step="0.01" defaultValue="1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="unitPrice" type="number" step="0.01" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Create Change Order</button>
        </form>

        <div className="mt-3 space-y-2">
          {job.changeOrders.map((changeOrder) => (
            <article key={changeOrder.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Change Order • {changeOrder.status}</p>
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
              <p className="font-semibold">Invoice • {invoice.status}</p>
              <p>Total: {currency(toNumber(invoice.total))}</p>
              <a className="mt-1 inline-block text-xs text-teal-700 underline" href={`/api/pdf/invoice/${invoice.id}`}>Download PDF</a>
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">5) Client Visibility / Share Links</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <form action="/api/share/create" method="get" className="rounded-xl border border-slate-200 p-3 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="type" value="TIMELINE" />
            <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-white" type="submit">Generate timeline link</button>
          </form>
          <form action="/api/portal/create" method="get" className="rounded-xl border border-slate-200 p-3 text-sm">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="customerId" value={job.customerId} />
            <button className="rounded-lg bg-teal-600 px-3 py-1.5 text-white" type="submit">Generate client portal link</button>
          </form>
        </div>

        {query.shareToken ? (
          <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Share: {buildAbsoluteUrl(`/share/${query.shareToken}`)}</p>
        ) : null}
        {query.portalToken ? (
          <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Portal: {buildAbsoluteUrl(`/portal/${query.portalToken}`)}</p>
        ) : null}

        <div className="mt-2 text-xs text-slate-600">
          {shareLinks.map((link) => (
            <p key={link.id}>Share ({link.type}): {buildAbsoluteUrl(`/share/${link.token}`)}</p>
          ))}
          {portalLinks.map((link) => (
            <p key={link.id}>Portal: {buildAbsoluteUrl(`/portal/${link.token}`)}</p>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Closeout Checklist</h3>
        <p className="mt-1 text-xs text-slate-500">To move a job to completed, confirm closeout items first.</p>
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
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Update Status</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Activity Feed</h3>
        <div className="mt-3 space-y-2 text-sm">
          {job.activityLogs.map((log) => (
            <article key={log.id} className="rounded-xl border border-slate-200 p-2">
              <p className="font-medium">{log.action}</p>
              <p className="text-xs text-slate-500">{log.actor?.fullName ?? "System"} • {log.createdAt.toLocaleString()}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

