import { prisma } from "@/lib/prisma";
import { getStoragePublicUrl } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (isDemoMode()) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Shared Project Timeline</h1>
        <p className="text-sm text-slate-600">Demo share link: {token}</p>
      </main>
    );
  }

  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      job: {
        include: {
          fileAssets: {
            where: { isClientVisible: true, type: "PHOTO" },
            orderBy: { takenAt: "asc" },
          },
        },
      },
    },
  });

  if (!link) {
    return <main className="p-6 text-sm">Invalid or expired share link.</main>;
  }

  const assets =
    link.type === "GALLERY" && link.selectedAssetIds.length
      ? link.job.fileAssets.filter((asset) => link.selectedAssetIds.includes(asset.id))
      : link.job.fileAssets;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">{link.job.jobName} - Shared {link.type.toLowerCase()}</h1>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {assets.map((asset) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={asset.id} src={getStoragePublicUrl(asset.storageKey)} alt={asset.description ?? "Shared photo"} className="aspect-square w-full rounded-xl object-cover" />
        ))}
      </div>
    </main>
  );
}
