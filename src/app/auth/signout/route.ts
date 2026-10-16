import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { AUTH_CONTEXT_COOKIE_NAME } from "@/lib/auth-context-cookie";
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(`${origin}/login`, 303);
  response.cookies.delete(AUTH_CONTEXT_COOKIE_NAME);
  return response;
}
