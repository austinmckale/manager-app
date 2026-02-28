import { NextRequest, NextResponse } from "next/server";

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1" || process.env.NODE_ENV === "production";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(request: NextRequest) {
  if (!AUTH_REQUIRED) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/manifest")) {
    return NextResponse.next();
  }

  // Keep middleware fast: do not call Supabase from edge on every request.
  // Full auth/allowlist validation is enforced in server routes/layouts.
  const hasAuthCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (!hasAuthCookie) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
};
