import {
  createTargetAction,
  createWorkerAction,
  setWorkerActiveAction,
  updateOrgSettingsAction,
  updateWorkerAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getOrgUsers } from "@/lib/data";
import { isDemoMode } from "@/lib/demo";
import { KPI_KEYS, ensureDefaultKpis } from "@/lib/kpis";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";

const kpiOptions = [
  { key: KPI_KEYS.laborPercentRevenue, name: "Labor % of revenue" },
  { key: KPI_KEYS.materialsPercentRevenue, name: "Materials % of revenue" },
  { key: KPI_KEYS.leadToWinRate, name: "Lead-to-win rate" },
];

export default async function TargetSettingsPage() {
  const auth = await requireAuth();
  await ensureDefaultKpis();

  const [targets, settings, workers] = isDemoMode()
    ? [[], null, await getOrgUsers(auth.orgId)]
    : await Promise.all([
        prisma.kpiTarget.findMany({ where: { orgId: auth.orgId }, orderBy: { effectiveDate: "desc" } }),
        prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
        getOrgUsers(auth.orgId),
      ]);

  const manage = canManageOrg(auth.role);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Team Setup</h2>
        <p className="mt-1 text-sm text-teal-800">Add workers here first. Time tracking, payroll cost, assignments, and job accountability depend on this list.</p>
      </section>

      {manage ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4" id="workers">
          <h2 className="text-sm font-semibold text-slate-900">Add Worker</h2>
          <form action={createWorkerAction} className="mt-3 grid gap-2 sm:grid-cols-2" id="add-worker-form">
            <input name="fullName" required placeholder="Full name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="email" type="email" required placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="phone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="role" defaultValue="WORKER" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="WORKER">Worker</option>
              <option value="ADMIN">Admin</option>
            </select>
            <input name="hourlyRateDefault" type="number" step="0.01" placeholder="Hourly rate" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
              + Add Worker
            </button>
          </form>
        </section>
      ) : null}

      {manage ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Current Workers</h2>
          <div className="mt-3 space-y-2 text-sm">
            {workers.map((worker) => (
              <article key={worker.id} className="rounded-xl border border-slate-200 p-2">
                <form action={updateWorkerAction} className="grid gap-2 sm:grid-cols-5">
                  <input type="hidden" name="workerId" value={worker.id} />
                  <input name="fullName" defaultValue={worker.fullName} className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-2" />
                  <input name="phone" defaultValue={worker.phone ?? ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                  <select name="role" defaultValue={worker.role} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    <option value="WORKER">Worker</option>
                    <option value="ADMIN">Admin</option>
                    <option value="OWNER">Owner</option>
                  </select>
                  <input name="hourlyRateDefault" type="number" step="0.01" defaultValue={toNumber(worker.hourlyRateDefault) || ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                  <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-2">Save</button>
                </form>

                <form action={setWorkerActiveAction} className="mt-2">
                  <input type="hidden" name="workerId" value={worker.id} />
                  <input type="hidden" name="isActive" value={worker.isActive ? "false" : "true"} />
                  <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    {worker.isActive ? "Deactivate" : "Activate"}
                  </button>
                </form>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {manage ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Time Tracking Rules</h2>
          <form action={updateOrgSettingsAction} className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="workerCanEditOwnTimeSameDay"
                defaultChecked={settings?.workerCanEditOwnTimeSameDay ?? true}
              />
              Workers can edit own same-day entries
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="gpsTimeTrackingEnabled" defaultChecked={settings?.gpsTimeTrackingEnabled ?? false} />
              Enable optional GPS start/stop
            </label>
            <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2">
              Save Rules
            </button>
          </form>
        </section>
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced: KPI Targets (Optional)</summary>
        {manage ? (
          <form action={createTargetAction} className="mt-3 grid gap-2 sm:grid-cols-4">
            <select name="kpiKey" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2">
              {kpiOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.name}
                </option>
              ))}
            </select>
            <input name="targetValue" type="number" step="0.01" required placeholder="Target" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="period" defaultValue="MONTHLY" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
            <input name="effectiveDate" type="date" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-3" />
            <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
              Save Target
            </button>
          </form>
        ) : null}

        <div className="mt-3 space-y-2 text-sm">
          {targets.map((target) => (
            <article key={target.id} className="rounded-xl border border-slate-200 p-2">
              <p className="font-medium text-slate-900">{target.kpiKey}</p>
              <p className="text-xs text-slate-500">
                {toNumber(target.targetValue)} ({target.period}) effective {target.effectiveDate.toISOString().slice(0, 10)}
              </p>
            </article>
          ))}
          {targets.length === 0 ? <p className="text-slate-500">No targets yet.</p> : null}
        </div>
      </details>
    </div>
  );
}
