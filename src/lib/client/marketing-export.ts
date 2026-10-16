import JSZip from "jszip";
import type { MarketingDraft } from "@/lib/marketing";

export type ExportPhoto = { id: string; url: string; fileName: string };

export function campaignUrl(base: string, channel: string, campaign: string) {
  const url = new URL(base);
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", channel.includes("ads") ? "cpc" : "organic_social");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function brandedImage(photo: Blob, headline: string, width: number, height: number) {
  const image = await createImageBitmap(photo);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is unavailable in this browser.");
  // Contain the complete photo instead of inventing or cropping out project details.
  context.fillStyle = "#f4f1eb";
  context.fillRect(0, 0, width, height);
  const footer = Math.round(height * 0.25);
  const scale = Math.min(width / image.width, (height - footer) / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;
  context.drawImage(image, (width - imageWidth) / 2, (height - footer - imageHeight) / 2, imageWidth, imageHeight);
  image.close();
  context.fillStyle = "#b4411b";
  context.fillRect(0, height - footer, width, footer);
  context.fillStyle = "#ffffff";
  context.font = `600 ${Math.round(width * 0.035)}px sans-serif`;
  context.fillText("RHI PROS", width * 0.05, height - footer * 0.72);
  let size = Math.round(width * 0.045);
  do { context.font = `600 ${size--}px sans-serif`; } while (context.measureText(headline).width > width * 0.9 && size > 12);
  context.fillText(headline, width * 0.05, height - footer * 0.42);
  context.font = `${Math.round(width * 0.025)}px sans-serif`;
  context.fillText("Tell us about your project · rhipros.com", width * 0.05, height - footer * 0.15);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the image export.");
  return blob;
}

export async function exportMarketingPack(draft: MarketingDraft, photos: ExportPhoto[], jobId: string) {
  const zip = new JSZip();
  const campaign = `job-${jobId}`;
  const blobs: Blob[] = [];
  for (let i = 0; i < photos.length; i++) {
    const response = await fetch(photos[i].url);
    if (!response.ok) throw new Error("A photo link has expired. Refresh the page and export again.");
    const blob = await response.blob();
    blobs.push(blob);
    const name = photos[i].fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    zip.file(`photos/${i + 1}-${name}`, await blob.arrayBuffer());
  }
  const facebookUrl = campaignUrl(draft.landingUrl, "facebook", campaign);
  const businessUrl = campaignUrl(draft.landingUrl, "google_business_profile", campaign);
  const metaUrl = campaignUrl(draft.landingUrl, "meta_ads", campaign);
  const googleUrl = campaignUrl(draft.landingUrl, "google_ads", campaign);
  zip.file("facebook-instagram.txt", `${draft.social}\n\n${facebookUrl}`);
  zip.file("google-business-profile.txt", `${draft.googleBusiness}\n\nButton link: ${businessUrl}`);
  zip.file("facebook-instagram-ad.txt", `${draft.metaPrimary}\n\nHeadline: ${draft.metaHeadline}\nWebsite: ${metaUrl}`);
  zip.file("google-search-ad.txt", `Headlines:\n${draft.googleHeadlines.join("\n")}\n\nDescriptions:\n${draft.googleDescriptions.join("\n")}\n\nFinal URL: ${googleUrl}`);
  zip.file("draft.json", JSON.stringify(draft, null, 2));
  zip.file("internal-project-inputs.txt", `INTERNAL REFERENCE — review before sharing\n\nPack: ${draft.packName}\nPublic town/region: ${draft.publicLocation}\nService: ${draft.service}\n\nOriginal notes:\n${draft.sourceNotes}\n\nPhoto notes:\n${draft.photoNotes.map((photo) => `${photo.assetId} (${photo.stage ?? "Unspecified"}, ${photo.area ?? "Unspecified"}): ${photo.description}`).join("\n")}\n`);
  zip.file("READ-ME.txt", "Draft marketing pack. Review every claim and confirm permission to use the selected photos before posting.\nSocial/ad accounts are not connected: this export does not publish or launch a paid campaign.\nSelect a service landing page in the editor before exporting. Tracked links are included.\nFor Google Ads, select the campaign, budget, location and keywords in your account; paste the search-ad text.\nBranded images are starting assets; check each placement's preview before using them.\n");
  // Older HEIC assets can still be exported as originals, without breaking the pack.
  if (blobs[0] && /^image\/(jpeg|png|webp)$/.test(blobs[0].type)) {
    for (const [name, width, height] of [["square", 1080, 1080], ["portrait", 1080, 1350], ["landscape", 1200, 628]] as const) {
      zip.file(`graphics/${name}.png`, await (await brandedImage(blobs[0], draft.imageHeadline, width, height)).arrayBuffer());
    }
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), "rhi-marketing-pack.zip");
}
