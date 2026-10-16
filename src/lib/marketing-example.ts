import { prepareMarketingDraft } from "@/lib/marketing";

// Owner-approved public website project. Originals remain unchanged in the site
// repository; these demo copies are explicitly separate from live job records.
export const exampleJobId = "10000000-0000-4000-8000-000000000001";
export const examplePhotos = [
  { id: "20000000-0000-4000-8000-000000000001", fileName: "pavilion-front.jpg", url: "/demo/pavilion-front.jpg", description: "Front view of the gable-roof pavilion, support posts, and paver patio.", stage: "AFTER" as const, mimeType: "image/jpeg", area: "Patio and pavilion", tags: [], published: false, updatedAt: "website-example-1" },
  { id: "20000000-0000-4000-8000-000000000002", fileName: "pavilion-ceiling.jpg", url: "/demo/pavilion-ceiling.jpg", description: "Pavilion wood ceiling and roof framing viewed from below.", stage: "AFTER" as const, mimeType: "image/jpeg", area: "Patio and pavilion", tags: [], published: false, updatedAt: "website-example-2" },
];
const story = "Set the posts, raised the trusses and roofed it, then stained a plank ceiling and set recessed lights in it. We laid the paver patio underneath too.";
export const exampleDraft = {
  ...prepareMarketingDraft({ assetIds: examplePhotos.map((photo) => photo.id), notes: [story], area: "Patio and pavilion", location: "Reading, PA", packName: "Reading patio and pavilion", photoNotes: examplePhotos.map((photo) => ({ assetId: photo.id, description: photo.description, area: photo.area, stage: photo.stage })) }),
  social: `A backyard you can use rain or shine.\n\n${story}\n\nExplore this Reading project and tell us what you have in mind for your backyard.`,
  googleBusiness: `A paver patio and gable-roof pavilion in Reading, PA.\n\n${story}\n\nSee the finished project on our website.`,
  metaPrimary: "A backyard you can use rain or shine.\n\nSee this paver patio and gable-roof pavilion built by RHI Pros in Reading, PA. Tell us about your project.",
  metaHeadline: "A backyard worth coming home to",
  imageHeadline: "A backyard you can use rain or shine.",
  googleHeadlines: ["Paver Patios by RHI Pros", "Plan Your Backyard Project", "Reading to Bethlehem"],
  googleDescriptions: ["Explore our paver patio and pavilion project in Reading. Tell us about your backyard.", "RHI Pros serves homeowners from Reading to Bethlehem. Get in touch about your project."],
  landingUrl: "https://rhipros.com/projects/reading-paver-patio-buildout",
};
