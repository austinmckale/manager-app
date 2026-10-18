"use client"

import { useState } from "react"
import type { PostPreviewDraft, PreviewPhoto } from "./types"
import { FacebookPreview } from "./facebook-preview"
import { GoogleBusinessPreview } from "./google-business-preview"
import { facebookPhotoSet } from "./preview-media"

type Card = "facebook" | "google-business"

const cards: { key: Card; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "google-business", label: "Google Business" },
]

export function PostPreviews({
  draft,
  photos,
}: {
  draft: PostPreviewDraft
  photos: PreviewPhoto[]
}) {
  const [active, setActive] = useState<Card>("facebook")

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">How it will look</h2>
      <p className="text-sm text-slate-600">Nothing is posted. Instagram and the ad cards are not sent.</p>

      <div className="flex flex-wrap gap-2">
        {cards.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`min-h-11 rounded px-3 py-2 text-sm font-medium ${
              active === key
                ? "bg-teal-900 text-white"
                : "border"
            }`}
            onClick={() => setActive(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {active === "facebook" && (
        <FacebookPreview
          caption={draft.social}
          photos={facebookPhotoSet(photos)}
        />
      )}

      {active === "google-business" && (
        <GoogleBusinessPreview
          update={draft.googleBusiness}
          location={draft.publicLocation}
          photos={photos}
        />
      )}
    </section>
  )
}
