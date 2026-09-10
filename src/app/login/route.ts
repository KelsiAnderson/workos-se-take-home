import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { resolveTenant } from "@/lib/tenants";

// GET /login            → AuthKit's hosted sign-in screen (email entry, then
//                         AuthKit routes to the matching org by email domain).
// GET /login?org=acme   → straight to that tenant's SSO connection (Okta), no
//                         email-entry step. Used for the demo because the seed
//                         users sign in with @gmail.com addresses that AuthKit
//                         can't map to an organization by domain.
//
// `org` only selects which WorkOS Organization to authenticate against — it
// cannot widen anyone's access. The session's organizationId and role are set
// by WorkOS after the user actually authenticates with the IdP, not from this
// parameter.
export const GET = async (request: NextRequest) => {
  const tenant = resolveTenant(request.nextUrl.searchParams.get("org"));

  const signInUrl = await getSignInUrl(
    tenant ? { organizationId: tenant.organizationId } : {},
  );

  return redirect(signInUrl);
};
