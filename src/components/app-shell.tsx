import { ManagerNavigation } from "@/components/manager-navigation";
import { NavPrefetch } from "@/components/nav-prefetch";
import { AuthSessionWarmup } from "@/components/auth-session-warmup";

type AppShellProps = {
  title: string;
  userName: string;
  children: React.ReactNode;
};

export function AppShell({ title, userName, children }: AppShellProps) {
  return (
    <div className="mx-auto min-h-dvh max-w-5xl bg-white pb-24">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">RHI Pros Manager</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">{userName}</span>
        </div>
      </header>
      <main className="px-4 py-4">{children}</main>
      <AuthSessionWarmup />
      <NavPrefetch />
      <ManagerNavigation />
    </div>
  );
}
