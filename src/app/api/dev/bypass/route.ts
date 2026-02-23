import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") ?? "/dashboard";

  const response = NextResponse.redirect(new URL(redirectTo, url.origin));
  response.cookies.set("dev_bypass", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}


