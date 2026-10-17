type GoogleAdPreviewProps = {
  headlines: string[];
  descriptions: string[];
  landingUrl: string;
};

function displayUrlFor(landingUrl: string): string {
  const trimmed = landingUrl.trim();
  if (trimmed === "") return "rhipros.com";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "rhipros.com";
    }

    const path = url.pathname === "/" ? "" : url.pathname;
    if (path === "") return url.host;

    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 1) return `${url.host}${path}`;
    return `${url.host}/${segments[0]}/…`;
  } catch {
    return "rhipros.com";
  }
}

export function GoogleAdPreview({
  headlines,
  descriptions,
  landingUrl,
}: GoogleAdPreviewProps) {
  const headlineLine =
    headlines
      .map((headline) => headline.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ") || "RHI Pros";
  const descriptionLine = descriptions
    .map((description) => description.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  const displayUrl = displayUrlFor(landingUrl);

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-slate-900">
            Ad
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            Ad draft · not running
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
          >
            R
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-900">RHI Pros</p>
            <p className="truncate text-xs text-slate-600">{displayUrl}</p>
          </div>
        </div>

        <p className="mt-2 text-xl leading-snug font-normal text-[#1a0dab]">
          {headlineLine}
        </p>

        {descriptionLine !== "" ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {descriptionLine}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-slate-400">
            Ad description will appear here.
          </p>
        )}
      </div>

      <p className="mt-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        Ad draft. This card is not running and is not sent.
      </p>
    </div>
  );
}
