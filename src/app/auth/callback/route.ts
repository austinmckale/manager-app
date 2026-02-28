import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isEmailAllowed, requireAuth } from "@/lib/auth";
import {
  AUTH_CONTEXT_COOKIE_NAME,
  createAuthContextCookieValue,
  getAuthContextCookieOptions,
} from "@/lib/auth-context-cookie";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

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

  await supabase.auth.exchangeCodeForSession(code);

  const { data } = await supabase.auth.getUser();
  if (!isEmailAllowed(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  const response = NextResponse.redirect(`${origin}/today`);
  try {
    const auth = await requireAuth({ allowFallback: false });
    const cookieValue = createAuthContextCookieValue(auth);
    if (cookieValue) {
      response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, cookieValue, getAuthContextCookieOptions());
    }
  } catch {
    // Fall through without auth context cache.
  }
  return response;
}
