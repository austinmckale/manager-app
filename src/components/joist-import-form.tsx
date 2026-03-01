"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { importJoistCsvAction } from "@/app/(app)/actions";

type PreparedJoistEntry = {
  kind: "pdf" | "csv";
  fileName: string;
  text: string;
};

async function extractPdfTextInBrowser(file: File) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    version: string;
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (input: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (num: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }> }> };
  };

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  const arrayBuffer = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let output = "";

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = "";
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      const value = (item.str ?? "").trim();
      if (value) {
        if (currentLine) currentLine += " ";
        currentLine += value;
      }
      if (item.hasEOL && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    const pageText = lines.join("\n").trim();
    if (pageText) output += `${pageText}\n`;
  }

  return output.trim();
}

export function JoistImportForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitFormRef = useRef<HTMLFormElement>(null);
  const shouldSubmitRef = useRef(false);

  const [pending, setPending] = useState(false);
  const [preparedPayload, setPreparedPayload] = useState("");
  const [statusText, setStatusText] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("No file chosen");

  useEffect(() => {
    if (!preparedPayload || !shouldSubmitRef.current) return;
    shouldSubmitRef.current = false;
    if (submitFormRef.current?.requestSubmit) {
      submitFormRef.current.requestSubmit();
    } else {
      submitFormRef.current?.submit();
    }
  }, [preparedPayload]);

  async function handlePrepareSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const files = Array.from(fileInputRef.current?.files ?? []);
      if (files.length === 0) {
        setStatusText("Select at least one Joist CSV or PDF file.");
        return;
      }

      setPending(true);
      setStatusText("Preparing files for import...");
      const prepared: PreparedJoistEntry[] = [];
      const notices: string[] = [];

      for (const file of files) {
        const lowerName = file.name.toLowerCase();
        const isPdf = lowerName.endsWith(".pdf") || file.type.includes("pdf");
        const isCsv = lowerName.endsWith(".csv") || file.type.includes("csv") || file.type.includes("text/plain");

        if (!isPdf && !isCsv) {
          notices.push(`Skipped ${file.name}: unsupported file type.`);
          continue;
        }

        if (isCsv) {
          const text = await file.text();
          prepared.push({ kind: "csv", fileName: file.name, text: text.slice(0, 2_000_000) });
          continue;
        }

        try {
          const text = await extractPdfTextInBrowser(file);
          prepared.push({ kind: "pdf", fileName: file.name, text: text.slice(0, 2_000_000) });
        } catch (error) {
          notices.push(`PDF parse failed in browser for ${file.name}; using filename fallback.`);
          prepared.push({ kind: "pdf", fileName: file.name, text: "" });
          if (error instanceof Error && error.message) {
            // Keep status concise for operators.
            setStatusText(`Preparing files for import... ${error.message.slice(0, 120)}`);
          }
        }
      }

      if (prepared.length === 0) {
        setPending(false);
        setStatusText(notices[0] ?? "No valid files to import.");
        return;
      }

      shouldSubmitRef.current = true;
      setPending(false);
      setPreparedPayload(JSON.stringify(prepared));
      setStatusText(notices.length > 0 ? notices[0] : "Uploading prepared import...");
    } catch (error) {
      setPending(false);
      setStatusText(error instanceof Error ? error.message : "Failed to prepare Joist files.");
    }
  }

  function handleChooseFiles() {
    fileInputRef.current?.click();
  }

  function handleFilesChanged() {
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      setSelectedLabel("No file chosen");
      return;
    }
    if (files.length === 1) {
      setSelectedLabel(files[0]?.name ?? "1 file selected");
      return;
    }
    setSelectedLabel(`${files.length} files selected`);
  }

  return (
    <>
      <form onSubmit={handlePrepareSubmit} className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,.pdf,application/pdf"
          multiple
          onChange={handleFilesChanged}
          className="sr-only"
        />
        <input
          type="text"
          readOnly
          value={selectedLabel}
          onClick={handleChooseFiles}
          className="min-w-0 w-full cursor-pointer rounded-xl border border-emerald-300 px-3 py-2 text-sm text-slate-700"
        />
        <button
          type="button"
          onClick={handleChooseFiles}
          className="w-full whitespace-nowrap rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 md:w-auto"
        >
          Choose Files
        </button>
        <button
          type="submit"
          disabled={pending}
          className="w-full whitespace-nowrap rounded-xl border border-emerald-400 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 md:col-span-2 md:w-auto"
        >
          {pending ? "Preparing..." : "Import Joist Files"}
        </button>
      </form>

      {statusText ? <p className="mt-2 text-xs text-emerald-900">{statusText}</p> : null}

      <form ref={submitFormRef} action={importJoistCsvAction} className="hidden">
        <input type="hidden" name="preparedJoistPayload" value={preparedPayload} readOnly />
      </form>
    </>
  );
}
