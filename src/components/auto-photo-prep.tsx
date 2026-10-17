"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogoOverlayPreview } from "@/components/logo-overlay-preview";

type Preset = { id: string; label: string; width: number; height: number };

type PrepResponse = {
  ok?: boolean;
  error?: string;
  originalSha256?: string;
  derivativeId?: string;
  previewDataUrl?: string | null;
  publicMetadataPolicy?: string;
  gpsExifPolicy?: string;
  approved?: boolean;
  published?: boolean;
  unblocked?: boolean;
  stored?: boolean;
  demo?: boolean;
};

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(parts.join(""));
}

export function AutoPhotoPrep({
  demo,
  presets,
  maxBytes,
  exposure,
  contrast,
}: {
  demo: boolean;
  presets: Preset[];
  maxBytes: number;
  exposure: number;
  contrast: number;
}) {
  const fileInputId = useId();
  const presetGroupId = useId();
  const fileUrlRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [derivativeId, setDerivativeId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, []);

  function dropStalePreview() {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPreviewUrl(null);
    setHash("");
    setDerivativeId("");
    setSelectedId("");
    setBusy(false);
  }

  function replaceFile(next: File | null) {
    dropStalePreview();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = next ? URL.createObjectURL(next) : null;
    fileUrlRef.current = url;
    setFile(next);
    setFileUrl(url);
    setPreviewUrl(null);
    setHash("");
    setDerivativeId("");
    setSelectedId("");
    setError("");
    setStatus("");
  }

  async function compare() {
    if (!file || busy) return;
    if (file.size > maxBytes) {
      setPreviewUrl(null);
      setError(`Photo is too large. The limit is ${maxBytes} bytes.`);
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setBusy(true);
    setError("");
    setStatus("Preparing a preview. The original file stays unchanged.");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(`Photo is too large. The limit is ${maxBytes} bytes.`);
      const sourceId = `local-${file.size}-${file.lastModified}`.replace(/[^A-Za-z0-9:_-]/g, "");
      const response = await fetch("/api/marketing/photo-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          imageBase64: bytesToBase64(bytes),
          presetId,
          exposure,
          contrast,
        }),
        signal: controller.signal,
      });
      if (token !== requestRef.current) return;
      const result = await response.json().catch(() => null) as PrepResponse | null;
      if (token !== requestRef.current) return;
      if (result?.approved === true || result?.published === true || result?.unblocked === true) {
        setPreviewUrl(null);
        throw new Error("This preview cannot approve or publish a photo.");
      }
      if (!response.ok || result?.ok === false) {
        const message = typeof result?.error === "string" && result.error.trim() ? result.error : "Photo prep could not finish. The original was not changed.";
        throw new Error(message);
      }
      const dataUrl = typeof result?.previewDataUrl === "string" && result.previewDataUrl.startsWith("data:image/jpeg;base64,") ? result.previewDataUrl : null;
      setPreviewUrl(dataUrl);
      setHash(typeof result?.originalSha256 === "string" ? result.originalSha256 : "");
      setDerivativeId(typeof result?.derivativeId === "string" ? result.derivativeId : "");
      if (demo || result?.demo) {
        setStatus("Demo mode did not write a file. Metadata on a public derivative would be stripped, including GPS. Nothing is approved or published.");
      } else if (dataUrl) {
        setStatus("Auto-enhanced preview is ready. Public metadata, including GPS, is stripped. Choosing this preview does not approve or publish.");
      } else {
        setStatus("The preview plan is ready. No file was written, and nothing is approved or published.");
      }
    } catch (caught) {
      if (token !== requestRef.current) return;
      setPreviewUrl(null);
      if (caught instanceof DOMException && (caught.name === "TimeoutError" || caught.name === "AbortError")) {
        setError("Photo prep did not finish. The original was not changed.");
        setStatus("");
      } else {
        const message = caught instanceof Error ? caught.message : "";
        setError(message && message !== "Failed to fetch" ? message : "Photo prep could not finish. The original was not changed.");
        setStatus("");
      }
    } finally {
      clearTimeout(timeout);
      if (token === requestRef.current) setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void compare(); }}>
      {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Demo mode does not write files. You can still compare the original with the prep plan.</p> : null}
      <p className="max-w-2xl text-sm text-slate-700">EXIF orientation, mild exposure, mild contrast, and a crop preset only. Structures, skies, and damage stay as photographed. The size limit is {maxBytes.toLocaleString("en-US")} bytes.</p>
      <div>
        <label htmlFor={fileInputId} className="text-sm font-semibold">Photo</label>
        <input
          id={fileInputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          className="mt-2 block w-full text-sm"
          onChange={(event) => replaceFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <fieldset>
        <legend id={presetGroupId} className="text-sm font-semibold">Crop preset</legend>
        {presets.length ? (
          <div className="mt-2 flex flex-wrap gap-3" role="radiogroup" aria-labelledby={presetGroupId}>
            {presets.map((preset) => (
              <label key={preset.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
                <input
                  type="radio"
                  name="photo-prep-preset"
                  value={preset.id}
                  checked={presetId === preset.id}
                  onChange={() => { setPresetId(preset.id); dropStalePreview(); setStatus(""); }}
                />
                {preset.label}
              </label>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-slate-600">No crop presets are configured.</p>}
      </fieldset>
      <div>
        <button type="submit" className={buttonClass} disabled={!file || busy || !presetId} aria-busy={busy}>
          {busy ? "Preparing…" : "Compare original"}
        </button>
        <p className="mt-2 text-sm font-semibold text-slate-900">Choosing a preview does not approve or publish.</p>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {status ? <p role="status" className="text-sm text-slate-800">{status}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <figure className="rounded-2xl border bg-white p-3">
          <figcaption className="text-sm font-semibold">Original</figcaption>
          {fileUrl ? <img src={fileUrl} alt="Original" className="mt-3 max-h-96 w-full rounded-xl bg-slate-100 object-contain" /> : <p className="mt-3 text-sm text-slate-600">Choose a photo to compare.</p>}
        </figure>
        <figure className="rounded-2xl border bg-white p-3">
          <figcaption className="text-sm font-semibold">Auto-enhanced</figcaption>
          {previewUrl ? <img src={previewUrl} alt="Auto-enhanced" className="mt-3 max-h-96 w-full rounded-xl bg-slate-100 object-contain" /> : <p className="mt-3 text-sm text-slate-600">The auto-enhanced preview appears here after Compare original.</p>}
        </figure>
      </div>
      {hash ? <p className="break-all text-xs text-slate-500">Original hash {hash}</p> : null}
      {derivativeId ? <p className="break-all text-xs text-slate-500">Derivative {derivativeId}. Public metadata policy: strip.</p> : null}
      {hash && derivativeId ? <LogoOverlayPreview originalId={hash} enhancedId={derivativeId} originalSrc={fileUrl} enhancedSrc={previewUrl} selectedId={selectedId} onSelect={setSelectedId} prompt="Upload a logo file to brand this photo. A missing logo at the job site does not block it." canPublish /> : null}
    </form>
  );
}
