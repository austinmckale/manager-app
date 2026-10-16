"use client";

import { useEffect } from "react";

const SESSION_WARMUP_KEY = "ff_auth_session_warmed";

export function AuthSessionWarmup() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.visibilityState !== "visible") return;

    try {
      if (window.sessionStorage.getItem(SESSION_WARMUP_KEY) === "1") {
        return;
      }
    } catch {
      // Ignore storage access issues and fall through once.
    }

    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const warm = async () => {
      try {
        const response = await fetch("/api/auth/session-cache", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          window.sessionStorage.setItem(SESSION_WARMUP_KEY, "1");
        }
      } catch {
        // Ignore warmup failures; normal auth will still run on demand.
      }
    };

    let idleId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(() => {
        void warm();
      });
    } else {
      idleTimer = setTimeout(() => {
        void warm();
      }, 750);
    }

    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
  }, []);

  return null;
}
