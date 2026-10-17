import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { workerSummary, workerFailure, workerCheckState } from './marketing-worker-result.mjs';
const require = createRequire(import.meta.url);

test('busy checks preserve failures and last actual successful processing time', () => {
  const previous = { failures: 49, lastSuccessAt: 'previous', lastResult: workerSummary('{"busy":true}'), issue: null };
  const busy = workerCheckState(previous, 'now');
  assert.equal(busy.state, 'waiting');
  assert.equal(busy.failures, 49);
  assert.equal(busy.lastSuccessAt, 'previous');
  const success = workerCheckState({ ...previous, lastResult: { generated: false, transcribed: 0 } }, 'now');
  assert.equal(success.state, 'idle');
  assert.equal(success.failures, 0);
  assert.equal(success.lastSuccessAt, 'now');
  const failed = workerCheckState({ ...previous, issue: 'timeout' }, 'now');
  assert.equal(failed.state, 'retrying');
  assert.equal(failed.failures, 50);
  assert.equal(failed.lastSuccessAt, 'previous');
});

test('worker status never preserves arbitrary output, private URLs or error details', () => {
  const secret = 'https://private.invalid/secret-token';
  assert.deepEqual(workerSummary(JSON.stringify({ transcribed: 1, generated: true, url: secret, notes: secret })), { transcribed: 1, transcriptionFailed: 0, generated: true, reviewed: false, reviewFailed: false });
  assert.throws(() => workerSummary('{}'));
  for (const error of ['TimeoutError', 'Local transcription unavailable', 'private storage', 'P1001', 'unknown']) assert.ok(!workerFailure(error + secret).includes(secret));
  assert.match(workerFailure('The operation was aborted due to timeout'), /timed out/);
});

function recorderHarness({ denied = false, constructorFails = false } = {}) {
  let cleanup;
  let resolveMedia;
  let calls = 0;
  let stopped = 0;
  const recordingChanges = [];
  const track = { stop: () => stopped++ };
  const media = { getTracks: () => [track] };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { if (constructorFails) throw new Error('Unsupported recording'); this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  const react = { useEffect: (fn) => { cleanup = fn(); }, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/crew-voice-note.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id) => id === 'react' ? react : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : require(id), navigator: { mediaDevices: { getUserMedia: () => { calls++; return new Promise((resolve, reject) => { resolveMedia = () => denied ? reject(new Error('Denied')) : resolve(media); }); } } }, window: { MediaRecorder: Recorder }, MediaRecorder: Recorder, setTimeout: () => 1, clearTimeout() {}, Blob });
  const tree = exports.CrewVoiceRecorder({ disabled: false, onChange() {}, onRecordingChange: (value) => recordingChanges.push(value) });
  const button = tree.props.children.find((child) => child?.type === 'button');
  return { click: () => button.props.onClick(), settle: async () => { resolveMedia(); await new Promise((done) => setImmediate(done)); }, cleanup: () => cleanup(), calls: () => calls, stopped: () => stopped, recordingChanges };
}

test('repeated recording taps request one microphone and block sending during permission prompt', async () => {
  const h = recorderHarness(); h.click(); h.click();
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.recordingChanges, [true]);
  await h.settle(); h.cleanup();
  assert.equal(h.stopped(), 1);
});

test('microphone denial and recorder construction failure release the send lock and tracks', async () => {
  for (const options of [{ denied: true }, { constructorFails: true }]) {
    const h = recorderHarness(options); h.click(); await h.settle();
    assert.equal(h.recordingChanges.at(-1), false);
    if (options.constructorFails) assert.equal(h.stopped(), 1);
  }
});

test('leaving while microphone permission is pending closes the eventual stream', async () => {
  const h = recorderHarness(); h.click(); h.cleanup(); await h.settle();
  assert.equal(h.stopped(), 1);
});
