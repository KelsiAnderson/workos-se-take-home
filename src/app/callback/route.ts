import { handleAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { sessionPolicyFor } from "@/lib/tenants";
import {
  SESSION_STAMP_COOKIE,
  sessionIdFromAccessToken,
  signSessionStamp,
} from "@/lib/session-policy";

// Standard AuthKit callback, plus: for a tenant with a session policy, record
// the sign-in moment in an HMAC-signed cookie so the middleware can enforce a
// hard max session age (see src/lib/session-policy.ts).
export const GET = handleAuth({
  onSuccess: async ({ accessToken, organizationId }) => {
    if (!sessionPolicyFor(organizationId)) return;

    const sid = sessionIdFromAccessToken(accessToken);
    if (!sid) return;

    const jar = await cookies();
    jar.set(SESSION_STAMP_COOKIE, await signSessionStamp(sid, Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Backstop only; the middleware age check is authoritative.
      maxAge: 60 * 60 * 24,
    });
  },
});
