import {
  createTargetAction,
  createWorkerAction,
  sendDiscordScheduleDigestNowAction,
  sendDiscordEodDigestNowAction,
  updateOrgSettingsAction,
} from "@/app/(app)/actions";
import { format } from "date-fns";
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
    <div className="flex flex-col gap-4">
      {manage ? (
        <details className="order-last rounded-2xl border border-slate-200 bg-white p-4" id="workers">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Crew tools (add a worker)</summary>
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
        </details>
      ) : null}

      {/* Worker list/edit lives on Attendance (Team). Keep this page focused on setup + rules. */}

      {manage ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Phone reminders</h2>
          <p className="mt-1 text-xs text-slate-500">Morning and evening messages to your phone through Discord.</p>
          <form action={updateOrgSettingsAction} className="mt-3 grid gap-3 text-sm">
            {/* Kept for the crew tools; not shown to a solo owner. */}
            <input type="hidden" name="defaultClockInTime" value={settings?.defaultClockInTime ?? "07:00"} />

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">

              <div className="space-y-4">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="discordEodDigestEnabled"
                    defaultChecked={settings?.discordEodDigestEnabled ?? false}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-slate-900">Evening wrap-up</span>
                    <p className="text-slate-500">A reminder to log today&apos;s receipts and photos.</p>
                  </div>
                </label>

                <div className="ml-5 grid gap-1 sm:max-w-xs">
                  <label className="block text-xs text-slate-600">Time</label>
                  <input
                    type="time"
                    name="discordEodDigestTime"
                    defaultValue={settings?.discordEodDigestTime ?? "17:00"}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div className="h-px w-full bg-indigo-200/50" />

                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="discordScheduleDigestEnabled"
                    defaultChecked={settings?.discordScheduleDigestEnabled ?? false}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-slate-900">Morning rundown</span>
                    <p className="text-slate-500">Today&apos;s jobs, addresses and to-dos.</p>
                  </div>
                </label>

                <div className="ml-5 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="block text-xs text-slate-600">Time</label>
                    <input
                      type="time"
                      name="discordScheduleDigestTime"
                      defaultValue={settings?.discordScheduleDigestTime ?? "06:00"}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="block text-xs text-slate-600">Discord link (webhook)</label>
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
              Save
            </button>
          </form>
          <div className="flex flex-wrap gap-2 mt-2">
            {settings?.discordScheduleDigestEnabled && settings?.discordScheduleDigestWebhookUrl ? (
              <form action={sendDiscordScheduleDigestNowAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-100"
                >
                  Send morning rundown now
                </button>
              </form>
            ) : null}

            {settings?.discordEodDigestEnabled && settings?.discordScheduleDigestWebhookUrl ? (
              <form action={sendDiscordEodDigestNowAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-fuchsia-300 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-700 hover:bg-fuchsia-100"
                >
                  Send evening wrap-up now
                </button>
              </form>
            ) : null}

            {!settings?.discordScheduleDigestWebhookUrl || (!settings?.discordScheduleDigestEnabled && !settings?.discordEodDigestEnabled) ? (
              <p className="mt-2 text-[11px] text-slate-500">Turn one on and add the Discord link, then save to test it.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Profit targets</summary>
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
