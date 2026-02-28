import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  AUTH_CONTEXT_COOKIE_NAME,
  createAuthContextCookieValue,
  getAuthContextCookieOptions,
} from "@/lib/auth-context-cookie";

export async function POST() {
  try {
    const auth = await requireAuth({ allowFallback: false });
    const value = createAuthContextCookieValue(auth);
    const response = NextResponse.json({ ok: true });

    if (value) {
      response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, value, getAuthContextCookieOptions());
    }

    return response;
  } catch {
    const response = NextResponse.json({ ok: false }, { status: 401 });
    response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, "", getAuthContextCookieOptions(0));
    return response;
  }
}

