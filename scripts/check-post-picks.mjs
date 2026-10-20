// node --import tsx --test scripts/check-post-picks.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainOf, lastDelivery, pickNotes, pickStatus, plainNote, skippedRoots, versionLinks } from '../src/lib/post-picks.ts';
import { bufferSelections } from '../src/lib/post-picks-rules.ts';
import { saveProposalVersion } from '../src/lib/draft-versions.ts';
import { nextCaptionRevision } from '../src/lib/caption-revision-store.ts';

const photo1 = '20000000-0000-4000-8000-000000000001';
const photo2 = '20000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const evidence = { version: 1, sources: { notes: '', voice: '', owner: 'Navy island.' }, postType: 'project', photos: [{ assetId: photo1, relevance: 'construction', observations: ['Navy island.'], concerns: [] }], notes: { facts: [], conflicts: [] }, reasons: [] };
const review = (patch = {}) => ({ draftId: 'd3', inputHash: hash, status: 'completed', requestedAt: '2026-10-20T00:00:00.000Z', policyVersion: 3, evidence, result: { summary: 'Checked.', findings: [] }, ...patch });
const status = (patch = {}) => pickStatus({ preparing: false, review: review(), inputHash: hash, approvedAt: null, voicePending: false, copyBlocked: false, ...patch });
const superseded = [{ metadata: { draftId: 'd1', replacementDraftId: 'd2' } }, { metadata: { draftId: 'd2', replacementDraftId: 'd3' } }, { metadata: { draftId: 'x1', replacementDraftId: 'x2' } }];

test('every version of a post is found from any one of them, oldest first', () => {
  const links = versionLinks(superseded);
  for (const id of ['d1', 'd2', 'd3']) assert.deepEqual(chainOf(id, links), ['d1', 'd2', 'd3']);
  assert.deepEqual(chainOf('solo', links), ['solo']);
});

test('a post sent from any version counts as sent; a rejected send does not', () => {
  const rows = [
    { createdAt: new Date('2026-10-19'), metadata: { draftId: 'd2', status: 'rejected', channelName: 'Facebook' } },
    { createdAt: new Date('2026-09-01'), metadata: { draftId: 'd1', status: 'draft', channelName: 'Google Business' } },
  ];
  const sent = lastDelivery(['d1', 'd2', 'd3'], rows);
  assert.equal(sent.channelName, 'Google Business');
  assert.equal(sent.at.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(lastDelivery(['d2'], rows), null);
  assert.equal(lastDelivery(['other'], rows), null);
});

test('a skip lasts until its date', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const roots = skippedRoots([{ metadata: { rootId: 'd1', until: '2026-11-19T12:00:00Z' } }, { metadata: { rootId: 'old', until: '2026-10-01T00:00:00Z' } }, { metadata: { rootId: 7 } }], now);
  assert.deepEqual([...roots], ['d1']);
});

test('a post is ready only with a current, passing check, and warnings make it worth a look', () => {
  assert.equal(status(), 'ready');
  assert.equal(status({ preparing: true }), 'preparing');
  assert.equal(status({ approvedAt: '2026-10-20T00:00:00Z' }), 'approved');
  assert.equal(status({ review: null }), 'unchecked');
  assert.equal(status({ review: review({ inputHash: 'b'.repeat(64) }) }), 'unchecked');
  assert.equal(status({ review: review({ policyVersion: 2 }) }), 'unchecked');
  assert.equal(status({ review: review({ status: 'queued' }) }), 'checking');
  assert.equal(status({ review: review({ status: 'running' }) }), 'checking');
  assert.equal(status({ review: review({ status: 'failed', error: 'Local reviewer timed out.' }) }), 'failed');
  assert.equal(status({ review: review({ evidence: { ...evidence, reasons: [`Photo ${photo1}: Customer address visible.`] } }) }), 'blocked');
  assert.equal(status({ review: review({ result: { summary: 'x', findings: [{ category: 'facts', severity: 'blocker', detail: 'The caption names the town Bethlehem, and the notes do not.', evidence: 'x', suggestion: '' }] } }) }), 'blocked');
  assert.equal(status({ copyBlocked: true }), 'blocked');
  assert.equal(status({ review: review({ result: { summary: 'x', findings: [{ category: 'copy', severity: 'warning', detail: 'The Google Business update repeats the Facebook post.', evidence: 'x', suggestion: '' }] } }) }), 'look');
});

test('notes name photos by number and leave out cosmetic lines', () => {
  assert.equal(plainNote(`Photo ${photo2}: Customer address visible near ${photo2}.`, [photo1, photo2]), 'Photo 2: Customer address visible near Photo 2.');
  const blocked = review({ evidence: { ...evidence, reasons: [`Photo ${photo1}: Customer address visible.`, `Photo ${photo1}: The image shows no visible construction equipment or unfinished elements — all work appears complete.`] } });
  assert.deepEqual(pickNotes('blocked', blocked, [], [photo1]), ['Photo 1: Customer address visible.']);
  const look = review({ result: { summary: 'x', findings: [{ category: 'copy', severity: 'warning', detail: 'The Google Business update repeats the Facebook post.', evidence: 'x', suggestion: '' }] } });
  assert.deepEqual(pickNotes('look', look, [], [photo1]), ['The Google Business update repeats the Facebook post.']);
  assert.deepEqual(pickNotes('ready', look, [], [photo1]), []);
  assert.deepEqual(pickNotes('failed', review({ status: 'failed', error: 'Local reviewer timed out.' }), [], []), ['Local reviewer timed out.']);
});

test('Facebook gets up to 10 photos in order, Google Business the first, and nothing else is sent', () => {
  const ids = Array.from({ length: 12 }, (_, index) => `p${index + 1}`);
  const channels = [{ id: 'fb', service: 'facebook', name: 'Facebook' }, { id: 'gb', service: 'googlebusiness', name: 'Google' }, { id: 'ig', service: 'instagram', name: 'Instagram' }];
  const selections = bufferSelections(channels, ids);
  assert.deepEqual(selections.map((selection) => selection.channelId), ['fb', 'gb']);
  assert.deepEqual(selections[0].assetIds, ids.slice(0, 10));
  assert.deepEqual(selections[1].assetIds, ['p1']);
  assert.deepEqual(bufferSelections(channels, []), []);
});

test("the owner's own rewrite runs before Pick posts' background rewrites", () => {
  assert.equal(nextCaptionRevision([{ id: 'pick1', apply: true }, { id: 'pick2', apply: true }, { id: 'owner', apply: false }]).id, 'owner');
  assert.equal(nextCaptionRevision([{ id: 'pick1', apply: true }, { id: 'pick2', apply: true }]).id, 'pick1');
  assert.equal(nextCaptionRevision([]), undefined);
});

const draft = { postType: 'project', packName: 'Kitchen', sourceNotes: 'Navy island.', publicLocation: '', service: '', photoNotes: [], assetIds: [photo1], social: 'Old social.', googleBusiness: 'Old Google.', metaPrimary: 'Ad text.', metaHeadline: 'Kitchen', googleHeadlines: ['One', 'Two', 'Three'], googleDescriptions: ['First line.', 'Second line.'], imageHeadline: 'Kitchen', landingUrl: 'https://rhipros.com/projects/kitchen' };
function fakeDb() {
  const created = [];
  return { created, $transaction: async (fn) => fn({ activityLog: { create: async ({ data }) => { created.push(data); return { id: `v${created.length}` }; } } }) };
}

test('a picked rewrite becomes a new version that changes only the two posts and replaces the old one', async () => {
  const db = fakeDb();
  const loaded = { draftId: 'd1', jobId: 'j1', inputHash: hash, superseded: false, approvedAt: null, draft };
  const id = await saveProposalVersion(db, 'org', 'd1', hash, { social: ' A navy island with a white top. ', googleBusiness: 'Navy island, white top.' }, async () => loaded);
  assert.equal(id, 'v1');
  const [version, replaced] = db.created;
  assert.equal(version.action, 'marketing.draft.saved');
  assert.equal(version.actorId, null);
  assert.equal(version.metadata.social, 'A navy island with a white top.');
  assert.equal(version.metadata.googleBusiness, 'Navy island, white top.');
  assert.equal(version.metadata.metaPrimary, 'Ad text.');
  assert.equal(version.metadata.parentDraftId, 'd1');
  assert.equal(replaced.action, 'marketing.content.superseded');
  assert.deepEqual(replaced.metadata, { draftId: 'd1', replacementDraftId: 'v1' });
});

test('a rewrite is not saved over a changed, replaced or approved draft, or when it is empty', async () => {
  const base = { draftId: 'd1', jobId: 'j1', inputHash: hash, superseded: false, approvedAt: null, draft };
  for (const loaded of [null, { ...base, inputHash: 'b'.repeat(64) }, { ...base, superseded: true }, { ...base, approvedAt: '2026-10-20T00:00:00Z' }]) {
    const db = fakeDb();
    assert.equal(await saveProposalVersion(db, 'org', 'd1', hash, { social: 'New.' }, async () => loaded), null);
    assert.equal(db.created.length, 0);
  }
  const untouched = fakeDb();
  assert.equal(await saveProposalVersion(untouched, 'org', 'd1', hash, { social: '  ' }, async () => { throw new Error('should not load'); }), null);
});
