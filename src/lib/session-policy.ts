// Per-tenant session-age enforcement.
//
// WorkOS session lifetime is an environment-wide setting (Applications →
// Sessions), not a per-organization one, and an access token carries no
// "authenticated at" claim — only `iat`, which resets on every silent refresh.
// So to give one tenant a hard "expire 24h after sign-in" rule without touching
// anyone else's session length, we record the sign-in moment ourselves.
//
// At the OAuth callback we drop an HMAC-signed cookie `sess_start = sid:ts:sig`.
// `ts` is the sign-in time; `sid` ties the stamp to that specific WorkOS
// session; `sig` is HMAC-SHA256 over `sid:ts` keyed with WORKOS_COOKIE_PASSWORD
// so the timestamp can't be forged. The middleware re-checks it on every
// request for a strict-policy tenant.
//
// The cookie is httpOnly and only ever written by the callback, so a user
// cannot mint or extend one. Deleting it just fails closed (missing stamp →
// forced re-auth), it does not reset the clock.
//
// Pure Web Crypto + string ops — safe to import from both the Edge middleware
// and the Node callback route.

export const SESSION_STAMP_COOKIE = "sess_start";

// AuthKit's own session cookies, cleared alongside our stamp on a forced logout.
export const WORKOS_SESSION_COOKIES = ["wos-session", "workos-access-token"];

const encoder = new TextEncoder();

async function hmacHex(payload: string): Promise<string> {
  const secret = process.env.WORKOS_COOKIE_PASSWORD ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time compare of two equal-purpose hex strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export type SessionStamp = { sid: string; issuedAt: number };

// Build the signed cookie value for a session that just signed in.
export async function signSessionStamp(
  sid: string,
  issuedAt: number,
): Promise<string> {
  const payload = `${sid}:${issuedAt}`;
  return `${payload}:${await hmacHex(payload)}`;
}

// Parse and verify a cookie value. Returns null for anything missing, malformed,
// or with a bad signature — callers treat null as "no valid stamp".
export async function readSessionStamp(
  value: string | undefined | null,
): Promise<SessionStamp | null> {
  if (!value) return null;

  const sigSep = value.lastIndexOf(":");
  if (sigSep < 0) return null;
  const payload = value.slice(0, sigSep);
  const signature = value.slice(sigSep + 1);

  if (!safeEqual(signature, await hmacHex(payload))) return null;

  const idSep = payload.indexOf(":");
  if (idSep < 0) return null;
  const sid = payload.slice(0, idSep);
  const issuedAt = Number(payload.slice(idSep + 1));
  if (!sid || !Number.isFinite(issuedAt)) return null;

  return { sid, issuedAt };
}

// Pull the `sid` claim out of a WorkOS access token without verifying it — the
// token comes straight from `authenticateWithCode`, so it's already trusted.
export function sessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const segment = accessToken.split(".")[1];
    if (!segment) return null;
    const json = atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { sid?: string };
    return claims.sid ?? null;
  } catch {
    return null;
  }
}
