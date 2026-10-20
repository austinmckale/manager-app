// node --import tsx --test scripts/check-buffer-schedule.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchedule, channelNotes, deliveryPatches, easternDay, easternTime, excerpt, failureReason, loadBufferSchedule, readBufferSchedule, safeImage, scheduleDays, scheduleKind, scheduleSummary, whenLabel } from '../src/lib/publishing/buffer-schedule.ts';
import { bufferStatus } from '../src/lib/publishing/buffer-delivery.ts';

// Every Buffer call here is mocked; a real request fails the test.
globalThis.fetch = () => { throw new Error('Unexpected network'); };

const now = new Date('2026-10-20T16:00:00Z'); // Tuesday, 12:00 PM Eastern
const facebook = { id: 'fb', name: 'RHI Pros', displayName: 'RHI Pros', service: 'facebook', organization: 'RHI', organizationId: 'org-1', isQueuePaused: false, isDisconnected: false, isLocked: false };
const google = { ...facebook, id: 'gbp', service: 'googlebusiness' };
const channels = [facebook, google];
const post = (id, patch = {}) => ({ id, channelId: 'fb', text: `Post ${id}`, status: 'scheduled', dueAt: '2026-10-21T13:00:00Z', sentAt: null, externalLink: null, createdAt: '2026-10-19T12:00:00Z', assets: [], error: null, ...patch });
const delivery = (postId, patch = {}) => ({ id: `d-${postId}`, draftId: 'v1', inputHash: 'a'.repeat(64), channelId: 'fb', channelName: 'RHI Pros', service: 'facebook', mode: 'queue', assetIds: [], status: 'queued', postId, dueAt: null, sentAt: null, externalLink: null, message: '', checkedAt: '2026-10-19T12:00:00.000Z', ...patch });
const row = (record, createdAt = '2026-10-19T12:00:00Z') => ({ createdAt: new Date(createdAt), metadata: record });
const page = (nodes, more = false, cursor = null) => ({ edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: more, endCursor: cursor } });
const versions = [{ metadata: { draftId: 'v1', replacementDraftId: 'v2' } }, { metadata: { draftId: 'v2', replacementDraftId: 'v3' } }];
const schedule = (posts, deliveries = [], superseded = versions) => Object.fromEntries(buildSchedule({ posts, channels, deliveries, superseded, now }).map((item) => [item.postId, item]));
function buffer(handler) {
  const calls = [];
  const fetcher = async (url, init) => {
    assert.equal(url, 'https://api.buffer.com');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    const body = JSON.parse(init.body);
    calls.push(body);
    return Response.json({ data: handler(body, calls.length) });
  };
  return { calls, fetcher };
}

test('one read-only request lists recent and upcoming posts, every draft and the channels, for the saved channels only', async () => {
  const b = buffer(() => ({
    recent: page([post('p1'), post('not-ours', { channelId: 'someone-else' })]),
    drafts: page([post('p2', { status: 'draft', dueAt: null }), post('p1')]),
    channels: [{ id: 'fb', isQueuePaused: true, isDisconnected: false, isLocked: false }, { id: 'gbp', isQueuePaused: false }, { id: 'someone-else', isQueuePaused: false }],
  }));
  const read = await readBufferSchedule(channels, 'secret', now, b.fetcher);
  assert.equal(b.calls.length, 1);
  const [{ query, variables }] = b.calls;
  assert.match(query, /^query /);
  assert.doesNotMatch(query, /mutation|createPost|editPost|deletePost/i);
  assert.equal(variables.organizationId, 'org-1');
  assert.deepEqual(variables.recent.filter, { channelIds: ['fb', 'gbp'], startDate: '2026-09-20T16:00:00.000Z' });
  assert.deepEqual(variables.drafts.filter, { channelIds: ['fb', 'gbp'], status: ['draft'] });
  assert.equal(variables.first, 50);
  assert.deepEqual(read.posts.map((item) => item.id).sort(), ['p1', 'p2']);
  assert.deepEqual(read.channels.map((item) => [item.id, item.isQueuePaused, item.isDisconnected]), [['fb', true, false], ['gbp', false, false]]);
  assert.equal(read.more, false);
  assert.equal(read.skipped, 0);
});

test("pages through recent posts with Buffer's cursor and stops after four pages", async () => {
  const b = buffer((_body, call) => call === 1 ? { recent: page([post('p1')], true, 'c1'), drafts: page([]), channels: [] } : { posts: page([post(`p${call}`)], true, `c${call}`) });
  const read = await readBufferSchedule([facebook], 'secret', now, b.fetcher);
  assert.equal(b.calls.length, 4);
  assert.deepEqual(b.calls.slice(1).map((call) => call.variables.after), ['c1', 'c2', 'c3']);
  for (const call of b.calls.slice(1)) {
    assert.match(call.query, /^query /);
    assert.deepEqual(call.variables.input.filter.channelIds, ['fb']);
  }
  assert.equal(read.posts.length, 4);
  assert.equal(read.more, true);
});

test('a post in an unexpected shape is skipped; a Buffer error stops the read and nothing is retried', async () => {
  const b = buffer(() => ({ recent: page([post('p1'), { id: 'broken' }]), drafts: page([]), channels: [] }));
  const read = await readBufferSchedule([facebook], 'secret', now, b.fetcher);
  assert.deepEqual(read.posts.map((item) => item.id), ['p1']);
  assert.equal(read.skipped, 1);
  let calls = 0;
  await assert.rejects(readBufferSchedule([facebook], 'secret', now, async () => { calls++; return Response.json({ data: null, errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] }); }));
  await assert.rejects(readBufferSchedule([facebook], 'secret', now, async () => { calls++; return new Response('Too many requests', { status: 429 }); }));
  assert.equal(calls, 2);
});

test("Buffer's statuses in plain words, and a queued post Buffer calls 'buffer' counts as queued", () => {
  const kind = (status, dueAt = '2026-10-21T13:00:00Z') => scheduleKind({ status, dueAt }, now);
  assert.equal(kind('scheduled'), 'scheduled');
  assert.equal(kind('buffer'), 'scheduled');
  assert.equal(kind('scheduled', '2026-10-20T15:00:00Z'), 'late');
  assert.equal(kind('scheduled', '2026-10-20T15:50:00Z'), 'scheduled');
  assert.equal(kind('draft'), 'draft');
  assert.equal(kind('needs_approval'), 'approval');
  assert.equal(kind('sending'), 'sending');
  assert.equal(kind('sent'), 'sent');
  assert.equal(kind('error'), 'failed');
  assert.equal(kind('something_new'), 'other');
  assert.equal(schedule([post('odd', { status: 'something_new' })]).odd.label, 'Buffer lists it as "something_new"');
  assert.equal(bufferStatus(post('p', { status: 'buffer' })), 'queued');
  assert.equal(bufferStatus(post('p', { status: 'sent' })), 'unknown');
});

test('each post is From the app (with its draft) or Added in Buffer; photos and links are https only', () => {
  const rows = schedule([
    post('app', { assets: [{ id: null, mimeType: 'image/jpeg', thumbnail: 'https://buffer.example/t.jpg' }] }),
    post('test', { status: 'draft', dueAt: null }),
    post('mine', { status: 'sent', sentAt: '2026-10-19T13:02:00Z', externalLink: 'https://facebook.com/post/1', assets: [{ id: null, mimeType: 'image/jpeg', thumbnail: 'javascript:alert(1)' }] }),
    post('moved', { channelId: 'gbp' }),
    post('bad', { status: 'error', externalLink: 'javascript:alert(1)', error: { message: 'Image https://private.example/signed?token=abc failed.\n Try again.' } }),
  ], [row(delivery('app', { draftId: 'v9' })), row(delivery('test', { draftId: null, status: 'draft' })), row(delivery('moved'))], []);
  assert.equal(rows.app.fromApp, true);
  assert.equal(rows.app.draftId, 'v9');
  assert.equal(rows.app.thumbnail, 'https://buffer.example/t.jpg');
  assert.equal(rows.app.channelName, 'Facebook');
  assert.equal(rows.test.fromApp, true);
  assert.equal(rows.test.test, true);
  assert.equal(rows.test.draftId, null);
  assert.equal(rows.test.at, null);
  assert.equal(rows.mine.fromApp, false);
  assert.equal(rows.mine.link, 'https://facebook.com/post/1');
  assert.equal(rows.mine.thumbnail, null);
  assert.equal(rows.mine.at, '2026-10-19T13:02:00Z');
  assert.equal(rows.moved.fromApp, false, 'a delivery on another channel is not this post');
  assert.equal(rows.bad.link, null);
  assert.equal(rows.bad.label, 'Failed');
  assert.equal(rows.bad.failure, 'Image [link] failed. Try again.');
});

test('one approved version going to Facebook and Google Business is one send, not a double post', () => {
  const rows = schedule([post('fb-post'), post('gb-post', { channelId: 'gbp' })], [row(delivery('fb-post', { draftId: 'v3' })), row(delivery('gb-post', { draftId: 'v3', channelId: 'gbp', service: 'googlebusiness' }))]);
  assert.deepEqual([rows['fb-post'].flags, rows['gb-post'].flags], [[], []]);
});

test('two posts from the same job on one channel are both flagged, whichever versions they came from', () => {
  const rows = schedule(
    [post('old', { status: 'sent', sentAt: '2026-10-10T13:00:00Z' }), post('new', { dueAt: '2026-10-22T13:00:00Z' })],
    [row(delivery('new', { draftId: 'v3' })), row(delivery('old', { draftId: 'v1', status: 'published' }), '2026-10-09T12:00:00Z')],
  );
  assert.deepEqual(rows.new.flags, ['Another post from this job is on Facebook too (sent Oct 10).']);
  assert.deepEqual(rows.old.flags, ['Another post from this job is on Facebook too (scheduled for Oct 22).']);
  // An older send that Buffer no longer lists still counts, from its stored record.
  const older = schedule([post('new')], [row(delivery('new', { draftId: 'v3' })), row(delivery('gone', { draftId: 'v1', status: 'published', sentAt: '2026-09-01T13:00:00Z' }), '2026-08-31T12:00:00Z')]);
  assert.deepEqual(older.new.flags, ['Another post from this job is on Facebook too (sent Sep 1).']);
  // The same version approved again and sent to the same channel twice is caught too.
  const twice = schedule([post('a'), post('b', { dueAt: '2026-10-23T13:00:00Z' })], [row(delivery('a', { draftId: 'v3' })), row(delivery('b', { draftId: 'v3', inputHash: 'b'.repeat(64) }))]);
  assert.equal(twice.a.flags.length, 1);
  assert.equal(twice.b.flags.length, 1);
});

test('a job scheduled again within 90 days of an earlier send is flagged; older, failed or rejected sends and drafts are not', () => {
  const again = (earlier, patch = {}) => schedule([post('gb', { channelId: 'gbp', ...patch })], [row(delivery('gb', { draftId: 'v3', channelId: 'gbp' })), row(delivery('fb-old', { draftId: 'v1', ...earlier.record }), earlier.at)]).gb.flags;
  assert.deepEqual(again({ record: { status: 'published' }, at: '2026-10-01T12:00:00Z' }), ['This job went to Buffer 20 days before this post (Facebook, Oct 1).']);
  // An earlier version left as a Buffer draft may still be scheduled, so it counts.
  assert.equal(again({ record: { status: 'draft' }, at: '2026-10-01T12:00:00Z' }).length, 1);
  assert.deepEqual(again({ record: { status: 'published' }, at: '2026-07-01T12:00:00Z' }), []);
  assert.deepEqual(again({ record: { status: 'failed' }, at: '2026-10-01T12:00:00Z' }), []);
  assert.deepEqual(again({ record: { status: 'rejected' }, at: '2026-10-01T12:00:00Z' }), []);
  // A draft does not post, so it is never flagged itself.
  assert.deepEqual(again({ record: { status: 'published' }, at: '2026-10-01T12:00:00Z' }, { status: 'draft', dueAt: null }), []);
});

test('the same text twice on one channel is flagged, even for posts added in Buffer', () => {
  const rows = schedule([
    post('a', { text: 'Fresh  deck stain.' }),
    post('b', { text: 'fresh deck stain.', status: 'sent', sentAt: '2026-10-18T13:00:00Z' }),
    post('c', { text: 'Fresh deck stain.', status: 'draft', dueAt: null }),
    post('d', { text: 'Fresh deck stain.', channelId: 'gbp' }),
  ], [], []);
  assert.deepEqual(rows.a.flags, ['Same text as another Facebook post (sent Oct 18).']);
  assert.deepEqual(rows.b.flags, ['Same text as another Facebook post (scheduled for Oct 21).']);
  assert.deepEqual([rows.c.flags, rows.d.flags], [[], []]);
});

test("Buffer's newer status becomes a patch for the app's record; the same, an unrecognised or another channel's status does not", () => {
  const posts = [
    post('sent', { status: 'sent', sentAt: '2026-10-19T13:00:00Z', externalLink: 'https://facebook.com/1' }),
    post('same'),
    post('moved', { dueAt: '2026-10-25T13:00:00Z' }),
    post('mystery', { status: 'mystery' }),
    post('no-time', { status: 'sent', sentAt: null }),
    post('other-channel', { channelId: 'gbp', status: 'sent', sentAt: '2026-10-19T13:00:00Z' }),
  ];
  const records = ['sent', 'moved', 'mystery', 'no-time', 'other-channel', 'gone'].map((id) => row(delivery(id, { dueAt: '2026-10-21T13:00:00Z' })));
  records.push(row(delivery('same', { dueAt: '2026-10-21T13:00:00Z' })));
  const patches = Object.fromEntries(deliveryPatches(posts, records).map(({ id, patch }) => [id, patch]));
  assert.deepEqual(Object.keys(patches).sort(), ['d-moved', 'd-sent']);
  assert.equal(patches['d-sent'].status, 'published');
  assert.equal(patches['d-sent'].sentAt, '2026-10-19T13:00:00Z');
  assert.equal(patches['d-sent'].externalLink, 'https://facebook.com/1');
  assert.equal(patches['d-moved'].status, 'queued');
  assert.equal(patches['d-moved'].dueAt, '2026-10-25T13:00:00Z');
});

function fakeDb(deliveries, superseded = []) {
  const updates = [];
  return {
    updates,
    activityLog: {
      findMany: async ({ where }) => where.action === 'marketing.buffer.delivery' ? deliveries : where.action === 'marketing.content.superseded' ? superseded : assert.fail(`Unexpected read ${where.action}`),
      updateMany: async (args) => { updates.push(args); return { count: 1 }; },
    },
  };
}

test('opening the page brings a changed delivery record up to date, only if nobody changed it since it was read', async () => {
  const db = fakeDb([row(delivery('p1')), row(delivery('p2', { dueAt: '2026-10-21T13:00:00Z' }))]);
  const b = buffer(() => ({ recent: page([post('p1', { status: 'sent', sentAt: '2026-10-20T13:00:00Z', externalLink: 'https://facebook.com/1' }), post('p2')]), drafts: page([]), channels: [{ id: 'fb', isQueuePaused: false }, { id: 'gbp', isQueuePaused: false }] }));
  const view = await loadBufferSchedule(db, 'org', channels, { key: 'secret', now, fetcher: b.fetcher });
  assert.equal(view.problem, null);
  assert.equal(view.updated, 1);
  assert.equal(db.updates.length, 1);
  const [update] = db.updates;
  assert.deepEqual([update.where.id, update.where.orgId, update.where.action], ['d-p1', 'org', 'marketing.buffer.delivery']);
  assert.deepEqual(update.where.AND, [{ metadata: { path: ['status'], equals: 'queued' } }, { metadata: { path: ['checkedAt'], equals: '2026-10-19T12:00:00.000Z' } }]);
  assert.deepEqual([update.data.metadata.status, update.data.metadata.sentAt, update.data.metadata.externalLink, update.data.metadata.draftId], ['published', '2026-10-20T13:00:00Z', 'https://facebook.com/1', 'v1']);
  assert.deepEqual(view.rows.map((item) => [item.postId, item.kind, item.fromApp]), [['p1', 'sent', true], ['p2', 'scheduled', true]]);
  assert.deepEqual(view.notes, []);
  assert.ok(b.calls.every((call) => /^query /.test(call.query)));
});

test('with no key, no saved channels or a failed Buffer read, nothing is read from Buffer twice and nothing is written', async () => {
  const db = fakeDb([row(delivery('p1'))]);
  assert.equal((await loadBufferSchedule(db, 'org', channels, { key: '', now })).problem, 'key');
  assert.equal((await loadBufferSchedule(db, 'org', [], { key: 'secret', now })).problem, 'channels');
  assert.equal((await loadBufferSchedule(db, 'org', [{ ...facebook, organizationId: undefined }], { key: 'secret', now })).problem, 'channels');
  let calls = 0;
  const failed = await loadBufferSchedule(db, 'org', channels, { key: 'secret', now, fetcher: async () => { calls++; return new Response('Unavailable', { status: 503 }); } });
  assert.equal(failed.problem, 'read');
  assert.deepEqual(failed.rows, []);
  assert.equal(calls, 1);
  assert.equal(db.updates.length, 0);
});

test('posts are grouped by Eastern day, latest first, and drafts with no time are kept apart', () => {
  const rows = buildSchedule({ posts: [
    post('tomorrow', { dueAt: '2026-10-21T13:00:00Z' }),
    post('tonight', { dueAt: '2026-10-21T02:30:00Z' }),
    post('morning', { status: 'sent', sentAt: '2026-10-20T13:05:00Z' }),
    post('last-week', { status: 'sent', sentAt: '2026-10-13T13:00:00Z' }),
    post('draft-new', { status: 'draft', dueAt: null, createdAt: '2026-10-20T12:00:00Z' }),
    post('draft-old', { status: 'draft', dueAt: null, createdAt: '2026-10-01T12:00:00Z' }),
  ], channels, deliveries: [], superseded: [], now });
  const { undated, days } = scheduleDays(rows, now);
  assert.deepEqual(undated.map((item) => item.postId), ['draft-new', 'draft-old']);
  assert.deepEqual(days.map((day) => [day.key, day.title, day.date, day.rows.map((item) => item.postId)]), [
    ['2026-10-21', 'Tomorrow', 'Wednesday, Oct 21', ['tomorrow']],
    ['2026-10-20', 'Today', 'Tuesday, Oct 20', ['tonight', 'morning']],
    ['2026-10-13', 'Tuesday', 'Oct 13', ['last-week']],
  ]);
  assert.equal(easternTime('2026-10-21T02:30:00Z'), '10:30 PM');
});

test('Eastern days stay right across the end of daylight time', () => {
  assert.deepEqual(['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-02T04:30:00Z', '2026-11-02T05:00:00Z'].map((at) => easternDay(at)), ['2026-11-01', '2026-11-01', '2026-11-01', '2026-11-02']);
  assert.equal(easternTime('2026-11-02T04:30:00Z'), '11:30 PM');
  assert.equal(whenLabel('2026-11-02T14:00:00Z', new Date('2026-11-01T04:30:00Z')), 'Tomorrow at 9:00 AM');
});

test('the summary counts each kind and names the next post', () => {
  const rows = buildSchedule({ posts: [
    post('a', { dueAt: '2026-10-22T13:00:00Z' }),
    post('b', { dueAt: '2026-10-21T13:00:00Z', channelId: 'gbp' }),
    post('late', { dueAt: '2026-10-20T13:00:00Z' }),
    post('d', { status: 'draft', dueAt: null }),
    post('s', { status: 'sent', sentAt: '2026-10-19T13:00:00Z' }),
    post('f', { status: 'error' }),
  ], channels, deliveries: [], superseded: [], now });
  const summary = scheduleSummary(rows, now);
  assert.deepEqual({ ...summary, next: summary.next.postId }, { scheduled: 3, drafts: 1, sent: 1, failed: 1, doubles: 0, next: 'b' });
  assert.equal(whenLabel(summary.next.at, now), 'Tomorrow at 9:00 AM');
  assert.equal(whenLabel('2026-10-23T13:00:00Z', now), 'Friday, Oct 23 at 9:00 AM');
});

test('channels Buffer cannot post to are named in plain words', () => {
  assert.deepEqual(channelNotes(channels, [{ id: 'fb', isQueuePaused: true, isDisconnected: false, isLocked: false }]), ["Facebook's queue is paused in Buffer. Its scheduled posts wait until you resume the queue.", 'Google Business was not found in Buffer. Check the connection on the Buffer page.']);
  assert.deepEqual(channelNotes(channels, [{ id: 'fb', isQueuePaused: false, isDisconnected: true, isLocked: false }, { id: 'gbp', isQueuePaused: false, isDisconnected: false, isLocked: false }]), ['Facebook is disconnected in Buffer. Nothing posts there until you reconnect it in Buffer.']);
  assert.deepEqual(channelNotes([facebook, { ...facebook, id: 'fb2', displayName: 'RHI Pros Two' }], [{ id: 'fb', isQueuePaused: false, isDisconnected: false, isLocked: true }, { id: 'fb2', isQueuePaused: false, isDisconnected: false, isLocked: false }]), ['Facebook (RHI Pros) is locked in Buffer. Unlock it in Buffer before anything can post there.']);
});

test('excerpts end on a word, failure reasons drop links, and only https or demo photos show', () => {
  assert.equal(excerpt('short  text\n'), 'short text');
  const long = excerpt('word '.repeat(100));
  assert.ok(long.length <= 221 && long.endsWith('word…'));
  assert.equal(failureReason('Failed: see www.example.com/x and https://a.b/c?d=1'), 'Failed: see [link] and [link]');
  assert.equal(failureReason('   '), null);
  assert.equal(safeImage('http://plain.example/x.jpg'), null);
  assert.equal(safeImage('//other.example/x.jpg'), null);
  assert.equal(safeImage('/demo/pavilion-front.jpg'), '/demo/pavilion-front.jpg');
});

test('the schedule code has no way to change Buffer', () => {
  for (const file of ['../src/lib/publishing/buffer-schedule.ts', '../src/app/(app)/marketing/schedule/page.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /mutation|createBufferPost|testBufferDraft|executeBufferSend|refreshBufferDelivery|\/api\/publishing/);
  }
});
