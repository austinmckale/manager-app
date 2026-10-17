import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/lib/publishing/buffer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require, AbortSignal, fetch: async () => { throw Error('Unexpected network'); } });
test('Buffer setup discovers permitted channels using only read queries, never publishing content', async () => {
  const calls = [];
  const result = await exports.discoverBufferChannels('synthetic-key', async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(url, 'https://api.buffer.com'); assert.equal(init.headers.Authorization, 'Bearer synthetic-key'); assert.equal(init.cache, 'no-store');
    return Response.json(body.query.includes('RhiOrganizations') ? { data: { account: { organizations: [{ id: 'org', name: 'RHI' }] } } } : { data: { channels: [
      { id: 'fb', name: 'RHI', displayName: 'RHI Pros', service: 'facebook', isQueuePaused: false },
      { id: 'other', name: 'Other', displayName: null, service: 'twitter', isQueuePaused: false },
    ] } });
  });
  assert.equal(result.length, 1); assert.equal(result[0].id, 'fb');
  assert.equal(calls.length, 2); assert.ok(calls.every((call) => call.query.startsWith('query ')));
  assert.ok(!JSON.stringify(result).includes('synthetic-key'));
  assert.equal(calls[1].variables.organizationId, 'org');
});
test('missing keys and failed or partial GraphQL results never claim a working connection', async () => {
  await assert.rejects(exports.discoverBufferChannels(''), /BUFFER_API_KEY/);
  for (const response of [Response.json({}, { status: 401 }), Response.json({ data: {}, errors: [{ message: 'private provider detail' }] }), Response.json({ data: {} })]) {
    await assert.rejects(exports.discoverBufferChannels('synthetic-key', async () => response));
  }
});
