import type { Metadata } from "next";
import { CrewPhotoIntake } from "@/components/crew-photo-intake";
import { isDemoMode } from "@/lib/demo";
import { resolveUploadInvite } from "@/lib/field-intake";
import { availableIntakePacks } from "@/lib/intake-delivery";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "RHI Photos", applicationName: "RHI Photos",
    description: "Send job photos and a quick note to RHI Pros.",
    robots: { index: false, follow: false }, referrer: "no-referrer",
    manifest: `/send-photos/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "RHI Photos", statusBarStyle: "default" },
    icons: { icon: "/send-photos/app-icon.png", apple: [{ url: "/send-photos/app-icon.png", sizes: "512x512", type: "image/png" }], shortcut: "/send-photos/app-icon.png" },
  };
}
export default async function SendPhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = isDemoMode() && token === "preview";
  const invite = preview ? true : await resolveUploadInvite(token).catch(() => null);
  if (!invite) return <main className="mx-auto max-w-lg p-6"><p className="text-xs font-semibold uppercase tracking-widest text-[#b4411b]">RHI Pros</p><h1 className="mt-4 text-2xl font-semibold">This photo link is unavailable.</h1><p className="mt-3 text-slate-600">Ask for a new upload link, then open it on your phone.</p></main>;
  const packs = preview ? [] : await availableIntakePacks(token);
  return <CrewPhotoIntake token={token} preview={preview} packs={packs} />;
}
