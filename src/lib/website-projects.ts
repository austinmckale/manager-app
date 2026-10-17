import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { prepareMarketingDraft } from "@/lib/marketing";
import { websiteProjectCatalog } from "@/lib/website-project-catalog";

export const WEBSITE_PROJECT = "marketing.website.project";

export type WebsitePhoto = { id: string; description: string | null; area: string | null; stage: string | null; createdAt: Date };
export type WebsiteProject = {
  id: string;
  slug: string;
  jobId: string | null;
  name: string;
  location: string;
  description: string;
  area: string;
  assetIds: string[];
  images: { src: string; alt: string }[];
  photoCount: number;
  newestAt: string;
};

export function websiteProjectId(orgId: string, jobId: string) {
  const hex = createHash("sha256").update(`rhi-website-project-v1:${orgId}:${jobId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function publicTown(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const start = parts.length >= 2 && /^\d/.test(parts[0]) ? 1 : 0;
  if (start === 0 && /^\d/.test(parts[0] ?? "")) return "";
  return parts.slice(start, start + 2).join(", ").replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function projectDescription(photos: WebsitePhoto[]) {
  return [...new Set(photos.map((photo) => photo.description?.trim() ?? "").filter(Boolean))].join("\n\n").slice(0, 1400);
}

export function featureWebsiteProject<T extends { id: string }>(projects: T[], featuredId?: string | null) {
  return [...projects].sort((a, b) => Number(b.id === featuredId) - Number(a.id === featuredId));
}

export function buildWebsiteProjects(orgId: string, jobs: { id: string; jobName: string; address: string; photos: WebsitePhoto[]; photoCount?: number }[]): WebsiteProject[] {
  return jobs.flatMap((job) => {
    const photos = [...job.photos].sort((a, b) => Number(b.stage === "AFTER") - Number(a.stage === "AFTER") || b.createdAt.getTime() - a.createdAt.getTime());
    if (!photos.length) return [];
    const description = projectDescription(photos);
    const newest = photos.reduce((latest, photo) => photo.createdAt > latest ? photo.createdAt : latest, photos[0].createdAt);
    return [{
      id: websiteProjectId(orgId, job.id),
      slug: "",
      jobId: job.id,
      name: job.jobName.slice(0, 120),
      location: publicTown(job.address),
      description,
      area: photos.find((photo) => photo.area)?.area?.slice(0, 100) || "Project",
      assetIds: photos.slice(0, 10).map((photo) => photo.id),
      images: [],
      photoCount: job.photoCount ?? photos.length,
      newestAt: newest.toISOString(),
    }];
  }).sort((a, b) => b.newestAt.localeCompare(a.newestAt));
}

export function pickShuffledProject<T extends { id: string }>(projects: T[], now = new Date()) {
  if (projects.length <= 1) return projects[0] ?? null;
  const older = projects.slice(1);
  const day = now.toISOString().slice(0, 10);
  const index = createHash("sha256").update(`rhi-website-shuffle:${day}`).digest()[0] % older.length;
  return older[index];
}

export function catalogProjects(orgId: string): WebsiteProject[] {
  return websiteProjectCatalog.map((project, index) => ({
    id: websiteProjectId(orgId, project.slug),
    slug: project.slug,
    jobId: null,
    name: project.title,
    location: publicTown(project.location),
    description: project.description,
    area: project.service,
    assetIds: [],
    images: project.images,
    photoCount: project.images.length,
    newestAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
  }));
}

export function websiteCaption(project: Pick<WebsiteProject, "description" | "location" | "area" | "assetIds">) {
  return prepareMarketingDraft({
    assetIds: project.assetIds.length ? project.assetIds : ["00000000-0000-4000-8000-000000000001"],
    notes: project.description ? [project.description] : [],
    area: project.area,
    location: project.location,
    photoNotes: [],
  }).social;
}

export function draftFromWebsiteProject(project: WebsiteProject) {
  return prepareMarketingDraft({
    assetIds: project.assetIds,
    notes: project.description ? [project.description] : [],
    area: project.area,
    location: project.location,
    packName: project.name,
    photoNotes: [],
  });
}

export async function rememberWebsiteProjects(orgId: string) {
  let portfolio: WebsiteProject[] = [];
  try {
    const jobs = await prisma.job.findMany({
      where: { orgId, NOT: { categoryTags: { has: "photo-dump" } }, fileAssets: { some: { type: "PHOTO", isPortfolio: true } } },
      select: {
        id: true,
        jobName: true,
        address: true,
        _count: { select: { fileAssets: { where: { type: "PHOTO", isPortfolio: true } } } },
        fileAssets: { where: { type: "PHOTO", isPortfolio: true }, select: { id: true, description: true, area: true, stage: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 24 },
      },
      take: 40,
    });
    portfolio = buildWebsiteProjects(orgId, jobs.map((job) => ({ id: job.id, jobName: job.jobName, address: job.address, photos: job.fileAssets, photoCount: job._count.fileAssets })));
  } catch {
    portfolio = [];
  }
  const projects = [...portfolio, ...catalogProjects(orgId)].sort((a, b) => b.newestAt.localeCompare(a.newestAt));
  await Promise.allSettled(projects.map((project) => prisma.activityLog.upsert({
    where: { id: project.id },
    create: { id: project.id, orgId, jobId: project.jobId, action: WEBSITE_PROJECT, metadata: project },
    update: { jobId: project.jobId, metadata: project },
  })));
  return { projects, featured: pickShuffledProject(projects) };
}
