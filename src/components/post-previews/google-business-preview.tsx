import type { PreviewPhoto } from "./types";

type GoogleBusinessPreviewProps = {
  update: string;
  location: string;
  photos: PreviewPhoto[];
};

export function GoogleBusinessPreview({
  update,
  location,
  photos,
}: GoogleBusinessPreviewProps) {
  const firstPhoto = photos.find((photo) => photo.url.trim() !== "");
  const locationLine = location.trim() !== "" ? location : "Service area";
  const hasUpdate = update.trim() !== "";

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Google Business Profile
        </p>
        <div className="mt-2 flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white"
          >
            R
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              RHI Pros
            </p>
            <p className="truncate text-xs text-slate-500">{locationLine}</p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        {firstPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstPhoto.url}
            alt={firstPhoto.description || "Google Business update photo"}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-slate-200 text-sm font-medium text-slate-500">
            Photo
          </div>
        )}
        {photos.length > 1 ? (
          <p className="px-4 pt-2 text-xs text-amber-700">
            Only the first photo is sent to Google Business.
          </p>
        ) : null}
      </div>

      <div className="px-4 py-3">
        {hasUpdate ? (
          <p className="whitespace-pre-wrap text-sm text-slate-900">{update}</p>
        ) : (
          <p className="text-sm text-slate-400">
            Google Business update will appear here.
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-500 opacity-70"
        >
          Share
        </button>
      </div>

      <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        Google Business preview. Nothing is posted from this card.
      </p>
    </div>
  );
}
