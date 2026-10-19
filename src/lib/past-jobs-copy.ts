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

const OUTDOOR = /patio|deck|pool|exterior|staircase|stair|roof|siding|window|pavilion|porch|landscap|log home|driveway|fence/i;
/** Decks and patios in spring and summer, interiors in fall and winter. */
export function inSeason(project: Pick<WebsiteCatalogProject, "slug" | "title" | "service">, now = new Date()) {
  const outdoor = OUTDOOR.test(`${project.slug} ${project.title} ${project.service}`);
  const warm = now.getMonth() >= 2 && now.getMonth() <= 8;
  return outdoor === warm;
}

// Monday-to-Sunday weeks. Day 0 of Unix time was a Thursday, so shift by three days.
const weekNumber = (now: Date) => Math.floor((Math.floor(now.getTime() / (24 * 60 * 60 * 1000)) + 3) / 7);

/**
 * When Ryan has sent no photos for 7 days, one past job to post instead: not sent to Buffer in the
 * last 90 days, in season when possible, and the same pick all week.
 */
export function pickPastJob<T extends Pick<WebsiteCatalogProject, "slug" | "title" | "service"> & { versionIds: string[] }>(jobs: T[], recentlySent: Set<string>, now = new Date()) {
  const fresh = jobs.filter((job) => !job.versionIds.some((id) => recentlySent.has(id)));
  const seasonal = fresh.filter((job) => inSeason(job, now));
  const pool = seasonal.length ? seasonal : fresh;
  return pool.length ? pool[weekNumber(now) % pool.length] : null;
}
