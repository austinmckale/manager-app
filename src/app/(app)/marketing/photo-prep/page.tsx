import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { isDemoMode } from "@/lib/demo";
import { AutoPhotoPrep } from "@/components/auto-photo-prep";
import { DEFAULT_CONTRAST, DEFAULT_EXPOSURE, PHOTO_PREP_MAX_BYTES, defaultCropPresets } from "@/lib/photo-prep";

export const dynamic = "force-dynamic";

export default async function PhotoPrepPage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Only the owner and admins can prepare photos.</p>;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-teal-700">Photo prep</p>
        <h1 className="mt-2 text-2xl font-semibold">Auto-enhance photos</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">Choosing a preview does not approve or publish. Original photos stay unchanged. A public derivative strips metadata, including GPS.</p>
      </div>
      <AutoPhotoPrep
        demo={isDemoMode()}
        presets={defaultCropPresets.map((preset) => ({ ...preset }))}
        maxBytes={PHOTO_PREP_MAX_BYTES}
        exposure={DEFAULT_EXPOSURE}
        contrast={DEFAULT_CONTRAST}
      />
    </div>
  );
}
