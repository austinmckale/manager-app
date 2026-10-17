import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clientPortalUser, ensurePortalUpload, readClientMembership } from "@/lib/client-portal";
import { CrewPhotoIntake } from "@/components/crew-photo-intake";
import { CrewInstallHelp } from "@/components/crew-install-help";
import { availableMembershipPacks } from "@/lib/intake-delivery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "RHI Photos", applicationName: "RHI Photos", manifest: "/portal/manifest.webmanifest",
  robots: { index: false, follow: false }, referrer: "no-referrer",
  appleWebApp: { capable: true, title: "RHI Photos", statusBarStyle: "default" },
  icons: { icon: "/send-photos/app-icon.png", apple: "/send-photos/app-icon.png" },
};
export default async function ClientPortalPage() {
  const user = await clientPortalUser();
  if (!user) redirect("/login");
  const membership = await readClientMembership(user.email);
  if (!membership) return <main className="mx-auto max-w-lg p-6"><h1 className="text-2xl font-semibold">Your RHI Photos portal</h1><p className="mt-3">Your account is signed in. Ask Austin to connect or renew your project access.</p><CrewInstallHelp /></main>;
  const upload = await ensurePortalUpload(membership);
  const packs = await availableMembershipPacks({ orgId: membership.orgId, jobId: membership.jobId, historyInviteIds: upload.historyInviteIds });
  return <><div className="mx-auto flex max-w-lg items-center justify-between bg-[#faf8f4] px-5 pt-4 text-xs text-slate-600"><span>Ryan’s portal</span><form method="post" action="/auth/signout"><button className="underline">Switch account</button></form></div><CrewPhotoIntake token={upload.token} packs={packs} draftKey={membership.id} jobsHref="/portal/jobs" reportsHref="/portal/reports" packBase="/portal/packs" /></>;
}
