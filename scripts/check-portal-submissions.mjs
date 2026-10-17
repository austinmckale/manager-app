import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require() { throw new Error('Unexpected import'); } });
  return exports;
}
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('portal submission status stays received or voice processing', () => {
  const { portalSubmissionStatus } = load('src/lib/portal-submission.ts');
  assert.equal(portalSubmissionStatus({ voicePending: false }), 'Received');
  assert.equal(portalSubmissionStatus({ voicePending: true }), 'Processing your voice note');
  const shown = [portalSubmissionStatus({ voicePending: false }), portalSubmissionStatus({ voicePending: true })].join(' ');
  for (const word of ['draft', 'caption', 'publish', 'Ready to post', 'Content ready']) assert.equal(shown.includes(word), false);
});

test('portal screens do not render finished packs, captions or marketing reports', () => {
  const files = [
    'src/app/portal/page.tsx',
    'src/app/portal/jobs/page.tsx',
    'src/app/portal/jobs/[submissionId]/page.tsx',
    'src/app/portal/packs/[packId]/page.tsx',
    'src/app/portal/reports/page.tsx',
  ].map(source).join('\n');
  for (const needle of ['CrewFinishedPack', 'availableMembershipPacks', 'View prepared content', 'Ready to post', 'Content ready', 'reportsHref', 'packBase']) assert.equal(files.includes(needle), false);
  assert.match(source('src/app/portal/page.tsx'), /showReports=\{false\}/);
  assert.match(source('src/app/portal/packs/[packId]/page.tsx'), /notFound\(\)/);
  assert.match(source('src/app/portal/packs/[packId]/photos/[photoId]/route.ts'), /status: 404/);
});
