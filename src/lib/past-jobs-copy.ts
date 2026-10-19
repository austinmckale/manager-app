import { marketingDraftSchema, prepareMarketingDraft } from "@/lib/marketing";
import { WEBSITE_ORIGIN, websiteProjectCatalog, type WebsiteCatalogProject } from "@/lib/website-project-catalog";

/** A small cover picture from the website's own image resizer; the originals can be several megabytes. */
export function websiteThumb(src: string) {
  return `${WEBSITE_ORIGIN}/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`;
}

export function pastJobBySlug(slug: string) {
  return websiteProjectCatalog.find((project) => project.slug === slug) ?? null;
}

/** The facts a writer may use: the website's own published text for this project. */
export function pastJobNotes(project: WebsiteCatalogProject) {
  return [project.description, project.solution, project.scope.length ? `Work included: ${project.scope.join("; ")}.` : "", project.results.length ? `Results: ${project.results.join("; ")}.` : ""].filter(Boolean).join("\n\n").slice(0, 6000);
}

const fits = (text: string, max: number) => (text.length <= max ? text : "");
const firstSentence = (text: string) => text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";

/** A starting pack from the website's published words; the AI check then verifies it against the photos. */
export function pastJobDraft(project: WebsiteCatalogProject, assetIds: string[]) {
  const base = prepareMarketingDraft({ assetIds, notes: [pastJobNotes(project)], area: project.service, location: project.location, packName: project.title });
  const headlines = [project.service, project.location, ...base.googleHeadlines].map((line) => fits(line.trim(), 30)).filter(Boolean);
  const descriptions = [fits(firstSentence(project.description), 90), fits(firstSentence(project.solution), 90), ...base.googleDescriptions].filter(Boolean);
  return marketingDraftSchema.parse({
    ...base,
    social: project.description.slice(0, 2200),
    googleBusiness: (project.solution || project.description).slice(0, 1500),
    metaPrimary: project.description.slice(0, 2200),
    metaHeadline: fits(project.title, 40) || fits(project.service, 40) || base.metaHeadline,
    imageHeadline: fits(project.title, 60) || base.imageHeadline,
    googleHeadlines: [...new Set(headlines)].slice(0, 3),
    googleDescriptions: [...new Set(descriptions)].slice(0, 2),
  });
}

