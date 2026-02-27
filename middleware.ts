import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1" || process.env.NODE_ENV === "production";
const AUTH_ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function isEmailAllowed(email?: string | null) {
  if (AUTH_ALLOWED_EMAILS.length === 0) return true;
  if (!email) return false;
  return AUTH_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

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

  const response = NextResponse.next();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  if (!data.user || !isEmailAllowed(data.user.email)) {
    const redirectUrl = new URL("/login", request.url);
    if (data.user && !isEmailAllowed(data.user.email)) {
      redirectUrl.searchParams.set("error", "unauthorized");
    }
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
};
