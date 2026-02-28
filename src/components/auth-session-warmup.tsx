"use client";

import { useEffect } from "react";

export function AuthSessionWarmup() {
  useEffect(() => {
    fetch("/api/auth/session-cache", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    }).catch(() => undefined);
  }, []);

  return null;
}
