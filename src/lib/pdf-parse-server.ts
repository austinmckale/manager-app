import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PdfParseStatic = {
  setWorker?: (workerSrc: string) => void;
  new (options: { data: ArrayBuffer | Buffer | Uint8Array }): {
    getText: () => Promise<{ text?: string }>;
    destroy: () => Promise<void>;
  };
};

let workerConfigured = false;

function resolvePdfWorkerSrc() {
  const root = process.cwd();
  const candidates = [
    path.join(root, "node_modules", "pdf-parse", "dist", "pdf-parse", "cjs", "pdf.worker.mjs"),
    path.join(root, "node_modules", "pdf-parse", "dist", "pdf-parse", "esm", "pdf.worker.mjs"),
  ];
  const workerPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
  if (!workerPath) return null;

  return pathToFileURL(workerPath).href;
}

function configurePdfWorker(PDFParse: PdfParseStatic) {
  if (workerConfigured) return;
  if (typeof PDFParse.setWorker !== "function") return;

  const workerSrc = resolvePdfWorkerSrc();
  if (!workerSrc) return;

  PDFParse.setWorker(workerSrc);
  workerConfigured = true;
}

export async function extractPdfText(data: ArrayBuffer | Buffer | Uint8Array) {
  const pdfParseModule = await import("pdf-parse");
  const PDFParse = pdfParseModule.PDFParse as PdfParseStatic;
  configurePdfWorker(PDFParse);

  const parser = new PDFParse({ data });
  try {
    const extracted = await parser.getText();
    return extracted.text ?? "";
  } finally {
    await parser.destroy();
  }
}
