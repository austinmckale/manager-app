/* eslint-disable @next/next/no-img-element */

import type { PreviewPhoto } from "./types";

type MetaAdPreviewProps = {
  primary: string;
  headline: string;
  imageHeadline: string;
  landingUrl: string;
  photos: PreviewPhoto[];
};

function landingHost(landingUrl: string): string {
  try {
    const parsed = new URL(landingUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname;
    }
  } catch {
    // Invalid or non-http values stay on the default host.
  }
  return "rhipros.com";
}

export function MetaAdPreview({
  primary,
  headline,
  imageHeadline,
  landingUrl,
  photos,
}: MetaAdPreviewProps) {
  const primaryText = primary.trim();
  const overlay = imageHeadline.trim();
  const photo = photos.find((item) => item.url.trim());
  const host = landingHost(landingUrl.trim());

  return (
    <article
      aria-label="Meta ad preview"
      className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: "#b4411b" }}
        >
          RP
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">RHI Pros</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              Sponsored
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
              Ad draft · not running
            </span>
          </div>
        </div>
      </header>

      <div className="px-4 pb-3">
        {primaryText ? (
          <p className="whitespace-pre-wrap text-sm text-slate-900">{primary}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-slate-400">Ad text will appear here.</p>
        )}
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-200">
        {photo ? (
          <img
            src={photo.url}
            alt={photo.description.trim() || "Ad photo"}
            className="h-full w-full object-cover"
          />
        ) : null}
        {overlay ? (
          <p className="absolute inset-x-0 bottom-0 bg-black/55 px-4 py-3 text-lg font-semibold text-white">
            {imageHeadline}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-y border-slate-100 bg-slate-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{headline}</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{host}</p>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Learn more
        </button>
      </div>

      <p className="px-4 py-3 text-xs leading-relaxed text-slate-500">
        Meta ad draft. It is not running and nothing is spent.
      </p>
    </article>
  );
}
