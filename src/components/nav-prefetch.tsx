"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const APP_ROUTES = ["/today", "/capture", "/leads", "/jobs", "/reports", "/time", "/attendance", "/settings/targets"];
const PREFETCH_REFRESH_MS = 45_000;

export function NavPrefetch() {
  const router = useRouter();

  useEffect(() => {
    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const run = () => {
      for (const route of APP_ROUTES) {
        router.prefetch(route);
      }
    };

    // Warm route payloads immediately for snappier first tab switches.
    run();

    let idleId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(run);
    } else {
      idleTimer = setTimeout(run, 500);
    }

    // Keep route payloads warm while the app is open.
    const interval = setInterval(run, PREFETCH_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
