import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, imports) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); }, URL, Buffer, crypto, Date, Set, Map, Response, Request, console: { error() {} } }, { filename: file });
  return exports;
}
const media = load("src/components/post-previews/preview-media.ts", {});

function photo(id, url) {
  return { id, url, description: id };
}

test("empty urls are dropped", () => {
  const photos = [
    photo("blank", ""),
    photo("spaces", "   "),
    photo("kept", "https://example.com/kept.jpg"),
    photo("newline", "\n"),
    photo("also-kept", "https://example.com/also.jpg"),
  ];
  assert.deepEqual(
    media.photosWithUrls(photos).map((item) => item.id),
    ["kept", "also-kept"],
  );
});

test("facebookPhotoSet returns at most 10", () => {
  const photos = [photo("blank", "")];
  for (let index = 0; index < 12; index += 1) {
    photos.push(photo(`photo-${index}`, `https://example.com/${index}.jpg`));
  }
  const set = media.facebookPhotoSet(photos);
  assert.equal(set.length, 10);
  assert.deepEqual(
    set.map((item) => item.id),
    Array.from({ length: 10 }, (_, index) => `photo-${index}`),
  );
});

test("singlePhoto returns the first photo that has a url, or null", () => {
  assert.equal(media.singlePhoto([]), null);
  assert.equal(media.singlePhoto([photo("blank", ""), photo("spaces", "  ")]), null);
  const first = photo("first", "https://example.com/first.jpg");
  assert.deepEqual(
    media.singlePhoto([photo("blank", ""), first, photo("second", "https://example.com/second.jpg")]),
    first,
  );
});
