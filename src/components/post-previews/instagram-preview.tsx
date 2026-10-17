import Image from "next/image";

import type { PreviewPhoto } from "./types";

type InstagramPreviewProps = {
  caption: string;
  photos: PreviewPhoto[];
};

export function InstagramPreview({
  caption,
  photos,
}: InstagramPreviewProps) {
  const previewPhoto = photos.find((photo) => photo.url.trim().length > 0);

  return (
    <article className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900">
      <header className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#b4411b] text-sm font-semibold text-white">
          RP
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">rhipros</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          Not connected
        </span>
      </header>

      {previewPhoto ? (
        <Image
          src={previewPhoto.url}
          alt={previewPhoto.description || "Instagram post preview"}
          width={600}
          height={600}
          unoptimized
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-sm font-medium text-slate-500">
          Photo
        </div>
      )}

      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2" aria-label="Post actions">
          <button
            type="button"
            disabled
            aria-label="Like unavailable"
            className="flex size-9 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 text-xl text-slate-400"
          >
            ♡
          </button>
          <button
            type="button"
            disabled
            aria-label="Comment unavailable"
            className="flex size-9 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 text-lg text-slate-400"
          >
            ◯
          </button>
          <button
            type="button"
            disabled
            aria-label="Share unavailable"
            className="flex size-9 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 text-lg text-slate-400"
          >
            ↗
          </button>
        </div>

        <p
          className={`whitespace-pre-wrap text-sm ${
            caption ? "text-slate-800" : "text-slate-500"
          }`}
        >
          {caption || "Instagram caption will appear here."}
        </p>

        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          Preview only. Instagram is not connected, so this card is not sent.
        </p>
      </div>
    </article>
  );
}
