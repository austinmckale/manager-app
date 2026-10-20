/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { exampleDraft } from "@/lib/marketing-example";
import { canManageOrg } from "@/lib/permissions";
import type { BufferChannel } from "@/lib/publishing/buffer";
import type { BufferDelivery } from "@/lib/publishing/buffer-delivery";
import { buildSchedule, channelNotes, easternDay, easternTime, loadBufferSchedule, scheduleDays, scheduleSummary, whenLabel, type ScheduleKind, type SchedulePost, type ScheduleRow, type ScheduleView } from "@/lib/publishing/buffer-schedule";

export const dynamic = "force-dynamic";

/** Demo mode has no database or Buffer key: example posts show how the page looks. */
function demoView(now: Date): ScheduleView {
  const [year, month, date] = easternDay(now).split("-").map(Number);
  // Eastern daylight time is four hours behind UTC; close enough for examples.
  const at = (days: number, hour: number, minute = 0) => new Date(Date.UTC(year, month - 1, date + days, hour + 4, minute)).toISOString();
  const facebook: BufferChannel = { id: "demo-facebook", name: "RHI Pros", displayName: "RHI Pros", service: "facebook", isQueuePaused: false, isDisconnected: false, isLocked: false, organization: "RHI Pros", organizationId: "demo" };
  const google: BufferChannel = { ...facebook, id: "demo-google", service: "googlebusiness" };
  const photo = (name: string) => [{ id: null, mimeType: "image/jpeg", thumbnail: `/demo/${name}.jpg` }];
  const post = (id: string, channelId: string, status: string, text: string, times: Partial<Pick<SchedulePost, "dueAt" | "sentAt">>, extra: Partial<SchedulePost> = {}): SchedulePost =>
    ({ id, channelId, status, text, dueAt: times.dueAt ?? null, sentAt: times.sentAt ?? null, externalLink: null, createdAt: at(-7, 8), assets: [], error: null, ...extra });
  const posts = [
    post("demo-1", facebook.id, "scheduled", exampleDraft.social, { dueAt: at(1, 9) }, { assets: photo("pavilion-front") }),
    post("demo-2", google.id, "scheduled", exampleDraft.googleBusiness, { dueAt: at(1, 9) }, { assets: photo("pavilion-front") }),
    post("demo-3", facebook.id, "scheduled", "Example: a post written in Buffer itself. The app did not send it.", { dueAt: at(3, 12, 30) }),
    post("demo-4", facebook.id, "draft", "Example: a private draft the app sent. It waits in Buffer until you pick a time there.", {}, { assets: photo("pavilion-ceiling"), createdAt: at(0, 7) }),
    post("demo-5", facebook.id, "sent", "Example: an earlier version of another job, already sent.", { dueAt: at(-2, 9), sentAt: at(-2, 9, 2) }, { assets: photo("pavilion-ceiling"), externalLink: "https://www.facebook.com/" }),
    post("demo-6", facebook.id, "scheduled", "Example: a newer version of that job, scheduled again. It is flagged as a possible double post.", { dueAt: at(5, 9) }, { assets: photo("pavilion-ceiling") }),
    post("demo-7", google.id, "error", "Example: a Google Business update that failed in Buffer.", { dueAt: at(-1, 10) }, { error: { message: "The Google Business Profile connection needs to be refreshed in Buffer." } }),
    post("demo-8", google.id, "sent", "Example: a Google Business update the app sent last week.", { dueAt: at(-6, 9), sentAt: at(-6, 9) }, { assets: photo("pavilion-front"), externalLink: "https://www.google.com/maps" }),
  ];
  const sent = (postId: string, draftId: string, channel: BufferChannel, status: BufferDelivery["status"], daysAgo: number): { createdAt: Date; metadata: BufferDelivery } =>
    ({ createdAt: new Date(at(-daysAgo, 8)), metadata: { id: `delivery-${postId}`, draftId, inputHash: "0".repeat(64), channelId: channel.id, channelName: channel.displayName || channel.name, service: channel.service, mode: "draft", assetIds: [], status, postId, dueAt: null, sentAt: null, externalLink: null, message: "", checkedAt: at(-daysAgo, 8) } });
  const deliveries = [sent("demo-1", "demo-a", facebook, "queued", 0), sent("demo-2", "demo-a", google, "queued", 0), sent("demo-4", "demo-c", facebook, "draft", 0), sent("demo-6", "demo-b3", facebook, "queued", 1), sent("demo-5", "demo-b1", facebook, "published", 3), sent("demo-8", "demo-d", google, "published", 7)];
  const superseded = [{ metadata: { draftId: "demo-b1", replacementDraftId: "demo-b2" } }, { metadata: { draftId: "demo-b2", replacementDraftId: "demo-b3" } }];
  const live = [facebook, google].map(({ id, isQueuePaused, isDisconnected, isLocked }) => ({ id, isQueuePaused, isDisconnected, isLocked }));
  return { problem: null, rows: buildSchedule({ posts, channels: [facebook, google], deliveries, superseded, now }), notes: channelNotes([facebook, google], live), more: false, skipped: 0, updated: 0 };
}

const TONES: Record<ScheduleKind, string> = {
  scheduled: "bg-teal-50 text-teal-900", late: "bg-amber-50 text-amber-900", approval: "bg-amber-50 text-amber-900", sending: "bg-teal-50 text-teal-900",
  draft: "border border-slate-300 bg-white text-slate-800", sent: "bg-slate-100 text-slate-800", failed: "bg-red-50 text-red-900", other: "bg-slate-100 text-slate-800",
};
const button = "inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900";

const PROBLEMS: Record<NonNullable<ScheduleView["problem"]>, string> = {
  key: "The Buffer key is not set on this deployment, so the schedule cannot be read.",
  channels: "No Buffer channels are saved yet, so there is nothing to read.",
  read: "Buffer could not be read just now. Try again in a few minutes. If it keeps failing, check the connection on the Buffer page.",
};

function Row({ row, demo }: { row: ScheduleRow; demo: boolean }) {
  return <li className={`flex gap-3 rounded-2xl border bg-white p-3 ${row.flags.length ? "border-amber-300" : "border-slate-200"}`}>
    {row.thumbnail ? <img src={row.thumbnail} alt={`Photo in this ${row.channelName} post`} className="h-16 w-16 flex-none rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <div aria-hidden="true" className="h-16 w-16 flex-none rounded-lg bg-slate-100" />}
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-slate-900">{row.at ? `${row.kind === "late" ? "Was due " : ""}${easternTime(row.at)}` : "No time set"}</span>
        <span className="text-slate-700">{row.channelName}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[row.kind]}`}>{row.label}</span>
      </div>
      <p className="line-clamp-4 break-words text-sm text-slate-900">{row.text || "No text."}</p>
      {row.failure ? <p className="text-sm text-red-800">Buffer says: {row.failure}</p> : null}
      {row.flags.map((flag) => <p key={flag} className="rounded-lg bg-amber-50 px-2 py-1 text-sm text-amber-900"><strong>Possible double post.</strong> {flag}</p>)}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${row.fromApp ? "bg-teal-50 text-teal-900" : "bg-slate-100 text-slate-800"}`}>{row.fromApp ? (row.test ? "From the app: connection test" : "From the app") : "Added in Buffer"}</span>
        {row.draftId ? <Link href={`/marketing/review/${demo ? "example" : row.draftId}`} className="font-semibold text-teal-900 underline">Open in the app</Link> : null}
        {row.link ? <a href={row.link} target="_blank" rel="noreferrer" className="font-semibold text-teal-900 underline">See the post</a> : null}
      </div>
    </div>
  </li>;
}

export default async function SchedulePage() {
  const auth = await requireAuth();
  const demo = isDemoMode();
  if (!canManageOrg(auth.role) || (!demo && !isDashboardOwnerEmail(auth.email))) return <p>The schedule is for the owner.</p>;
  const now = new Date();
  let view: ScheduleView;
  if (demo) view = demoView(now);
  else {
    const [{ savedBufferChannels }, { prisma }] = await Promise.all([import("@/lib/publishing/buffer-store"), import("@/lib/prisma")]);
    view = await loadBufferSchedule(prisma, auth.orgId, await savedBufferChannels(auth.orgId));
  }
  const { undated, days } = scheduleDays(view.rows, now);
  const summary = scheduleSummary(view.rows, now);
  const list = (rows: ScheduleRow[]) => <ul className="space-y-2">{rows.map((row) => <Row key={row.postId} row={row} demo={demo} />)}</ul>;
  return <div className="space-y-5">
    <div>
      <p className="text-xs uppercase tracking-widest text-teal-700">What is in Buffer</p>
      <h2 className="mt-2 text-2xl font-semibold">Schedule</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">Your posts in Buffer for the channels saved on the Buffer page: scheduled, drafts, sent in the last 30 days, and failed. Read from Buffer each time you open this page. Times are Eastern. This page never changes Buffer; change a post&apos;s time, text or photos in Buffer.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/marketing/schedule" className={button}>Check Buffer again</a>
        <a href="https://publish.buffer.com" target="_blank" rel="noreferrer" className={button}>Open Buffer</a>
      </div>
    </div>
    {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Example only. The preview does not read Buffer.</p> : null}
    {view.problem ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{PROBLEMS[view.problem]} <Link href="/marketing/buffer" className="font-semibold underline">Buffer page</Link></p> : <>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([[summary.scheduled, "Scheduled"], [summary.drafts, "Drafts"], [summary.sent, "Sent, last 30 days"], [summary.failed, "Failed"]] as const).map(([value, label]) => <div key={label} className="rounded-2xl border border-slate-200 p-3"><p className={`text-2xl font-semibold ${label === "Failed" && value ? "text-red-800" : "text-slate-900"}`}>{value}</p><p className="mt-1 text-xs text-slate-700">{label}</p></div>)}
      </section>
      <p className="text-sm text-slate-900">{summary.next?.at ? <>Next post: <strong>{whenLabel(summary.next.at, now)}</strong>, {summary.next.channelName}.</> : "Nothing is scheduled."}</p>
      {view.notes.map((note) => <p key={note} role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{note}</p>)}
      {summary.doubles ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{summary.doubles === 1 ? "1 post may be a double post. It is" : `${summary.doubles} posts may be double posts. They are`} marked below. If the same job would go out twice, delete the extra one in Buffer.</p> : null}
      {undated.length ? <section className="space-y-2">
        <h3 className="text-lg font-semibold">Drafts with no time ({undated.length})</h3>
        <p className="text-sm text-slate-600">A draft does not post. Pick a time for it in Buffer.</p>
        {list(undated)}
      </section> : null}
      {days.map((day) => <section key={day.key} className="space-y-2">
        <h3 className="text-lg font-semibold">{day.title} <span className="text-sm font-normal text-slate-600">{day.date}</span></h3>
        {list(day.rows)}
      </section>)}
      {!view.rows.length ? <p className="text-sm text-slate-600">Buffer has nothing scheduled, no drafts, and nothing sent in the last 30 days for your saved channels.</p> : null}
      {view.more ? <p className="text-sm text-slate-600">Buffer has more posts than this page shows. Open Buffer to see the rest.</p> : null}
      {view.skipped ? <p className="text-sm text-slate-600">{view.skipped} {view.skipped === 1 ? "post" : "posts"} from Buffer could not be shown here. Open Buffer to see {view.skipped === 1 ? "it" : "them"}.</p> : null}
      {view.updated ? <p className="text-xs text-slate-500">Brought {view.updated} of the app&apos;s {view.updated === 1 ? "send" : "sends"} up to date with Buffer, so Results and Pick posts match.</p> : null}
    </>}
  </div>;
}
