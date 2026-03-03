import { NextRequest, NextResponse } from "next/server";

import { hasValidInternalApiKey } from "@/lib/security/internal-api";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/security/session";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/session",
  "/api/auth/session/login",
  "/api/auth/session/logout",
  "/api/inngest/serve",
  "/api/integrations/composio/oauth/callback"
]);

function isPublicApiPath(pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (hasValidInternalApiKey(request)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        message: "Authentication required."
      },
      { status: 401 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", session.userId);
  requestHeaders.set("x-user-email", session.email);

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ["/api/:path*"]
};
