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
