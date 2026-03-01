import Link from "next/link";
import { JobStatus } from "@prisma/client";
import { FileCapture } from "@/components/file-capture";
import { requireAuth } from "@/lib/auth";
import { demoJobs, isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getStoragePublicUrl } from "@/lib/utils";

type CaptureJobOption = {
  id: string;
  jobName: string;
  address: string;
  status: JobStatus;
};

type CaptureAssetPreview = {
  id: string;
  fileName: string;
  mimeType: string | null;
  storageKey: string;
  createdAt: Date;
};

function canPreviewPhotoInBrowser(fileName: string, mimeType?: string | null) {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  if (lowerMime.startsWith("image/")) {
    return /image\/(jpeg|jpg|png|webp|gif|avif|bmp)/.test(lowerMime);
  }
  return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(lowerName);
}

async function getOrCreatePhotoDumpJob(orgId: string): Promise<CaptureJobOption> {
  const existing = await prisma.job.findFirst({
    where: { orgId, categoryTags: { has: "photo-dump" } },
    select: { id: true, jobName: true, address: true, status: true },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  const customer =
    (await prisma.customer.findFirst({
      where: { orgId, name: "Photo Dump" },
      select: { id: true },
    })) ??
    (await prisma.customer.create({
      data: {
        orgId,
        name: "Photo Dump",
        notes: "Auto-created customer for unassigned field captures.",
      },
      select: { id: true },
    }));

  return prisma.job.create({
    data: {
      orgId,
      customerId: customer.id,
      jobName: "Photo Dump",
      address: "Unassigned capture",
      status: JobStatus.IN_PROGRESS,
      categoryTags: ["general-remodeling", "photo-dump"],
    },
    select: { id: true, jobName: true, address: true, status: true },
  });
}

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; mode?: string }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;
  const selectedJobIdParam = String(params.jobId ?? "").trim();
  const usePhotoDump = String(params.mode ?? "").trim().toLowerCase() === "dump";
  const demoMode = isDemoMode();

  let jobs: CaptureJobOption[] = [];
  let selectedJob: CaptureJobOption | null = null;
  let recentPhotoAssets: CaptureAssetPreview[] = [];

  if (demoMode) {
    jobs = demoJobs.map((job) => ({
      id: job.id,
      jobName: job.jobName,
      address: job.address,
      status: job.status,
    }));
    selectedJob =
      (selectedJobIdParam ? jobs.find((job) => job.id === selectedJobIdParam) : null) ??
      (usePhotoDump ? jobs[0] ?? null : null);
  } else {
    jobs = await prisma.job.findMany({
      where: { orgId: auth.orgId },
      select: { id: true, jobName: true, address: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 150,
    });

    if (usePhotoDump) {
      const dumpJob = await getOrCreatePhotoDumpJob(auth.orgId);
      if (!jobs.some((job) => job.id === dumpJob.id)) {
        jobs = [dumpJob, ...jobs];
      }
      selectedJob = dumpJob;
    } else if (selectedJobIdParam) {
      selectedJob = jobs.find((job) => job.id === selectedJobIdParam) ?? null;
    }
  }

  if (selectedJob && !demoMode) {
    recentPhotoAssets = await prisma.fileAsset.findMany({
      where: { jobId: selectedJob.id, type: "PHOTO" },
      orderBy: { createdAt: "desc" },
      take: 18,
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storageKey: true,
        createdAt: true,
      },
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Field Capture</h2>
        <p className="mt-1 text-xs text-slate-500">
          Pick a job, then capture photos from your phone. Uploads here flow directly into that job&apos;s Field Photos section.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <form action="/capture" method="get" className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <select
              name="jobId"
              defaultValue={selectedJob?.id ?? ""}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select job...</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobName} - {job.address}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              Open capture
            </button>
          </form>
          <form action="/capture" method="get">
            <input type="hidden" name="mode" value="dump" />
            <button type="submit" className="w-full rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm text-cyan-700 sm:w-auto">
              Photo dump
            </button>
          </form>
        </div>
      </section>

      {selectedJob ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Selected job</p>
              <h3 className="text-base font-semibold text-slate-900">{selectedJob.jobName}</h3>
              <p className="text-xs text-slate-600">{selectedJob.address}</p>
            </div>
            <Link href={`/jobs/${selectedJob.id}#capture`} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              Open job
            </Link>
          </div>
          <div className="mt-3">
            <FileCapture jobId={selectedJob.id} fileType="PHOTO" photoOnly />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-700">Recent photos ({recentPhotoAssets.length})</p>
              <Link href={`/jobs/${selectedJob.id}#capture`} className="text-xs text-cyan-700 underline">
                Open full gallery
              </Link>
            </div>
            {recentPhotoAssets.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No photos yet. Upload one above and it will appear here after refresh.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {recentPhotoAssets.map((asset) => {
                  const canPreview = canPreviewPhotoInBrowser(asset.fileName, asset.mimeType);
                  const extension = asset.fileName.split(".").pop()?.toUpperCase() ?? "FILE";
                  const assetUrl = getStoragePublicUrl(asset.storageKey);
                  return (
                    <a key={asset.id} href={assetUrl} target="_blank" rel="noreferrer" className="block">
                      {canPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetUrl}
                          alt={asset.fileName}
                          className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-center text-[11px] text-slate-600">
                          Preview unavailable ({extension})
                        </div>
                      )}
                      <p className="mt-1 truncate text-[10px] text-slate-500">{asset.fileName}</p>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Select a job or choose Photo dump to start capturing.</p>
        </section>
      )}
    </div>
  );
}
