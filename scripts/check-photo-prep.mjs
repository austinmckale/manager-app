import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (id) => require(id),
    Buffer,
    Uint8Array,
    Array,
    Object,
    Error,
    Math,
    Number,
    String,
    Set,
    Map,
    JSON,
    Date,
    Promise,
    console,
  });
  return exports;
}

const prep = load("src/lib/photo-prep.ts");
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);
const settings = { sourceId: "source-1", bytes, presetId: "1:1", exposure: 0.05, contrast: 0.04 };

test("original hash preserved in the result", () => {
  const before = Buffer.from(bytes);
  const result = prep.planPhotoPrep(settings);
  assert.equal(result.originalSha256, prep.sha256Bytes(bytes));
  assert.equal(result.originalByteLength, bytes.length);
  assert.deepEqual(bytes, before);
  assert.equal(result.replacesOriginal, false);
});

test("GPS/public metadata policy is strip", () => {
  const result = prep.planPhotoPrep(settings);
  const decision = prep.assessPhotoPrepSafety(settings);
  assert.equal(result.publicMetadataPolicy, "strip");
  assert.equal(result.gpsExifPolicy, "strip");
  assert.equal(result.metadataStripped, true);
  assert.equal(decision.publicMetadataPolicy, "strip");
  assert.equal(decision.gpsExifPolicy, "strip");
});

test("same input and settings reuse one derivative id", () => {
  const first = prep.planPhotoPrep(settings);
  const second = prep.planPhotoPrep({ ...settings, note: "do not publish" });
  const sameBytesOtherSource = prep.planPhotoPrep({ ...settings, sourceId: "source-2" });
  const otherPreset = prep.planPhotoPrep({ ...settings, presetId: "landscape" });
  assert.equal(second.derivativeId, first.derivativeId);
  assert.equal(sameBytesOtherSource.derivativeId, first.derivativeId);
  assert.equal(sameBytesOtherSource.originalSha256, first.originalSha256);
  assert.notEqual(otherPreset.derivativeId, first.derivativeId);
  assert.equal(first.derivativeId, prep.derivativeIdFor(first.originalSha256, first.preset, first.exposure, first.contrast));
});

test("oversize and corrupt input are rejected", () => {
  const oversize = prep.assessPhotoPrepSafety({ ...settings, bytes: Buffer.alloc(prep.PHOTO_PREP_MAX_BYTES + 1) });
  assert.equal(oversize.ok, false);
  assert.equal(oversize.code, "oversize");
  assert.match(oversize.message, new RegExp(String(prep.PHOTO_PREP_MAX_BYTES)));
  assert.match(oversize.message, /limit/i);
  assert.throws(() => prep.planPhotoPrep({ ...settings, bytes: Buffer.alloc(prep.PHOTO_PREP_MAX_BYTES + 1) }), /limit/i);
  const corrupt = prep.assessPhotoPrepSafety({ ...settings, bytes: Buffer.from([1, 2, 3, 4, 5]) });
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.code, "corrupt");
  assert.match(corrupt.message, /corrupt/i);
  assert.throws(() => prep.planPhotoPrep({ ...settings, bytes: Buffer.alloc(0) }), /corrupt/i);
  assert.throws(() => prep.decodePhotoPayload("https://example.com/job.jpg"), /Remote image URLs are not accepted/);
  assert.throws(() => prep.decodePhotoPayload("A".repeat(prep.PHOTO_PREP_MAX_BASE64_CHARS + 8)), /limit/i);
});

test("result.approved is not true and result.published is not true", () => {
  const result = prep.planPhotoPrep({ ...settings, approved: true, published: true, unblocked: true });
  assert.notEqual(result.approved, true);
  assert.notEqual(result.published, true);
  assert.notEqual(result.unblocked, true);
  assert.equal(result.approved, false);
  assert.equal(result.published, false);
  assert.equal(result.unblocked, false);
});

test("do-not-publish note does not flip those flags", () => {
  const result = prep.planPhotoPrep({ ...settings, note: "do not publish", approved: true, published: true, unblocked: true });
  assert.equal(result.note, "do not publish");
  assert.notEqual(result.approved, true);
  assert.notEqual(result.published, true);
  assert.notEqual(result.unblocked, true);
  assert.equal(result.derivativeId, prep.planPhotoPrep(settings).derivativeId);
});

test("crop presets are configurable and generative edits are rejected", () => {
  const custom = prep.planPhotoPrep({
    sourceId: "source-1",
    bytes,
    presetId: "wide",
    presets: [{ id: "wide", label: "Wide", width: 2, height: 1 }],
    exposure: 0,
    contrast: 0,
  });
  assert.equal(custom.presetId, "wide");
  assert.equal(prep.assessPhotoPrepSafety({ ...settings, presetId: "4:5", presets: [{ id: "wide", label: "Wide", width: 2, height: 1 }] }).ok, false);
  const unsafe = prep.assessPhotoPrepSafety({ ...settings, operations: ["replace-sky"] });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.message, /cannot add, remove, or invent/i);
  assert.notEqual(unsafe.approved, true);
  assert.notEqual(unsafe.published, true);
  const box = prep.centerCropBox(100, 100, 4, 5);
  assert.ok(box.left >= 0 && box.top >= 0);
  assert.ok(box.left + box.width <= 100);
  assert.ok(box.top + box.height <= 100);
});

let sharpFactory = null;
try {
  sharpFactory = require("sharp");
} catch {
  sharpFactory = null;
}

test("sharp public derivative strips metadata", { skip: !sharpFactory }, async () => {
  const sharp = sharpFactory;
  const input = await sharp({
    create: { width: 32, height: 48, channels: 3, background: { r: 12, g: 80, b: 140 } },
  }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "GPS 40.0", ImageDescription: "GPSLatitude" } } }).toBuffer();
  const before = Buffer.from(input);
  const inputMeta = await sharp(input).metadata();
  assert.ok(inputMeta.exif);
  const plan = prep.planPhotoPrep({ sourceId: "sharp-sample", bytes: input, presetId: "1:1", exposure: 0, contrast: 0 });
  const output = await prep.renderConservativePreview(input, plan, async () => sharp);
  const outputMeta = await sharp(output).metadata();
  assert.equal(outputMeta.exif, undefined);
  assert.equal(outputMeta.width, outputMeta.height);
  assert.deepEqual(input, before);
  assert.equal(plan.originalSha256, prep.sha256Bytes(input));
  assert.equal(plan.publicMetadataPolicy, "strip");
  assert.notEqual(output.equals(input), true);
});
