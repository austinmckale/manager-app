"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const APP_ROUTES = ["/today", "/leads", "/jobs", "/time", "/attendance", "/settings/targets"];

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

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run);
      return () => {
        if (typeof w.cancelIdleCallback === "function") {
          w.cancelIdleCallback(id);
        }
      };
    }

    const timer = setTimeout(run, 500);
    return () => clearTimeout(timer);
  }, [router]);

  return null;
}
