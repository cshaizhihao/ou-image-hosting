import { type NextRequest, NextResponse } from "next/server";

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
    const loginUrl = request.nextUrl.clone();
    if (forwardedProtocol) loginUrl.protocol = `${forwardedProtocol}:`;
    if (host) loginUrl.host = host;
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.hash = "";

    const response = NextResponse.redirect(loginUrl, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/).*)"]
};
