import type { PreviewPhoto } from "./types";

export function photosWithUrls(photos: PreviewPhoto[]): PreviewPhoto[] {
  return photos.filter((photo) => photo.url.trim() !== "");
}

export function facebookPhotoSet(photos: PreviewPhoto[]): PreviewPhoto[] {
  return photosWithUrls(photos).slice(0, 10);
}

export function singlePhoto(photos: PreviewPhoto[]): PreviewPhoto | null {
  return photosWithUrls(photos)[0] ?? null;
}
