// node --import tsx --test scripts/check-write-loop.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { captionsLookComplete, proposeCaptionFixes, regenerateUnlocked, writeCheckedCopy, writeLoopPlan } from './local-write-loop.ts';

const schema = z.object({ social: z.string(), googleBusiness: z.string() });
const evidence = { postType: 'project', photos: [{ assetId: 'p1', observations: ['Gray paver patio'] }], notes: { facts: [{ source: 'voice', quote: 'We laid a paver patio.' }] }, reasons: [] };

function harness(drafts, verdicts) {
  const asks = [];
  const checked = [];
  const request = async (body) => {
    asks.push(JSON.parse(body.messages[1].content));
    const next = drafts.shift();
    return { message: { content: typeof next === 'string' ? next : JSON.stringify(next) } };
  };
  const audit = async (_model, copy) => {
    checked.push(copy.social);
    return { audit: { fields: [] }, issues: verdicts.shift() ?? [] };
  };
  const run = (plan = writeLoopPlan('local')) => writeCheckedCopy({ request, audit, model: 'writer', system: 'system', evidence, schema, plan, options: {}, complete: (copy) => !!copy.social.trim() });
  return { run, asks, checked };
}

const draft = (social) => ({ social, googleBusiness: `${social} (Google)` });

test('a first draft that passes is used without writing a second', async () => {
  const { run, checked } = harness([draft('A')], [[]]);
  const result = await run();
  assert.equal(result.copy.social, 'A');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(checked, ['A']);
});

test('the second version is kept when it passes and the first does not', async () => {
  const { run, checked } = harness([draft('A'), draft('B')], [['social: says the town'], []]);
  const result = await run();
  assert.equal(result.copy.social, 'B');
  assert.deepEqual(checked, ['A', 'B']);
});

test('the fact-check findings go back to the writer until the draft passes', async () => {
  const { run, asks } = harness([draft('A'), draft('B'), draft('C')], [['social: says the town', 'googleBusiness: adds a warranty'], ['social: says the town'], []]);
  const result = await run();
  assert.equal(result.copy.social, 'C');
  assert.deepEqual(result.issues, []);
  const fixAsk = asks.at(-1);
  assert.equal(fixAsk.previousDraft.social, 'B');
  assert.deepEqual(fixAsk.problems, ['social: says the town']);
  assert.ok(fixAsk.facts.length > 0);
});

test('after the last fix round the draft with the fewest problems is returned for a hold', async () => {
  const { run, checked } = harness([draft('A'), draft('B'), draft('C'), draft('D')], [['x', 'y'], ['x'], ['x', 'y', 'z'], ['x']]);
  const result = await run();
  assert.equal(result.copy.social, 'D');
  assert.deepEqual(result.issues, ['x']);
  assert.equal(checked.length, 4);
});

test('a checker that skipped the exact text is asked again instead of rewriting the copy', async () => {
  const { run, checked } = harness([draft('A')], [['social: the reviewer did not check the exact current text.'], []]);
  const result = await run({ candidates: 1, fixRounds: 2 });
  assert.equal(result.copy.social, 'A');
  assert.deepEqual(checked, ['A', 'A']);
  assert.equal(result.writes, 1);
});

test('broken JSON is retried once, and a pack is never released when every write fails', async () => {
  const retried = harness(['not json', draft('A')], [[]]);
  assert.equal((await retried.run({ candidates: 1, fixRounds: 0 })).copy.social, 'A');
  const failing = harness(['nope', 'still nope'], []);
  await assert.rejects(failing.run({ candidates: 1, fixRounds: 0 }), /no pack was released/);
});

test('paid hybrid calls write one version; free local calls write two', () => {
  assert.equal(writeLoopPlan('hybrid').candidates, 1);
  assert.equal(writeLoopPlan('local').candidates, 2);
});

const pack = {
  packName: 'Staircase', publicLocation: 'Bethlehem, PA', service: 'Exterior stairs',
  social: 'We built this staircase for every family in town.', googleBusiness: 'New staircase in Bethlehem.',
  metaPrimary: 'New exterior staircase.', metaHeadline: 'New staircase', imageHeadline: 'New staircase',
  googleHeadlines: ['New staircase', 'Safer entry', 'Black railings'], googleDescriptions: ['A new staircase and landing.', 'White posts and black railings.'],
};

test('suggested fixes return only the captions that changed, and never the pack name', async () => {
  const fixed = { ...pack, packName: 'Renamed', social: 'A new exterior staircase with white posts and black railings.' };
  const request = async () => ({ message: { content: JSON.stringify(fixed) } });
  const audit = async () => ({ audit: { fields: [] }, issues: [] });
  const result = await proposeCaptionFixes({ request, audit, model: 'writer', evidence, draft: { ...pack, sourceNotes: 'private' }, issues: ['social: claims every family in town'], options: {} });
  assert.deepEqual(Object.keys(result.copy), ['social']);
  assert.equal(result.copy.social, fixed.social);
  assert.equal(result.remaining, 0);
});

test('no suggestion is stored when the fix is not better than the current captions', async () => {
  const request = async () => ({ message: { content: JSON.stringify({ ...pack, social: 'Still says every family in town.' }) } });
  const audit = async () => ({ audit: { fields: [] }, issues: ['social: claims every family in town'] });
  assert.equal(await proposeCaptionFixes({ request, audit, model: 'writer', evidence, draft: pack, issues: ['social: claims every family in town'], options: {} }), undefined);
  assert.equal(await proposeCaptionFixes({ request, audit, model: 'writer', evidence, draft: pack, issues: [], options: {} }), undefined);
});

test('regenerate rewrites only the unlocked captions and sends the kept ones as fixed context', async () => {
  const asks = [];
  const locked = { social: pack.social, googleHeadlines: pack.googleHeadlines, publicLocation: 'Bethlehem, PA', service: 'Exterior stairs', metaPrimary: pack.metaPrimary, metaHeadline: pack.metaHeadline, imageHeadline: pack.imageHeadline };
  const request = async (body) => {
    asks.push(JSON.parse(body.messages[1].content));
    assert.deepEqual(Object.keys(body.format.properties).sort(), ['googleBusiness', 'googleDescriptions']);
    return { message: { content: JSON.stringify({ googleBusiness: 'New exterior staircase and landing in Bethlehem.', googleDescriptions: ['White posts, black railings.', 'Safer entry from the driveway.'] }) } };
  };
  const audit = async () => ({ audit: { fields: [] }, issues: [] });
  const result = await regenerateUnlocked({ request, audit, model: 'writer', evidence, locked, note: 'mention the landing', options: {} });
  assert.deepEqual(Object.keys(result.proposal).sort(), ['googleBusiness', 'googleDescriptions']);
  assert.equal(result.remaining, 0);
  assert.deepEqual(asks[0].keptCaptions, locked);
  assert.equal(asks[0].ownerNote, 'mention the landing');
  await assert.rejects(regenerateUnlocked({ request, audit, model: 'writer', evidence, locked: { ...locked, googleBusiness: 'x', googleDescriptions: ['a.', 'b.'] }, note: '', options: {} }), /Every caption is kept/);
});

test('captions with stray CJK characters or a dangling last word are not accepted from the writer', () => {
  assert.equal(captionsLookComplete({ ...pack }), true);
  assert.equal(captionsLookComplete({ ...pack, googleDescriptions: ['White treads and wooden支持.', 'Black railings.'] }), false);
  assert.equal(captionsLookComplete({ ...pack, googleDescriptions: ['Safer entry access in.', 'Black railings.'] }), false);
  assert.equal(captionsLookComplete({ ...pack, metaHeadline: 'Stairs with' }), false);
  assert.equal(captionsLookComplete({ googleBusiness: 'Only this caption.' }), true);
});

test('the writer is told exactly what to fix, and gets the house voice and approved posts as tone examples', async () => {
  const seen = [];
  const request = async (body) => {
    seen.push(body.messages);
    return { message: { content: JSON.stringify(seen.length === 1 ? { social: 'X', googleBusiness: 'Same.' } : { social: 'Paver patio.', googleBusiness: 'Gray pavers.' }) } };
  };
  const audit = async () => ({ audit: { fields: [] }, issues: [] });
  const complete = (copy) => (copy.social.length > 3 ? true : 'social is too short.');
  await writeCheckedCopy({ request, audit, model: 'writer', system: 'system', evidence, schema, plan: { candidates: 1, fixRounds: 0 }, options: {}, complete, context: { houseVoice: ['Plain words.'], voiceExamples: ['We laid this patio last spring.'] } });
  const retry = seen[1].at(-1).content;
  assert.match(retry, /The problem: social is too short\./);
  const ask = JSON.parse(seen[0][1].content);
  assert.deepEqual(ask.houseVoice, ['Plain words.']);
  assert.deepEqual(ask.voiceExamples, ['We laid this patio last spring.']);
});

test('voice examples are the newest approved posts, without repeats', async () => {
  const { voiceExamples, HOUSE_VOICE } = await import('./local-voice.ts');
  assert.ok(HOUSE_VOICE.some((line) => /scope/.test(line)));
  const prisma = { activityLog: { findMany: async (query) => (query.where.action === 'marketing.content.approved'
    ? [{ metadata: { draftId: 'b' } }, { metadata: { draftId: 'a' } }, { metadata: { draftId: 'b' } }]
    : [{ id: 'a', metadata: { social: 'Older post.' } }, { id: 'b', metadata: { social: 'Newest post.' } }]) } };
  assert.deepEqual(await voiceExamples(prisma, 'org'), ['Newest post.', 'Older post.']);
  const none = { activityLog: { findMany: async () => [] } };
  assert.deepEqual(await voiceExamples(none, 'org'), []);
});
