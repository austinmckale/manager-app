import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const preferredRegion = "sfo1";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    redirect("/login");
  }

  return (
    <AppShell title="Workspace" userName={auth.fullName}>
      {children}
    </AppShell>
  );
}
