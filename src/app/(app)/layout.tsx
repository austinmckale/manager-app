import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth";
import { clientPortalUser } from "@/lib/client-portal";

export const dynamic = "force-dynamic";
// The Supabase database is in AWS us-west-2 (Oregon); pdx1 runs in that same region.
export const preferredRegion = "pdx1";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    if (await clientPortalUser()) redirect("/portal");
    redirect("/login");
  }

  return (
    <AppShell title="RHI Pros" userName={auth.fullName}>
      {children}
    </AppShell>
  );
}
