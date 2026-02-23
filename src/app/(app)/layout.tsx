import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();

  return (
    <AppShell title="Workspace" userName={auth.fullName}>
      {children}
    </AppShell>
  );
}
