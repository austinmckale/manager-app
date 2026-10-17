import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

function load(file) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === "react" || name === "react/jsx-runtime" || name === "react/jsx-dev-runtime" || name === "node:crypto") return nodeRequire(name);
      if (name === "@/lib/publishability") return publishability;
      throw new Error(`Unmocked import: ${name}`);
    },
  }, { filename: file });
  return exports;
}

const publishability = load("src/lib/publishability.ts");
const overlay = load("src/lib/logo-overlay.ts");
const preview = load("src/components/logo-overlay-preview.tsx");

function ready(extra = {}) {
  return {
    sourceHash: "source-hash-patio",
    originalDerivativeId: "original-1",
    enhancedDerivativeId: "enhanced-1",
    croppedDerivativeId: "crop-1",
    unbrandedDerivativeId: "crop-1",
    brandingEnabled: true,
    logoAssetId: "logo-asset-1",
    crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
    contrast: "dark",
    notes: "Paver patio in Reading.",
    ...extra,
  };
}

function assertNeverApproved(result) {
  const stack = [result];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if ((key === "approved" || key === "published") && value === true) assert.fail(`${key} is true`);
      if (value && typeof value === "object") stack.push(value);
    }
  }
  assert.equal(result.approved, false);
  assert.equal(result.published, false);
  assert.equal(result.overwritesOriginal, false);
  assert.equal(result.logoBytes, null);
  assert.equal(result.findings.length, 0);
}

test("no logo file does not block", () => {
  const result = overlay.planLogoOverlay(ready({
    brandingEnabled: true,
    logoAssetId: "",
    notes: "Finished the patio. No company logo was in the photo.",
  }));
  assert.equal(result.canPublish, true);
  assert.equal(result.status, "needs_logo");
  assert.equal(result.selectedAssetId, "crop-1");
  assert.equal(result.brandedDerivativeId, null);
  assert.equal(result.prompt, overlay.UPLOAD_LOGO_PROMPT);
  assert.equal(JSON.stringify(result).toLowerCase().includes("missing logo"), false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("missing-logo"), false);
  assertNeverApproved(result);
});

test("branding off keeps the unbranded id", () => {
  const result = overlay.planLogoOverlay(ready({ brandingEnabled: false, logoAssetId: "logo-asset-1" }));
  assert.equal(result.status, "unbranded");
  assert.equal(result.selectedAssetId, "crop-1");
  assert.equal(result.brandedDerivativeId, null);
  assert.equal(result.branded, null);
  assert.equal(result.prompt, null);
  assert.equal(result.canPublish, true);
  assertNeverApproved(result);
});

test("branding on with a logo asset id creates a different derivative id linked to the same source hash", () => {
  const result = overlay.planLogoOverlay(ready());
  assert.equal(result.status, "branded_preview");
  assert.ok(result.brandedDerivativeId);
  assert.notEqual(result.brandedDerivativeId, "crop-1");
  assert.notEqual(result.brandedDerivativeId, "original-1");
  assert.equal(result.selectedAssetId, result.brandedDerivativeId);
  assert.equal(result.sourceHash, "source-hash-patio");
  assert.equal(result.branded.sourceHash, "source-hash-patio");
  assert.equal(result.appliedToDerivativeId, "crop-1");
  assert.equal(result.processingOrder.join(","), "original,enhance,crop,logo");
  assert.equal(result.stages.map((stage) => stage.stage).join(","), "original,enhance,crop,logo");
  assert.equal(result.stages[3].derivativeId, result.brandedDerivativeId);
  assert.equal(result.branded.placement.position, "bottom-right");
  assert.equal(result.branded.placement.padding, overlay.DEFAULT_LOGO_PLACEMENT.padding);
  assert.equal(result.branded.placement.variant, "light");
  assert.equal("originalBytes" in result, false);
  assertNeverApproved(result);
});

test("crop change changes the branded id", () => {
  const first = overlay.planLogoOverlay(ready());
  const cropped = overlay.planLogoOverlay(ready({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }));
  assert.notEqual(first.brandedDerivativeId, cropped.brandedDerivativeId);
  assert.equal(first.sourceHash, cropped.sourceHash);
  assert.equal(first.branded.logoAssetId, cropped.branded.logoAssetId);
  assertNeverApproved(cropped);
});

test("same source hash, crop, and logo settings reuse one branded id", () => {
  const first = overlay.planLogoOverlay(ready());
  const second = overlay.planLogoOverlay(ready());
  const resized = overlay.planLogoOverlay(ready({ size: 0.2 }));
  assert.equal(first.brandedDerivativeId, second.brandedDerivativeId);
  assert.notEqual(first.brandedDerivativeId, resized.brandedDerivativeId);
});

test("unknown contrast asks for manual placement", () => {
  const result = overlay.planLogoOverlay(ready({ contrast: "unknown", variant: null }));
  assert.equal(result.status, "needs_manual_placement");
  assert.equal(result.brandedDerivativeId, null);
  assert.equal(result.selectedAssetId, "crop-1");
  assert.equal(result.prompt, overlay.MANUAL_PLACEMENT_PROMPT);
  const chosen = overlay.planLogoOverlay(ready({ contrast: "unknown", variant: "dark", position: "top-left" }));
  assert.equal(chosen.status, "branded_preview");
  assert.equal(chosen.branded.placement.variant, "dark");
  assert.equal(chosen.branded.placement.position, "top-left");
  assert.equal(chosen.branded.placement.manual, true);
  assert.notEqual(chosen.brandedDerivativeId, "crop-1");
});

test("test/do-not-publish note leaves canPublish false", () => {
  const result = overlay.planLogoOverlay(ready({
    notes: "TEST\nDo not publish this photo.",
  }));
  assert.equal(result.canPublish, false);
  assert.ok(result.brandedDerivativeId);
  assert.notEqual(result.brandedDerivativeId, "crop-1");
  assert.equal(result.approved, false);
  assert.equal(result.published, false);
  assertNeverApproved(result);
});

test("result has no approved true", () => {
  const result = overlay.planLogoOverlay(ready({ approved: true, published: true, originalBytes: Buffer.from("original-photo-bytes"), logoBytes: Buffer.from("fake-logo") }));
  assert.equal(result.approved, false);
  assert.equal(result.published, false);
  assert.equal(result.branded.approved, false);
  assert.equal(result.branded.published, false);
  assert.equal(result.logoBytes, null);
  assert.equal(JSON.stringify(result).includes("original-photo-bytes"), false);
  assert.equal(JSON.stringify(result).includes("fake-logo"), false);
  assertNeverApproved(result);
});

test("preview labels say choosing one does not approve or publish", () => {
  const html = renderToStaticMarkup(createElement(preview.LogoOverlayPreview, {
    originalId: "original-1",
    enhancedId: "enhanced-1",
    brandedId: "branded-1",
    selectedId: "enhanced-1",
    prompt: overlay.UPLOAD_LOGO_PROMPT,
    canPublish: false,
  }));
  assert.equal(html.includes("Original"), true);
  assert.equal(html.includes("Enhanced"), true);
  assert.equal(html.includes("Branded"), true);
  assert.equal(html.includes("Choosing a preview does not approve or publish."), true);
  assert.equal(html.includes("Publication stays blocked."), true);
  assert.equal(html.includes(overlay.UPLOAD_LOGO_PROMPT), true);
  assert.equal(html.includes("approved=\"true\""), false);
  assert.equal(html.includes(">Approved<"), false);
  const unbranded = renderToStaticMarkup(createElement(preview.LogoOverlayPreview, {
    originalId: "original-1",
    enhancedId: "enhanced-1",
    brandedId: null,
    selectedId: "crop-1",
  }));
  assert.equal(unbranded.includes("Branded"), true);
  assert.equal(unbranded.includes("Choosing a preview does not approve or publish."), true);
});
