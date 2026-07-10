import { type NextRequest, NextResponse } from "next/server";

const publicPaths = [
  "/install",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password"
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
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"]
};
