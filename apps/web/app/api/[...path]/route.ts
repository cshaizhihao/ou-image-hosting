import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

type StreamingRequestInit = RequestInit & {
  duplex?: "half";
};

const hopByHopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

function apiBaseUrl() {
  const target =
    process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";
  const url = new URL(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_PROXY_TARGET must use HTTP or HTTPS");
  }
  return url;
}

function upstreamUrl(path: string[], request: NextRequest) {
  const url = apiBaseUrl();
  const basePath = url.pathname.replace(/\/$/, "");
  const requestPath = path.map(encodeURIComponent).join("/");
  url.pathname = `${basePath}/${requestPath}`;
  url.search = request.nextUrl.search;
  return url;
}

function upstreamHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("accept-encoding", "identity");

  const forwardedHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");
  const forwardedProtocol =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  headers.set("x-forwarded-proto", forwardedProtocol);
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const init: StreamingRequestInit = {
    cache: "no-store",
    headers: upstreamHeaders(request),
    method: request.method,
    redirect: "manual"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(upstreamUrl(path, request), init);
    const headers = new Headers(response.headers);
    for (const header of hopByHopHeaders) headers.delete(header);
    const noBody =
      request.method === "HEAD" ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304;
    return new NextResponse(noBody ? null : response.body, {
      headers,
      status: response.status,
      statusText: response.statusText
    });
  } catch (error) {
    console.error("API proxy request failed", error);
    return NextResponse.json(
      { error: "API service is temporarily unavailable" },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
