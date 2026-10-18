import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { WebsiteProjectList } from "@/components/publishing/website-project-list";
import { catalogProjects, pickShuffledProject, rememberWebsiteProjects } from "@/lib/website-projects";
import { WEBSITE_ORIGIN } from "@/lib/website-project-catalog";

export default async function MarketingConnectionsPage({ searchParams }: { searchParams: Promise<{ website?: string }> }) {
  const auth = await requireAuth();
  const denied = marketingAccessDenied(auth.role);
  if (denied) return <p className="rounded-xl bg-slate-50 p-4 text-sm">{denied}</p>;
  const params = await searchParams;
  const requestedWebsite = /^[a-z0-9-]{1,80}$/.test(params.website ?? "") ? params.website ?? "" : "";
  const demo = isDemoMode();
  const storedCatalog = catalogProjects(auth.orgId);
  const website = demo
    ? { projects: storedCatalog, featured: pickShuffledProject(storedCatalog) }
    : await rememberWebsiteProjects(auth.orgId).catch(() => ({ projects: storedCatalog, featured: pickShuffledProject(storedCatalog) }));
  const catalog = website.projects.filter((project) => project.slug);
  const selectedWebsite = catalog.find((project) => project.slug === requestedWebsite) ?? null;
  const featuredWebsite = catalog.find((project) => project.id === website.featured?.id) ?? pickShuffledProject(catalog);
  const featuredId = website.featured?.id ?? featuredWebsite?.id ?? selectedWebsite?.id ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Website projects</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-600">These projects are already on the website. Posts go through Buffer after you approve a draft.</p>
      </div>
      <WebsiteProjectList
        projects={website.projects.map((project) => ({
          id: project.id,
          slug: project.slug,
          jobId: project.jobId,
          name: project.name,
          location: project.location,
          description: project.description,
          photoCount: project.photoCount,
          imageUrl: project.images[0] ? `${WEBSITE_ORIGIN}${project.images[0].src}` : null,
          imageAlt: project.images[0]?.alt,
        }))}
        featuredId={featuredId}
      />
    </div>
  );
}
