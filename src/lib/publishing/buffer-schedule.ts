import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { REVIEW_SUPERSEDED } from "@/lib/content-review";
import { bufferPostSchema, bufferQuery, postFields, type BufferChannel } from "@/lib/publishing/buffer";
import { BUFFER_DELIVERY, postPatch, type BufferDelivery } from "@/lib/publishing/buffer-delivery";
import { chainOf, lastDelivery, versionLinks } from "@/lib/post-picks";
import { PICK_RECENT_DAYS } from "@/lib/post-picks-rules";

/**
 * The Schedule page: what Buffer holds for the saved channels. It only reads Buffer: one request per
 * Buffer organization lists recent and upcoming posts, every draft and each channel's queue state,
 * and nothing here creates, queues, edits or publishes a post. Each post is matched to the app's own
 * delivery records, and a job that may go out twice is flagged. The database is passed in, so the
 * rules can be tested without one.
 */
export const SCHEDULE_DAYS = 30;
export const EASTERN = "America/New_York";
const DAY = 24 * 60 * 60 * 1000;
// Buffer's guide suggests 20 to 50 posts a page; four pages is far more than a month of RHI posts.
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
// A scheduled post still waiting this long after its time is shown as late.
const LATE_MS = 15 * 60 * 1000;

export const schedulePostSchema = bufferPostSchema.extend({
  createdAt: z.string().nullable().catch(null),
  assets: z.array(z.object({ id: z.string().nullable().catch(null), mimeType: z.string().catch(""), thumbnail: z.string().nullable().catch(null) })).catch([]),
  error: z.object({ message: z.string() }).nullable().catch(null),
});
export type SchedulePost = z.infer<typeof schedulePostSchema>;
const liveChannelSchema = z.object({ id: z.string(), isQueuePaused: z.boolean(), isDisconnected: z.boolean().default(false), isLocked: z.boolean().default(false) });
export type LiveChannel = z.infer<typeof liveChannelSchema>;
const pageSchema = z.object({ edges: z.array(z.object({ node: z.unknown() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) });

// `assets` is selected twice on purpose: GraphQL merges the two, so postFields stays as the send code uses it.
const scheduleFields = `${postFields} createdAt assets { thumbnail } error { message }`;
const pageFields = `edges { node { ${scheduleFields} } } pageInfo { hasNextPage endCursor }`;
const firstQuery = `query RhiSchedule($organizationId: OrganizationId!, $recent: PostsInput!, $drafts: PostsInput!, $first: Int!) { recent: posts(first: $first, input: $recent) { ${pageFields} } drafts: posts(first: $first, input: $drafts) { ${pageFields} } channels(input: { organizationId: $organizationId }) { id isQueuePaused isDisconnected isLocked } }`;
const moreQuery = `query RhiScheduleMore($input: PostsInput!, $first: Int!, $after: String!) { posts(first: $first, after: $after, input: $input) { ${pageFields} } }`;

export type ScheduleRead = { posts: SchedulePost[]; channels: LiveChannel[]; more: boolean; skipped: number };

/**
 * Reads the saved channels' posts from Buffer: everything created or due in the last 30 days (which
 * includes every upcoming post), plus every draft. Statuses are not filtered except `draft`, because
 * Buffer's docs do not list its other status names. `more` means Buffer had posts past the last page.
 */
export async function readBufferSchedule(channels: readonly BufferChannel[], key: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<ScheduleRead> {
  const posts = new Map<string, SchedulePost>();
  const live: LiveChannel[] = [];
  let more = false;
  let skipped = 0;
  const startDate = new Date(now.getTime() - SCHEDULE_DAYS * DAY).toISOString();
  const organizations = new Map<string, string[]>();
  for (const channel of channels) if (channel.organizationId) organizations.set(channel.organizationId, [...(organizations.get(channel.organizationId) ?? []), channel.id]);
  const keep = (page: z.infer<typeof pageSchema>, channelIds: readonly string[]) => {
    for (const edge of page.edges) {
      const post = schedulePostSchema.safeParse(edge.node);
      if (!post.success) skipped++;
      else if (channelIds.includes(post.data.channelId)) posts.set(post.data.id, post.data);
    }
  };
  for (const [organizationId, channelIds] of organizations) {
    const recent = { organizationId, filter: { channelIds, startDate }, sort: [{ field: "dueAt", direction: "desc" }, { field: "createdAt", direction: "desc" }] };
    const drafts = { organizationId, filter: { channelIds, status: ["draft"] }, sort: [{ field: "createdAt", direction: "desc" }] };
    const data = z.object({ recent: pageSchema, drafts: pageSchema, channels: z.array(liveChannelSchema) }).parse(await bufferQuery(firstQuery, { organizationId, recent, drafts, first: PAGE_SIZE }, key, fetcher));
    keep(data.recent, channelIds);
    keep(data.drafts, channelIds);
    live.push(...data.channels.filter((channel) => channelIds.includes(channel.id)));
    let page = data.recent.pageInfo;
    for (let count = 1; page.hasNextPage && page.endCursor && count < MAX_PAGES; count++) {
      const next = z.object({ posts: pageSchema }).parse(await bufferQuery(moreQuery, { input: recent, first: PAGE_SIZE, after: page.endCursor }, key, fetcher));
      keep(next.posts, channelIds);
      page = next.posts.pageInfo;
    }
    more ||= page.hasNextPage || data.drafts.pageInfo.hasNextPage;
  }
  return { posts: [...posts.values()], channels: live, more, skipped };
}

export type ScheduleKind = "scheduled" | "late" | "approval" | "sending" | "draft" | "sent" | "failed" | "other";
export type ScheduleRow = {
  postId: string; channelId: string; channelName: string; kind: ScheduleKind; label: string;
  /** The time the post is filed under: when it went out, or when it is due. Drafts with no time have none. */
  at: string | null; createdAt: string | null;
  text: string; thumbnail: string | null; link: string | null; failure: string | null;
  fromApp: boolean; draftId: string | null; test: boolean; flags: string[];
};
type DeliveryRow = { createdAt: Date; metadata: unknown };

const LABELS: Record<ScheduleKind, string> = {
  scheduled: "Scheduled", late: "Late, not sent yet", approval: "Waiting for approval in Buffer", sending: "Posting now",
  draft: "Draft, not scheduled", sent: "Sent", failed: "Failed", other: "Unknown status",
};
const GOING_OUT: ScheduleKind[] = ["scheduled", "late", "approval", "sending", "sent"];
const GOING_OUT_RECORDS: BufferDelivery["status"][] = ["queued", "sending", "published", "needs_approval"];
const SERVICES: Record<string, string> = { facebook: "Facebook", googlebusiness: "Google Business", instagram: "Instagram" };

/** Buffer's status in the page's words. Status names the docs do not list fall under "other". */
export function scheduleKind(post: Pick<SchedulePost, "status" | "dueAt">, now: Date): ScheduleKind {
  switch (post.status) {
    case "scheduled": case "buffer": return post.dueAt && Date.parse(post.dueAt) < now.getTime() - LATE_MS ? "late" : "scheduled";
    case "draft": return "draft";
    case "needs_approval": return "approval";
    case "sending": return "sending";
    case "sent": return "sent";
    case "error": return "failed";
    default: return "other";
  }
}

function validTime(value: string | null | undefined) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function rowTime(post: SchedulePost, kind: ScheduleKind) {
  if (kind === "sent") return validTime(post.sentAt) ?? validTime(post.dueAt) ?? validTime(post.createdAt);
  if (kind === "draft") return validTime(post.dueAt);
  return validTime(post.dueAt) ?? validTime(post.createdAt);
}

/** Only https images, or the demo photos the app ships, are shown. */
export function safeImage(url: string | null | undefined) {
  return url && (/^https:\/\//.test(url) || url.startsWith("/demo/")) ? url : null;
}

/** Buffer's failure message, without links: it can quote a private photo link. */
export function failureReason(message: string | null | undefined) {
  const words = (message ?? "").replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]").replace(/\s+/g, " ").trim();
  return words ? words.slice(0, 200) : null;
}

export function excerpt(text: string, max = 220) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function deliveryOf(row: { metadata: unknown }) {
  const record = row.metadata as Partial<BufferDelivery> | null;
  return record && typeof record.id === "string" && typeof record.channelId === "string" ? record as BufferDelivery : null;
}

/** "Facebook", or "Facebook (Page name)" when two saved channels are on the same service. */
export function channelLabel(channelId: string, channels: readonly BufferChannel[], fallback = "Buffer channel") {
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) return fallback;
  const service = SERVICES[channel.service] ?? channel.service;
  return channels.filter((item) => item.service === channel.service).length > 1 ? `${service} (${channel.displayName || channel.name})` : service;
}

const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, year: "numeric", month: "2-digit", day: "2-digit" });
/** The Eastern calendar day as YYYY-MM-DD. */
export function easternDay(at: string | Date) {
  const parts = Object.fromEntries(dayParts.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function easternTime(at: string | Date) {
  return new Date(at).toLocaleTimeString("en-US", { timeZone: EASTERN, hour: "numeric", minute: "2-digit" });
}
export function easternDate(at: string | Date) {
  return new Date(at).toLocaleDateString("en-US", { timeZone: EASTERN, month: "short", day: "numeric" });
}

function describeRow(row: ScheduleRow) {
  const when = row.at ? ` ${easternDate(row.at)}` : "";
  return row.kind === "sent" ? `sent${when}` : row.kind === "approval" ? "waiting for approval in Buffer" : row.kind === "sending" ? "posting now" : `scheduled${when ? ` for${when}` : ""}`;
}
function describeRecord(record: BufferDelivery) {
  if (record.status === "published") return record.sentAt ? `sent ${easternDate(record.sentAt)}` : "sent";
  if (record.status === "queued") return record.dueAt ? `scheduled for ${easternDate(record.dueAt)}` : "in the Buffer queue";
  return record.status === "sending" ? "posting now" : "waiting for approval in Buffer";
}

/**
 * Possible double posts. From the app: another post from the same job (any of its versions,
 * `chainOf`) going out on the same channel, or the job sent to Buffer within 90 days before this
 * post (`lastDelivery`; a failed send does not count). From anywhere: the same text twice on one
 * channel. Only posts that are scheduled, waiting, posting or sent are flagged; a draft posts nothing.
 */
function flagDoublePosts(rows: ScheduleRow[], texts: Map<string, string>, input: { deliveries: readonly DeliveryRow[]; superseded: readonly { metadata: unknown }[]; channels: readonly BufferChannel[]; now: Date }) {
  const links = versionLinks(input.superseded);
  const listed = new Map(rows.map((row) => [row.postId, row]));
  const sends = input.deliveries.flatMap((row) => { const record = deliveryOf(row); return record?.draftId && record.status !== "rejected" ? [{ createdAt: row.createdAt, record }] : []; });
  for (const row of rows) {
    const own = row.draftId && GOING_OUT.includes(row.kind) ? sends.find((send) => send.record.postId === row.postId) : undefined;
    if (!own || !row.draftId) continue;
    const versions = chainOf(row.draftId, links);
    for (const other of sends) {
      if (other === own || other.record.channelId !== row.channelId || !versions.includes(other.record.draftId!)) continue;
      const otherRow = other.record.postId ? listed.get(other.record.postId) : undefined;
      if (otherRow ? GOING_OUT.includes(otherRow.kind) : GOING_OUT_RECORDS.includes(other.record.status)) row.flags.push(`Another post from this job is on ${row.channelName} too (${otherRow ? describeRow(otherRow) : describeRecord(other.record)}).`);
    }
    if (row.flags.length) continue;
    const earlierRows = input.deliveries
      .filter((item) => item.createdAt.getTime() < own.createdAt.getTime() && deliveryOf(item)?.status !== "failed")
      .map((item) => { const record = deliveryOf(item); return { createdAt: item.createdAt, metadata: record ? { ...record, channelName: channelLabel(record.channelId, input.channels, record.channelName) } : item.metadata }; });
    const earlier = lastDelivery(versions.filter((id) => id !== row.draftId), earlierRows);
    const gap = (row.at ? Date.parse(row.at) : input.now.getTime()) - (earlier?.at.getTime() ?? 0);
    if (earlier && gap <= PICK_RECENT_DAYS * DAY) {
      const days = Math.max(0, Math.round(gap / DAY));
      row.flags.push(days ? `This job went to Buffer ${days} day${days === 1 ? "" : "s"} before this post (${earlier.channelName}, ${easternDate(earlier.at)}).` : `This job also went to Buffer the same day (${earlier.channelName}).`);
    }
  }
  const sameText = new Map<string, ScheduleRow[]>();
  for (const row of rows) {
    const text = texts.get(row.postId);
    if (!text || !GOING_OUT.includes(row.kind)) continue;
    const key = `${row.channelId}\n${text}`;
    sameText.set(key, [...(sameText.get(key) ?? []), row]);
  }
  for (const group of sameText.values()) {
    for (const row of group) {
      const other = group.find((item) => item !== row);
      if (other && !row.flags.length) row.flags.push(`Same text as another ${row.channelName} post (${describeRow(other)}).`);
    }
  }
}

/** One row per Buffer post, marked From the app (with its draft) or Added in Buffer, with any double-post flags. */
export function buildSchedule(input: { posts: readonly SchedulePost[]; channels: readonly BufferChannel[]; deliveries: readonly DeliveryRow[]; superseded: readonly { metadata: unknown }[]; now: Date }): ScheduleRow[] {
  const sent = new Map<string, BufferDelivery>();
  for (const row of input.deliveries) { const record = deliveryOf(row); if (record?.postId && !sent.has(record.postId)) sent.set(record.postId, record); }
  const texts = new Map<string, string>();
  const rows = input.posts.map((post): ScheduleRow => {
    const kind = scheduleKind(post, input.now);
    const record = sent.get(post.id);
    const fromApp = !!record && record.channelId === post.channelId;
    texts.set(post.id, post.text.replace(/\s+/g, " ").trim().toLowerCase());
    return {
      postId: post.id, channelId: post.channelId, channelName: channelLabel(post.channelId, input.channels), kind,
      label: kind === "other" ? `Buffer lists it as "${post.status}"` : LABELS[kind], at: rowTime(post, kind), createdAt: validTime(post.createdAt),
      text: excerpt(post.text), thumbnail: safeImage(post.assets.find((asset) => asset.thumbnail)?.thumbnail), link: post.externalLink && /^https:\/\//.test(post.externalLink) ? post.externalLink : null,
      failure: kind === "failed" ? failureReason(post.error?.message) : null, fromApp, draftId: fromApp ? record!.draftId : null, test: fromApp && !record!.draftId, flags: [],
    };
  });
  flagDoublePosts(rows, texts, input);
  return rows;
}

/** Buffer's newer status for the posts the app sent, as patches for their delivery records. */
export function deliveryPatches(posts: readonly SchedulePost[], deliveries: readonly { metadata: unknown }[]) {
  const listed = new Map(posts.map((post) => [post.id, post]));
  const patches: { id: string; patch: Partial<BufferDelivery> }[] = [];
  for (const row of deliveries) {
    const record = deliveryOf(row);
    const post = record?.postId ? listed.get(record.postId) : undefined;
    if (!record || !post || post.channelId !== record.channelId) continue;
    const patch = postPatch(post);
    // A status the app does not recognise never replaces one it does.
    if (patch.status === "unknown") continue;
    if (patch.status === record.status && patch.dueAt === record.dueAt && patch.sentAt === record.sentAt && patch.externalLink === record.externalLink) continue;
    patches.push({ id: record.id, patch });
  }
  return patches;
}

/** Plain warnings for saved channels Buffer cannot post to right now. */
export function channelNotes(saved: readonly BufferChannel[], live: readonly LiveChannel[]) {
  return saved.flatMap((channel) => {
    const name = channelLabel(channel.id, saved);
    const state = live.find((item) => item.id === channel.id);
    if (!state) return [`${name} was not found in Buffer. Check the connection on the Buffer page.`];
    if (state.isDisconnected) return [`${name} is disconnected in Buffer. Nothing posts there until you reconnect it in Buffer.`];
    if (state.isLocked) return [`${name} is locked in Buffer. Unlock it in Buffer before anything can post there.`];
    if (state.isQueuePaused) return [`${name}'s queue is paused in Buffer. Its scheduled posts wait until you resume the queue.`];
    return [];
  });
}

export type ScheduleDay = { key: string; title: string; date: string; rows: ScheduleRow[] };

export function dayTitle(key: string, now: Date) {
  const [year, month, day] = key.split("-").map(Number);
  const [thisYear, thisMonth, today] = easternDay(now).split("-").map(Number);
  const diff = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(thisYear, thisMonth - 1, today)) / DAY);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = noon.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
  const date = noon.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year === thisYear ? {} : { year: "numeric" }) });
  return Math.abs(diff) <= 1 ? { title: diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : "Yesterday", date: `${weekday}, ${date}` } : { title: weekday, date };
}

/** Rows grouped by Eastern day, latest first, so upcoming days lead. Drafts with no time are kept apart. */
export function scheduleDays(rows: readonly ScheduleRow[], now: Date) {
  const days: ScheduleDay[] = [];
  for (const row of rows.filter((item) => item.at).sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!))) {
    const key = easternDay(row.at!);
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, ...dayTitle(key, now), rows: [row] });
  }
  const undated = rows.filter((row) => !row.at).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { undated, days };
}

/** The counts at the top of the page and the next post due. */
export function scheduleSummary(rows: readonly ScheduleRow[], now: Date) {
  const upcoming = rows.filter((row) => ["scheduled", "sending"].includes(row.kind) && row.at && Date.parse(row.at) >= now.getTime() - LATE_MS).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  return {
    scheduled: rows.filter((row) => ["scheduled", "late", "approval", "sending"].includes(row.kind)).length,
    drafts: rows.filter((row) => row.kind === "draft").length,
    sent: rows.filter((row) => row.kind === "sent" && row.at && Date.parse(row.at) >= now.getTime() - SCHEDULE_DAYS * DAY).length,
    failed: rows.filter((row) => row.kind === "failed").length,
    doubles: rows.filter((row) => row.flags.length).length,
    next: upcoming[0] ?? null,
  };
}

/** "Tomorrow at 9:00 AM", or "Thursday, Oct 23 at 9:00 AM", in Eastern time. */
export function whenLabel(at: string, now: Date) {
  const day = dayTitle(easternDay(at), now);
  return `${["Today", "Tomorrow", "Yesterday"].includes(day.title) ? day.title : `${day.title}, ${day.date}`} at ${easternTime(at)}`;
}

export type ScheduleView = { problem: "key" | "channels" | "read" | null; rows: ScheduleRow[]; notes: string[]; more: boolean; skipped: number; updated: number };

/**
 * The page's data: the saved channels' posts read from Buffer, matched to the app's deliveries. Where
 * Buffer reports a newer status for a post the app sent, that delivery record is updated, so Results
 * and Pick posts see what Buffer sees. A record that changed since it was read (a send or a Refresh
 * at the same moment) is left alone. Nothing is ever written to Buffer.
 */
export async function loadBufferSchedule(db: PrismaClient, orgId: string, channels: readonly BufferChannel[], options: { key?: string; now?: Date; fetcher?: typeof fetch } = {}): Promise<ScheduleView> {
  const now = options.now ?? new Date();
  const key = options.key ?? process.env.BUFFER_API_KEY ?? "";
  const empty = { rows: [], notes: [], more: false, skipped: 0, updated: 0 };
  if (!key.trim()) return { ...empty, problem: "key" };
  // Saved channels carry their Buffer organization; without one there is nothing to read.
  if (!channels.some((channel) => channel.organizationId)) return { ...empty, problem: "channels" };
  const [read, deliveries, superseded] = await Promise.all([
    readBufferSchedule(channels, key, now, options.fetcher).catch((error: unknown) => {
      // The messages are the app's own or the response schema's, never Buffer's text or the key.
      console.error("[buffer-schedule] read failed:", error instanceof Error ? error.message.slice(0, 300) : "unknown error");
      return null;
    }),
    db.activityLog.findMany({ where: { orgId, action: BUFFER_DELIVERY }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true }, take: 1000 }),
    db.activityLog.findMany({ where: { orgId, action: REVIEW_SUPERSEDED }, select: { metadata: true }, take: 5000 }),
  ]);
  if (!read) return { ...empty, problem: "read" };
  const patches = new Map(deliveryPatches(read.posts, deliveries).map(({ id, patch }) => [id, patch]));
  let updated = 0;
  const current = await Promise.all(deliveries.map(async (row) => {
    const record = deliveryOf(row);
    const patch = record ? patches.get(record.id) : undefined;
    if (!record || !patch) return row;
    const next = { ...record, ...patch };
    const unchanged: Prisma.ActivityLogWhereInput[] = [{ metadata: { path: ["status"], equals: record.status } }];
    if (typeof record.checkedAt === "string") unchanged.push({ metadata: { path: ["checkedAt"], equals: record.checkedAt } });
    const result = await db.activityLog.updateMany({ where: { id: record.id, orgId, action: BUFFER_DELIVERY, AND: unchanged }, data: { metadata: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue } }).catch(() => ({ count: 0 }));
    updated += result.count;
    return { createdAt: row.createdAt, metadata: next };
  }));
  return { problem: null, rows: buildSchedule({ posts: read.posts, channels, deliveries: current, superseded, now }), notes: channelNotes(channels, read.channels), more: read.more, skipped: read.skipped, updated };
}
