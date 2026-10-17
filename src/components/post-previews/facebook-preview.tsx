/* eslint-disable @next/next/no-img-element */

import type { PreviewPhoto } from "./types";

type FacebookPreviewProps = {
  caption: string;
  photos: PreviewPhoto[];
};

function jobPhotos(photos: PreviewPhoto[]): PreviewPhoto[] {
  return photos.filter((photo) => photo.url.trim()).slice(0, 10);
}

function PhotoTile({
  photo,
  overlay,
  className = "",
}: {
  photo: PreviewPhoto;
  overlay?: number;
  className?: string;
}) {
  const alt = photo.description.trim() || "Job photo";
  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <img src={photo.url} alt={alt} className="h-full w-full object-cover" />
      {overlay != null && overlay > 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-2xl font-semibold text-white">
          +{overlay}
        </div>
      ) : null}
    </div>
  );
}

function PhotoLayout({ photos }: { photos: PreviewPhoto[] }) {
  const count = photos.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <div className="aspect-[4/3] w-full">
        <PhotoTile photo={photos[0]} className="h-full w-full" />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {photos.map((photo) => (
          <PhotoTile key={photo.id} photo={photo} className="aspect-square" />
        ))}
      </div>
    );
  }

  const mosaic = photos.slice(0, 4);
  const extra = count > 4 ? count - 4 : 0;

  if (count === 3) {
    return (
      <div className="grid h-64 grid-cols-2 grid-rows-2 gap-0.5">
        <PhotoTile photo={mosaic[0]} className="row-span-2 h-full" />
        <PhotoTile photo={mosaic[1]} className="h-full" />
        <PhotoTile photo={mosaic[2]} className="h-full" />
      </div>
    );
  }

  return (
    <div className="grid h-64 grid-cols-2 grid-rows-2 gap-0.5">
      <PhotoTile photo={mosaic[0]} className="h-full" />
      <PhotoTile photo={mosaic[1]} className="h-full" />
      <PhotoTile photo={mosaic[2]} className="h-full" />
      <PhotoTile photo={mosaic[3]} className="h-full" overlay={extra} />
    </div>
  );
}

export function FacebookPreview({ caption, photos }: FacebookPreviewProps) {
  const visible = jobPhotos(photos);
  const captionText = caption.trim();

  return (
    <article
      aria-label="Facebook post preview"
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
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">RHI Pros</p>
          <p className="text-xs text-slate-500">Just now · Preview</p>
        </div>
      </header>

      <div className="px-4 pb-3">
        {captionText ? (
          <p className="whitespace-pre-wrap text-sm text-slate-900">{caption}</p>
        ) : (
          <p className="text-sm text-slate-400">Facebook caption will appear here.</p>
        )}
      </div>

      {visible.length > 0 ? (
        <div className="border-y border-slate-100">
          <PhotoLayout photos={visible} />
        </div>
      ) : null}

      <div className="flex border-b border-slate-100 px-2 py-1" aria-hidden>
        {(["Like", "Comment", "Share"] as const).map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-slate-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {label}
          </button>
        ))}
      </div>

      <p className="px-4 py-3 text-xs leading-relaxed text-slate-500">
        Facebook preview. Saving and approving still happen below. Nothing is posted from this card.
      </p>
    </article>
  );
}
