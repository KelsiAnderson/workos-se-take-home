# Per-tenant security policy: 24h sessions + admin MFA

Covers requirement 5 of the brief: *"our biggest prospect has a security team
with two hard rules. Sessions expire 24 hours after sign-in, no exceptions, and
admins have to sign in with MFA. We need to enforce that for one customer
without changing anything for the rest."*

Modelled as a second organization, **Northwind Traders**, with a stricter policy
than Acme or any other tenant.

---

## 1. The platform boundary

The two rules land in different places, because WorkOS exposes them differently:

| Rule | Per-organization in WorkOS? | How it's done here |
| --- | --- | --- |
| Admins sign in with MFA | **Yes** — Organization Authentication Policies | Dashboard toggle on the Northwind org |
| Sessions expire 24h after sign-in | **No** — session lifetime is environment-wide (Applications → Sessions) | Enforced in `src/middleware.ts` against a per-tenant policy table |

WorkOS docs: [Organization Authentication Policies](https://workos.com/docs/authkit/organization-policies),
[Sessions](https://workos.com/docs/authkit/sessions).

---

## 2. MFA — native, per-organization

1. WorkOS Dashboard → **Organizations → Create Organization** → "Northwind Traders".
2. **Do not** attach an SSO connection. WorkOS's per-org MFA policy only applies
   to **non-SSO members** — for an SSO org, MFA is the IdP's responsibility, not
   WorkOS's. Northwind is an AuthKit email/password org.
3. Open Northwind → **Authentication Policy** → set **MFA** to **Required**.
4. AuthKit then handles TOTP enrollment and the MFA challenge natively on the
   next sign-in. Acme (SSO) and every other tenant are untouched.

**Interpretation note for the writeup:** the WorkOS per-org MFA policy is
**org-wide for non-SSO members**, not role-scoped. There is no "require MFA for
admins only" switch. Requiring it of everyone in the Northwind org satisfies
"admins have to sign in with MFA" and is stricter, not looser, than asked.

---

## 3. 24-hour session cap — enforced in middleware

WorkOS has no per-organization session-lifetime setting, and an access token
carries no "authenticated at" claim (only `iat`, which resets on every silent
refresh). So the sign-in time is recorded by the app and checked on every
request.

### Pieces

| File | Role |
| --- | --- |
| `src/lib/tenants.ts` | `Northwind` (`org_01M26FDRA9QEW6RME8KN1HJ8BD`) carries `sessionPolicy: { maxSessionAgeHours: 24 }`. `sessionPolicyFor(orgId)` looks it up. |
| `src/lib/session-policy.ts` | Signs / verifies the `sess_start` cookie (`sid:ts:HMAC-SHA256`, keyed with `WORKOS_COOKIE_PASSWORD`). |
| `src/app/callback/route.ts` | `handleAuth({ onSuccess })` — for a policy tenant, drops the signed `sess_start` cookie with the sign-in timestamp. |
| `src/middleware.ts` | For a policy tenant, re-checks the stamp every request; a stale / missing / wrong-session stamp forces a full re-auth. |

### Why it can't be bypassed

- `sess_start` is `httpOnly` and written **only** by the OAuth callback, so a
  user can't mint or extend one.
- The timestamp is HMAC-signed, so it can't be edited to a later time.
- Missing stamp + live session for a policy tenant → **fail closed** (forced
  re-auth). Deleting the cookie logs you out; it doesn't reset the 24h clock.
- On expiry the middleware clears `wos-session` and `workos-access-token` too,
  so the redirect to `/login` is a real logout, not a soft bounce.

### Config

The Northwind org id (`org_01M26FDRA9QEW6RME8KN1HJ8BD`) is hard-coded in
`src/lib/tenants.ts` alongside the other tenants. No env var. Adding a
`sessionPolicy` to any other tenant there is all it takes to give them the same
enforcement.

---

## 4. Demo walkthrough

Open Acme and Northwind side by side in the WorkOS Dashboard to show the policy
pages differ.

1. **MFA:** sign in to Northwind as a test user → AuthKit forces TOTP
   enrollment, then challenges on every sign-in. Sign in to Acme → no MFA
   prompt. Same app, same code.
2. **Session cap:** sign in to Northwind. Show the `sess_start` cookie in
   devtools (httpOnly, 24h). To demo the cutoff without waiting a day,
   temporarily lower `maxSessionAgeHours` for Northwind (or edit the cookie's
   timestamp — it'll fail the signature check and force re-auth, which also
   proves the tamper protection). The next request to `/`, `/account`, or any
   `/api/*` route redirects to `/login?org=northwind&error=session_expired`. An
   Acme session opened at the same time keeps working.
3. **Isolation:** point out `src/lib/tenants.ts` — the policy is one line of
   data keyed by org id. No other tenant's session length or auth flow changed.

---

## 5. SUBMISSION.md requirement-map entry

> **Per-tenant 24h session + admin MFA** — *WorkOS Dashboard → Organizations →
> Northwind Traders → Authentication Policy* (MFA); *`src/middleware.ts` +
> `src/lib/session-policy.ts` + `src/lib/tenants.ts`* (session cap).
>
> MFA is enforced natively by a WorkOS Organization Authentication Policy, which
> requires MFA for the org's non-SSO members — Acme (SSO) and all other tenants
> are unaffected. WorkOS session lifetime is environment-wide, not per-org, so
> the 24-hour cap is enforced in middleware against a per-tenant policy table,
> using an HMAC-signed sign-in-timestamp cookie set at the OAuth callback.
> Interpretation: WorkOS's per-org MFA policy is org-wide for non-SSO members,
> not role-scoped; requiring it of everyone in the Northwind org satisfies
> "admins must use MFA."
