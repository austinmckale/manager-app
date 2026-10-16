"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const FALLBACK_ROUTES = ["/today", "/leads"];
const PREFETCH_MAP: Record<string, string[]> = {
  "/today": ["/leads", "/jobs"],
  "/leads": ["/today", "/jobs"],
  "/jobs": ["/today", "/leads"],
  "/reports": ["/today"],
  "/time": ["/today", "/attendance"],
  "/attendance": ["/today", "/time"],
  "/settings/targets": ["/today"],
};

export function NavPrefetch() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const nav = navigator as Navigator & {
      connection?: {
        saveData?: boolean;
        effectiveType?: string;
      };
    };

    if (nav.connection?.saveData) return;
    if (nav.connection?.effectiveType === "2g") return;

    const routes = PREFETCH_MAP[pathname] ?? FALLBACK_ROUTES;

    const run = () => {
      for (const route of routes) {
        router.prefetch(route);
      }
    };

    let idleId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(run);
    } else {
      idleTimer = setTimeout(run, 500);
    }

    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
  }, [pathname, router]);

  return null;
}
