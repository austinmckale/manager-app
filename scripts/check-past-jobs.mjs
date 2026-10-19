// node --import tsx --test scripts/check-past-jobs.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pastJobDraft, pastJobNotes, websiteThumb } from '../src/lib/past-jobs-copy.ts';
import { websiteProjectCatalog } from '../src/lib/website-project-catalog.ts';
import { copyChecks } from '../src/lib/copy-checks.ts';
import { draftPublishability } from '../src/lib/publishability.ts';

const photo = '10000000-0000-4000-8000-000000000001';

test('every website project makes a valid pack from its own published words, never the generic filler', () => {
  assert.ok(websiteProjectCatalog.length >= 10);
  for (const project of websiteProjectCatalog) {
    const draft = pastJobDraft(project, [photo]);
    assert.equal(draft.social, project.description.slice(0, 2200), project.slug);
    assert.ok(!/Planning a project of your own/.test(draft.social), project.slug);
    assert.equal(draft.googleHeadlines.length, 3, project.slug);
    assert.ok(draft.googleHeadlines.every((line) => line.length <= 30), project.slug);
    assert.equal(draft.packName, project.title.slice(0, 120));
    assert.ok(draft.sourceNotes.includes(project.description), project.slug);
    assert.equal(draftPublishability(draft).blocked, false, `${project.slug} must not trip the website-reuse block`);
    assert.equal(copyChecks(draft).filter((finding) => finding.severity === 'blocker').length, 0, `${project.slug} has a blocking copy check`);
  }
});

test('the notes the AI may quote are the published summary, how the job was done, scope and results', () => {
  const project = websiteProjectCatalog[0];
  const notes = pastJobNotes(project);
  assert.ok(notes.includes(project.description) && notes.includes(project.solution));
  assert.ok(notes.length <= 6000);
});

test('cover pictures use the website image resizer, not multi-megabyte originals', () => {
  assert.equal(websiteThumb('/images/projects/a b.jpg'), 'https://www.rhipros.com/_next/image?url=%2Fimages%2Fprojects%2Fa%20b.jpg&w=640&q=75');
});

const job = (slug, title, service, versionIds = []) => ({ slug, title, service, versionIds });

test('the weekly past job is in season, skips anything sent in the last 90 days, and stays the same all week', async () => {
  const { inSeason, pickPastJob } = await import('../src/lib/past-jobs-copy.ts');
  const summer = new Date('2026-07-01T12:00:00Z');
  const winter = new Date('2026-12-01T12:00:00Z');
  assert.equal(inSeason(job('reading-paver-patio-buildout', 'Paver patio', 'Patios'), summer), true);
  assert.equal(inSeason(job('reading-paver-patio-buildout', 'Paver patio', 'Patios'), winter), false);
  assert.equal(inSeason(job('ryan-kitchen-remodel', 'Kitchen remodel', 'Kitchen Remodeling'), winter), true);
  const jobs = [job('patio', 'Paver patio', 'Patios', ['d1']), job('deck', 'New deck', 'Decks'), job('kitchen', 'Kitchen', 'Kitchen Remodeling')];
  assert.equal(pickPastJob(jobs, new Set(['d1']), summer).slug, 'deck');
  assert.equal(pickPastJob(jobs, new Set(), winter).slug, 'kitchen');
  const sameWeek = new Date(summer.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(pickPastJob(jobs, new Set(), summer).slug, pickPastJob(jobs, new Set(), sameWeek).slug);
  assert.equal(pickPastJob([job('a', 'Kitchen', 'Kitchen', ['x'])], new Set(['x']), summer), null);
});
