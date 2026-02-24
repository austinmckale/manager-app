import Link from "next/link";
import { BeforeAfterTool } from "@/components/before-after-tool";
import { CaptionTemplate } from "@/components/caption-template";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getStoragePublicUrl } from "@/lib/utils";

export default async function PortfolioPage() {
  const auth = await requireAuth();
  const assets = isDemoMode()
    ? []
    : await prisma.fileAsset.findMany({
        where: {
          job: { orgId: auth.orgId },
          isPortfolio: true,
          type: "PHOTO",
        },
        include: { job: true },
        orderBy: { createdAt: "desc" },
      });

  const grouped = new Map<string, typeof assets>();

  for (const asset of assets) {
    const key = `${asset.area ?? "general"}-${asset.job.address}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(asset);
  }

  const options = assets.slice(0, 40).map((asset) => ({
    id: asset.id,
    label: `${asset.job.jobName} - ${asset.area ?? "Area"}`,
    url: getStoragePublicUrl(asset.storageKey),
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <a href="/api/portfolio/zip" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          Download portfolio photos (ZIP)
        </a>
        <Link href="/jobs" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          Manage portfolio toggles in Jobs
        </Link>
      </div>

      <BeforeAfterTool assets={options} />

      {[...grouped.entries()].map(([groupKey, items]) => {
        const preview = items.slice(0, 20);
        const [category, location] = groupKey.split("-");

        return (
          <section key={groupKey} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{category} • {location}</h2>
            <p className="mt-1 text-xs text-slate-500">{preview.length} photos</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {preview.map((asset) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={asset.id} src={getStoragePublicUrl(asset.storageKey)} alt={asset.description ?? "Portfolio photo"} className="aspect-square w-full rounded-xl object-cover" />
              ))}
            </div>
            <div className="mt-3">
              <CaptionTemplate
                problem={items[0]?.description || "Damaged area and outdated finish."}
                solution="Demolition, rebuild, and clean finish aligned to client scope."
                materials={items[0]?.tags.join(", ") || "Drywall, tile, trim, paint"}
                result="Safer, cleaner space with insurance-compliant documentation."
              />
            </div>
          </section>
        );
      })}

      {assets.length === 0 ? <p className="text-sm text-slate-500">No portfolio photos yet. Demo mode is active.</p> : null}
    </div>
  );
}
