import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { sessionNeedsRefresh } from "@/lib/supabase/session-cookie";

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1" || process.env.NODE_ENV === "production";

// Lead intake (called by the RHI Pros website) and the cron digest check their own secret keys,
// so they must not be redirected to /login.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/leads/intake", "/api/cron/", "/send-photos/", "/api/field-intake"];

export async function middleware(request: NextRequest) {
  const startedAt = performance.now();

  if (!AUTH_REQUIRED) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (pathname === "/portal/manifest.webmanifest" || PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    const response = NextResponse.next();
    response.headers.set("Server-Timing", `mw;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return response;
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/manifest")) {
    const response = NextResponse.next();
    response.headers.set("Server-Timing", `mw;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return response;
  }

  // A valid session is not checked here. An expired one is refreshed before the page
  // renders, because a page render is not allowed to write the new cookies.
  const hasAuthCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (!hasAuthCookie) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.headers.set("Server-Timing", `mw;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return response;
  }

  return continueWithSession(request, startedAt);
}

function withTiming(response: NextResponse, startedAt: number) {
  response.headers.set("Server-Timing", `mw;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return response;
}

async function continueWithSession(request: NextRequest, startedAt: number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !sessionNeedsRefresh(request.cookies.getAll())) {
    return withTiming(NextResponse.next(), startedAt);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    // A failed refresh sends the visitor onward. The page can ask them to sign in again.
  }
  return withTiming(response, startedAt);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
};
