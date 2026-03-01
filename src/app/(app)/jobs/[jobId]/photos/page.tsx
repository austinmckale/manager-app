import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { togglePortfolioAction } from "@/app/(app)/actions";
import { FileCapture } from "@/components/file-capture";
import { requireAuth } from "@/lib/auth";
import { getJobById } from "@/lib/data";
import { getStoragePublicUrl } from "@/lib/utils";

function canPreviewPhotoInBrowser(fileName: string, mimeType?: string | null) {
    const lowerName = fileName.toLowerCase();
    const lowerMime = (mimeType ?? "").toLowerCase();
    if (lowerMime.startsWith("image/")) {
        return /image\/(jpeg|jpg|png|webp|gif|avif|bmp)/.test(lowerMime);
    }
    return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(lowerName);
}

export default async function PhotosPage({
    params,
}: {
    params: Promise<{ jobId: string }>;
}) {
    const auth = await requireAuth();
    const { jobId } = await params;
    const job = await getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId });
    const photoAssets = job.fileAssets.filter((asset) => asset.type === "PHOTO");
    const todayStart = startOfDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);
    const todayPhotoAssets = photoAssets.filter(
        (asset) => asset.createdAt >= todayStart && asset.createdAt < tomorrowStart,
    );
    const earlierPhotoAssets = photoAssets.filter(
        (asset) => asset.createdAt < todayStart || asset.createdAt >= tomorrowStart,
    );

    return (
        <section id="capture" className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Job photos</h3>
            <p className="mt-1 text-xs text-slate-500">Upload and review photos for this job.</p>
            <div className="mt-3">
                <Link
                    href={`/capture?jobId=${job.id}`}
                    className="rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-700"
                >
                    Upload photos
                </Link>
            </div>
            <div className="mt-3 space-y-3">
                <div>
                    <p className="text-xs font-medium text-slate-700">Photos ({photoAssets.length})</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Today first, then earlier. Tap to view full size.</p>
                    {photoAssets.length === 0 ? (
                        <p className="mt-1 text-xs text-slate-500">No photos uploaded yet.</p>
                    ) : (
                        <div className="mt-1 space-y-2">
                            {todayPhotoAssets.length > 0 ? (
                                <div>
                                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Today</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {todayPhotoAssets.map((asset) => {
                                            const assetUrl = getStoragePublicUrl(asset.storageKey);
                                            const canPreview = canPreviewPhotoInBrowser(asset.fileName, asset.mimeType);
                                            const extension = asset.fileName.split(".").pop()?.toUpperCase() ?? "FILE";
                                            return (
                                                <div key={asset.id} className="group relative">
                                                    <a href={assetUrl} target="_blank" rel="noreferrer" className="block">
                                                        {canPreview ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={assetUrl}
                                                                alt={asset.description ?? "asset"}
                                                                className="aspect-square w-full rounded-xl object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-center text-[11px] text-slate-600">
                                                                Preview unavailable ({extension})
                                                            </div>
                                                        )}
                                                    </a>
                                                    <form action={togglePortfolioAction} className="absolute right-1 top-1">
                                                        <input type="hidden" name="assetId" value={asset.id} />
                                                        <button
                                                            type="submit"
                                                            title={asset.isPortfolio ? "Remove from portfolio" : "Add to portfolio"}
                                                            className={`rounded-lg px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm ${asset.isPortfolio
                                                                    ? "bg-teal-600/90 text-white"
                                                                    : "bg-white/80 text-slate-600 opacity-0 group-hover:opacity-100"
                                                                }`}
                                                        >
                                                            {asset.isPortfolio ? "Portfolio On" : "Add Portfolio"}
                                                        </button>
                                                    </form>
                                                    {asset.stage ? (
                                                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                                            {asset.stage}
                                                        </span>
                                                    ) : null}
                                                    <p className="mt-1 truncate text-[10px] text-slate-500">{asset.fileName}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                            {earlierPhotoAssets.length > 0 ? (
                                <div>
                                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Earlier</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {earlierPhotoAssets.map((asset) => {
                                            const assetUrl = getStoragePublicUrl(asset.storageKey);
                                            const canPreview = canPreviewPhotoInBrowser(asset.fileName, asset.mimeType);
                                            const extension = asset.fileName.split(".").pop()?.toUpperCase() ?? "FILE";
                                            return (
                                                <div key={asset.id} className="group relative">
                                                    <a href={assetUrl} target="_blank" rel="noreferrer" className="block">
                                                        {canPreview ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={assetUrl}
                                                                alt={asset.description ?? "asset"}
                                                                className="aspect-square w-full rounded-xl object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-center text-[11px] text-slate-600">
                                                                Preview unavailable ({extension})
                                                            </div>
                                                        )}
                                                    </a>
                                                    <form action={togglePortfolioAction} className="absolute right-1 top-1">
                                                        <input type="hidden" name="assetId" value={asset.id} />
                                                        <button
                                                            type="submit"
                                                            title={asset.isPortfolio ? "Remove from portfolio" : "Add to portfolio"}
                                                            className={`rounded-lg px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm ${asset.isPortfolio
                                                                    ? "bg-teal-600/90 text-white"
                                                                    : "bg-white/80 text-slate-600 opacity-0 group-hover:opacity-100"
                                                                }`}
                                                        >
                                                            {asset.isPortfolio ? "Portfolio On" : "Add Portfolio"}
                                                        </button>
                                                    </form>
                                                    {asset.stage ? (
                                                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                                            {asset.stage}
                                                        </span>
                                                    ) : null}
                                                    <p className="mt-1 truncate text-[10px] text-slate-500">{asset.fileName}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
