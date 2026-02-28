import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_CONTEXT_COOKIE_NAME, getAuthContextCookieOptions } from "@/lib/auth-context-cookie";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );

  await supabase.auth.signOut();

  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(`${origin}/login`, { status: 302 });
  response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, "", getAuthContextCookieOptions(0));
  return response;
}