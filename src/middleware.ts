import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { sessionPolicyFor, tenantByOrganizationId } from "@/lib/tenants";
import {
  SESSION_STAMP_COOKIE,
  WORKOS_SESSION_COOKIES,
  readSessionStamp,
} from "@/lib/session-policy";

// AuthKit session refresh for every matched route (so withAuth() works in
// pages and route handlers), plus per-tenant session-age enforcement.
//
// WorkOS session lifetime is environment-wide, so the "sessions expire 24h
// after sign-in, no exceptions" rule for a single strict tenant is enforced
// here: the callback stamps the sign-in time in a signed cookie, and this
// checks it. A stale, missing, or wrong-session stamp for a strict-policy
// tenant forces a full re-authentication.
export default async function middleware(request: NextRequest) {
  const { session, headers } = await authkit(request);

  if (session.user) {
    const policy = sessionPolicyFor(session.organizationId);

    if (policy) {
      const stamp = await readSessionStamp(
        request.cookies.get(SESSION_STAMP_COOKIE)?.value,
      );
      const maxAgeMs = policy.maxSessionAgeHours * 60 * 60 * 1000;

      const expired =
        !stamp ||
        stamp.sid !== session.sessionId ||
        Date.now() - stamp.issuedAt > maxAgeMs;

      if (expired) {
        return forceReauth(request, session.organizationId);
      }
    }
  }

  return handleAuthkitHeaders(request, headers);
}

function forceReauth(request: NextRequest, organizationId?: string) {
  const slug = tenantByOrganizationId(organizationId)?.slug;

  const url = new URL("/login", request.url);
  if (slug) url.searchParams.set("org", slug);
  url.searchParams.set("error", "session_expired");

  const response = NextResponse.redirect(url);
  for (const name of [SESSION_STAMP_COOKIE, ...WORKOS_SESSION_COOKIES]) {
    response.cookies.delete(name);
  }
  return response;
}

// Match against the pages
export const config = {
  matcher: ["/", "/account/:path*", "/members/:path*", "/api/:path*"],
};
