import {
  createTargetAction,
  createWorkerAction,
  sendDiscordScheduleDigestNowAction,
  updateOrgSettingsAction,
} from "@/app/(app)/actions";
import { format } from "date-fns";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
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

  const [targets, settings] = isDemoMode()
    ? [[], null]
    : await Promise.all([
      prisma.kpiTarget.findMany({ where: { orgId: auth.orgId }, orderBy: { effectiveDate: "desc" } }),
      prisma.organizationSetting.findUnique({ where: { orgId: auth.orgId } }),
    ]);

  const manage = canManageOrg(auth.role);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Team Setup</h2>
        <p className="mt-1 text-sm text-teal-800">Add workers here first. Time tracking, payroll cost, assignments, and job accountability depend on this list.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Where Margin + Cost Tracking Lives</h2>
        <p className="mt-1 text-xs text-slate-500">Financial tracking was not removed — use these pages:</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Link href="/jobs" className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
            Jobs: per-job margin, labor, materials, receipts
          </Link>
          <Link href="/reports" className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
            Reports: export time, expenses, profitability CSV
          </Link>
          <Link href="/accounting" className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
            Accounting: unpaid invoices, labor/material snapshots
          </Link>
        </div>
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

      {/* Worker list/edit lives on Attendance (Team). Keep this page focused on setup + rules. */}

      {manage ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Time Tracking & Alerts</h2>
          <p className="mt-1 text-xs text-slate-500">Controls attendance rules and optional Discord clock-in alerts.</p>
          <form action={updateOrgSettingsAction} className="mt-3 grid gap-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-2">
              <label className="block text-xs text-slate-600">Default clock-in time</label>
              <input
                type="time"
                name="defaultClockInTime"
                defaultValue={settings?.defaultClockInTime ?? "07:00"}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              <label className="block text-xs text-slate-600">Grace minutes (before marked late)</label>
              <input
                type="number"
                min={0}
                name="clockGraceMinutes"
                defaultValue={settings?.clockGraceMinutes ?? 10}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 mt-2">
              <h3 className="text-sm font-semibold text-indigo-900">Discord Integrations</h3>
              <p className="mt-1 text-xs text-indigo-700">Connect your workspace to Discord for automated team updates.</p>

              <div className="mt-4 space-y-4">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="discordClockInAlertsEnabled"
                    defaultChecked={settings?.gpsTimeTrackingEnabled ?? false}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-slate-900">Live Clock-in Alerts</span>
                    <p className="text-slate-500">Post a message when crew members clock in or out.</p>
                  </div>
                </label>

                <div className="h-px w-full bg-indigo-200/50" />

                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="discordScheduleDigestEnabled"
                    defaultChecked={settings?.discordScheduleDigestEnabled ?? false}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-slate-900">Daily Morning Digest</span>
                    <p className="text-slate-500">Send a daily brief with crew assignments, locations, and tasks.</p>
                  </div>
                </label>

                <div className="ml-5 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="block text-xs text-slate-600">Digest time</label>
                    <input
                      type="time"
                      name="discordScheduleDigestTime"
                      defaultValue={settings?.discordScheduleDigestTime ?? "06:00"}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="block text-xs text-slate-600">Discord Webhook URL</label>
                    <input
                      type="url"
                      name="discordScheduleDigestWebhookUrl"
                      placeholder="https://discord.com/api/webhooks/..."
                      defaultValue={settings?.discordScheduleDigestWebhookUrl ?? ""}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2">
              Save Rules
            </button>
          </form>
          {settings?.discordScheduleDigestEnabled && settings?.discordScheduleDigestWebhookUrl ? (
            <form action={sendDiscordScheduleDigestNowAction} className="mt-2">
              <button
                type="submit"
                className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-100"
              >
                Send Discord schedule digest now
              </button>
            </form>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">Enable digest + add webhook URL, then save rules to unlock &quot;Send now&quot;.</p>
          )}
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
                {toNumber(target.targetValue)} ({target.period}) effective {format(target.effectiveDate, "MMM d, yyyy")}
              </p>
            </article>
          ))}
          {targets.length === 0 ? <p className="text-slate-500">No targets yet.</p> : null}
        </div>
      </details>
    </div>
  );
}
