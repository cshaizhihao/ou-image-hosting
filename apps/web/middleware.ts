import { type NextRequest, NextResponse } from "next/server";

import { createPublicUrl } from "./lib/public-url";

const publicPaths = [
  "/install",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/share"
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/" ||
    publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  if (!request.cookies.has("ou_session")) {
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();
    const host = forwardedHost ?? request.headers.get("host");
    const loginUrl = createPublicUrl("/login", {
      configuredOrigin: process.env.APP_ORIGIN,
      requestUrl: request.url,
      forwardedProtocol,
      forwardedHost,
      host
    });

    const response = NextResponse.redirect(loginUrl, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/).*)"]
};
