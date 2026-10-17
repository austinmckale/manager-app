"use client"

import { useState } from "react"
import type { PostPreviewDraft, PreviewPhoto } from "./types"
import { FacebookPreview } from "./facebook-preview"
import { InstagramPreview } from "./instagram-preview"
import { GoogleBusinessPreview } from "./google-business-preview"
import { MetaAdPreview } from "./meta-ad-preview"
import { GoogleAdPreview } from "./google-ad-preview"
import { PreviewStatus } from "./preview-status"
import { facebookPhotoSet, singlePhoto } from "./preview-media"

type Card = "facebook" | "instagram" | "google-business" | "meta-ad" | "google-ad"

const cards: { key: Card; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "google-business", label: "Google Business" },
  { key: "meta-ad", label: "Meta ad" },
  { key: "google-ad", label: "Google ad" },
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
      <PreviewStatus />

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

      {active === "instagram" && (
        <InstagramPreview caption={draft.social} photos={photos} />
      )}

      {active === "google-business" && (
        <GoogleBusinessPreview
          update={draft.googleBusiness}
          location={draft.publicLocation}
          photos={photos}
        />
      )}

      {active === "meta-ad" && (
        <MetaAdPreview
          primary={draft.metaPrimary}
          headline={draft.metaHeadline}
          imageHeadline={draft.imageHeadline}
          landingUrl={draft.landingUrl}
          photos={singlePhoto(photos) ? [singlePhoto(photos)!] : []}
        />
      )}

      {active === "google-ad" && (
        <GoogleAdPreview
          headlines={draft.googleHeadlines}
          descriptions={draft.googleDescriptions}
          landingUrl={draft.landingUrl}
        />
      )}
    </section>
  )
}
