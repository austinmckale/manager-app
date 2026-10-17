"use client";
/* eslint-disable @next/next/no-img-element */

import { useId } from "react";

export type LogoPreviewPlacement = {
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: number;
  opacity: number;
  variant: "light" | "dark" | null;
};

type PreviewFrame = { id?: string | null; src?: string | null };

type Props = {
  originalId?: string | null;
  enhancedId?: string | null;
  brandedId?: string | null;
  originalSrc?: string | null;
  enhancedSrc?: string | null;
  brandedSrc?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  prompt?: string | null;
  canPublish?: boolean;
  placement?: LogoPreviewPlacement | null;
  onPlacementChange?: (placement: LogoPreviewPlacement) => void;
};

const corners = [
  ["top-left", "Top left"],
  ["top-right", "Top right"],
  ["bottom-left", "Bottom left"],
  ["bottom-right", "Bottom right"],
] as const;

const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

function choiceClass(selected: boolean, disabled: boolean) {
  const state = disabled ? "border-slate-200 bg-slate-50 text-slate-500" : selected ? "border-teal-800 bg-teal-50 text-slate-950" : "border-slate-300 bg-white text-slate-900";
  return `flex min-h-11 flex-col items-start rounded-xl border px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed ${state}`;
}

function PreviewButton({ label, frame, selectedId, noteId, onSelect }: { label: "Original" | "Enhanced" | "Branded"; frame: PreviewFrame; selectedId?: string | null; noteId: string; onSelect?: (id: string) => void }) {
  const id = frame.id?.trim() ?? "";
  const disabled = !id;
  const selected = !disabled && selectedId === id;
  return <button type="button" aria-pressed={selected} aria-describedby={noteId} disabled={disabled} onClick={() => { if (id) onSelect?.(id); }} className={choiceClass(selected, disabled)}>
    <span className="text-sm font-semibold">{label}</span>
    {frame.src ? <img src={frame.src} alt="" className="mt-2 h-24 w-full rounded-lg object-contain" /> : null}
  </button>;
}

export function LogoOverlayPreview({ originalId, enhancedId, brandedId, originalSrc, enhancedSrc, brandedSrc, selectedId, onSelect, prompt, canPublish = true, placement, onPlacementChange }: Props) {
  const noteId = useId();
  const promptId = useId();
  const current: LogoPreviewPlacement = {
    position: placement?.position ?? "bottom-right",
    size: placement?.size ?? 0.12,
    opacity: placement?.opacity ?? 0.9,
    variant: placement?.variant ?? null,
  };
  const locked = !onPlacementChange;

  function change(next: Partial<LogoPreviewPlacement>) {
    onPlacementChange?.({ ...current, ...next });
  }

  return <section aria-label="Optional logo overlay" className="rounded-2xl border border-slate-300 bg-white p-4">
    <p className="text-sm font-semibold text-slate-950">Optional logo</p>
    <p className="mt-1 text-sm text-slate-700">The logo is added after enhance and crop, in a quiet corner with padding.</p>
    <div role="group" aria-label="Photo previews" className="mt-3 grid gap-2 sm:grid-cols-3">
      <PreviewButton label="Original" frame={{ id: originalId, src: originalSrc }} selectedId={selectedId} noteId={noteId} onSelect={onSelect} />
      <PreviewButton label="Enhanced" frame={{ id: enhancedId, src: enhancedSrc }} selectedId={selectedId} noteId={noteId} onSelect={onSelect} />
      <PreviewButton label="Branded" frame={{ id: brandedId, src: brandedSrc }} selectedId={selectedId} noteId={noteId} onSelect={onSelect} />
    </div>
    <p id={noteId} className="mt-3 text-sm text-slate-800">Choosing a preview does not approve or publish.</p>
    {prompt ? <p id={promptId} role="status" className="mt-2 text-sm font-medium text-slate-950">{prompt}</p> : null}
    {canPublish ? null : <p className="mt-2 text-sm text-slate-800">Publication stays blocked.</p>}
    <fieldset aria-describedby={prompt ? promptId : undefined} className="mt-4 grid gap-3 sm:grid-cols-2">
      <legend className="text-sm font-semibold text-slate-950">Placement</legend>
      <label className="block text-sm font-medium text-slate-800">Position
        <select disabled={locked} value={current.position} onChange={(event) => change({ position: event.target.value as LogoPreviewPlacement["position"] })} className={field}>
          {corners.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">Light or dark logo
        <select disabled={locked} value={current.variant ?? ""} onChange={(event) => change({ variant: event.target.value === "light" || event.target.value === "dark" ? event.target.value : null })} className={field}>
          <option value="">Choose light or dark</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">Size <span className="font-normal text-slate-600">{Math.round(current.size * 100)}%</span>
        <input disabled={locked} type="range" min={8} max={30} step={1} value={Math.round(current.size * 100)} onChange={(event) => change({ size: Number(event.target.value) / 100 })} className="mt-2 w-full" />
      </label>
      <label className="block text-sm font-medium text-slate-800">Opacity <span className="font-normal text-slate-600">{Math.round(current.opacity * 100)}%</span>
        <input disabled={locked} type="range" min={20} max={100} step={1} value={Math.round(current.opacity * 100)} onChange={(event) => change({ opacity: Number(event.target.value) / 100 })} className="mt-2 w-full" />
      </label>
    </fieldset>
    <p className="mt-3 text-xs text-slate-600">Processing order: original, enhance, crop, logo.</p>
  </section>;
}
