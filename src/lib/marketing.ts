import { z } from "zod";

export const ARCHIVED_PHOTO_TAG = "marketing:archived";
export const DRAFT_SAVED_ACTION = "marketing.draft.saved";

export const marketingDraftSchema = z.object({
  packName: z.string().max(120).default(""),
  sourceNotes: z.string().max(6000).default(""),
  publicLocation: z.string().max(100).default(""),
  service: z.string().max(100).default(""),
  photoNotes: z.array(z.object({ assetId: z.string().uuid(), description: z.string().max(3000), area: z.string().nullable(), stage: z.enum(["BEFORE", "DURING", "AFTER"]).nullable() })).max(24).default([]),
  assetIds: z.array(z.string().uuid()).min(1).max(24),
  social: z.string().max(2200),
  googleBusiness: z.string().max(1500),
  metaPrimary: z.string().max(2200),
  metaHeadline: z.string().max(40),
  googleHeadlines: z.array(z.string().min(1).max(30)).min(3).max(15),
  googleDescriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
  imageHeadline: z.string().max(60),
  landingUrl: z.string().url().startsWith("https://").max(500),
});
export type MarketingDraft = z.infer<typeof marketingDraftSchema>;

// Starting points use only submitted facts. Customer names, addresses and job
// names are deliberately excluded from public copy.
export function prepareMarketingDraft(input: { assetIds: string[]; notes: string[]; area?: string | null; location?: string; packName?: string; photoNotes?: MarketingDraft["photoNotes"] }): MarketingDraft {
  const sourceNotes = [...new Set(input.notes.map((note) => note.trim()).filter(Boolean))].join("\n\n").slice(0, 6000);
  const facts = sourceNotes.slice(0, 1400);
  const subject = input.area && input.area !== "Other" ? input.area : "Project";
  return {
    packName: input.packName?.slice(0, 120) ?? "",
    sourceNotes,
    publicLocation: input.location?.slice(0, 100) ?? "",
    service: input.area?.slice(0, 100) ?? "",
    photoNotes: input.photoNotes ?? [],
    assetIds: input.assetIds,
    social: `${facts ? `${facts}\n\n` : ""}Planning a project of your own? Contact RHI Pros.`,
    googleBusiness: `${facts ? `${facts}\n\n` : ""}Have a project in mind? Get in touch with RHI Pros.`,
    metaPrimary: `${facts ? `${facts}\n\n` : ""}Tell RHI Pros what you have in mind for your home.`,
    metaHeadline: "Tell us about your project",
    googleHeadlines: ["RHI Pros", "Tell Us About Your Project", "Request a Project Estimate"],
    googleDescriptions: ["Tell RHI Pros what you have in mind for your home. Request a project estimate.", "Explore our work and get in touch to discuss your project."],
    imageHeadline: `${subject} by RHI Pros`.slice(0, 60),
    landingUrl: "https://rhipros.com/request-a-quote",
  };
}

export function canPublishPhoto(asset: { stage: string | null; mimeType: string | null; tags: string[] }) {
  return asset.stage === "AFTER" && /^image\/(jpeg|png|webp)$/.test(asset.mimeType ?? "") && !asset.tags.includes(ARCHIVED_PHOTO_TAG);
}
