# Implementation overview

Everything built for the Meridian Analytics evaluation, mapped to the five
requirements in `SCENARIO.md`, with the reasoning behind each piece.

Companion docs: [`sso-okta.md`](./sso-okta.md) (requirement 4),
[`security-policies.md`](./security-policies.md) (requirement 5).

Stack: Next.js 15 (App Router) + WorkOS AuthKit (`@workos-inc/authkit-nextjs`).
**86 tests across 9 suites**, `tsc` and lint clean, production build passes.

---

## Foundation (cross-cutting)

### `src/lib/workspace.ts` — server-side authorization gates

| Export | What it does |
| --- | --- |
| `requireWorkspace()` | Resolves `{ userId, organizationId }` from the signed AuthKit session cookie (`withAuth()`) — never from the URL, body, query, or a client header. `401` if unauthenticated or no active organization. |
| `requireRole(allowed)` | `requireWorkspace()` + confirms the caller holds one of `allowed` (accepts AuthKit's `role` string *or* `roles[]` array). `401` before `403`. Returns `AuthorizedWorkspace = { userId, organizationId, roles }`. |
| `requireAdminWorkspace()` | `requireRole([admin])` — the common case. |

**Why:** one place decides "who is this and what may they do," reading only
from the tamper-proof session. Every route handler stays a straight line:
`const ws = await requireX(); if (ws instanceof NextResponse) return ws;`.
Returning the caller's `roles` lets a handler make a second, finer decision
(e.g. "which roles may this caller grant") without another round-trip.

### `src/lib/roles.ts` — single source of truth for the role model

- `ROLES = { admin, team_lead, compliance }`, `RoleSlug` type — slugs match the
  WorkOS Organization exactly.
- `DEFAULT_ROLE = compliance` — an invite that names no role lands read-only,
  not with more access.
- `ROLE_DEFINITIONS` — user-facing label + description per role (for a future UI
  so labels are never hard-coded next to a slug).
- `ASSIGNABLE_ROLES` + `isAssignableRole()` — allowlist; an unknown, misspelled,
  or unmodeled slug is rejected before it reaches WorkOS.
- `GRANTABLE_BY_ROLE` + `canGrantRole(callerRoles, targetRole)` — per-role grant
  matrix: admin → any; team_lead → team_lead / compliance; compliance → none.

**Why:** the invite route and the role-change route validate against the same
definitions. "Which roles exist" and "who may hand out what" live in one file.

### `src/lib/http.ts` — `isCrossOrigin()`

Defense-in-depth CSRF. The AuthKit cookie is `SameSite=Lax` (layer 1); as a
second layer, when the browser sends an `Origin` header we require it to match
`Host`. Missing `Origin` is allowed; an unparseable one counts as cross-origin.

**Why:** every state-changing route (invite, role change, remove, revoke) gets a
second CSRF layer that doesn't depend on cookie policy alone.

### `src/lib/tenants.ts` — tenant registry

`TENANTS`: slug → `{ name, organizationId, sessionPolicy? }` for `acme`,
`northwind`, `strawberry`. Helpers: `resolveTenant(slug)`,
`tenantByOrganizationId(orgId)`, `sessionPolicyFor(orgId)`.

**Why:** WorkOS Organization IDs are defined once; org-scoped sign-in and the
per-tenant session policy read from here. In production this lookup would be a
database query keyed by the customer's email domain — deliberately the same
shape, so swapping it doesn't touch callers.

---

## Requirement 1 — each customer is its own walled-off workspace

> *"If someone at Acme can see another customer's members, we're done."*

Every API route derives the tenant from `organizationId` on the **signed
session** and scopes every WorkOS/data query to it. No route accepts an
organization identifier as an argument, so a caller cannot widen the scope.

- **`GET /api/get-name/members`** — `requireWorkspace()` → reads live from WorkOS
  (`listOrganizationMemberships` + `listUsers`, both scoped to the org, joined on
  `userId`) → `{ id, userId, organizationId, email, name, role, status }`.
- **`GET /api/get-name/invitations`** — same scoping, pending invites only,
  projection strips `token` / `acceptInvitationUrl`.
- **`[id]` routes** — re-fetch the membership/invitation and confirm it belongs
  to the caller's org before acting. A record in another tenant and a
  non-existent id return an **identical 404**, so ids can't be probed.

Covered by tenant-isolation and IDOR tests in every route's `*.test.ts`.

---

## Requirement 2 — admins manage their workspace, self-serve, in-app

> *"invite people, remove them, and change their access … without opening a ticket."*

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/api/get-name/members/invite` | POST | admin, team_lead | validate body → `canGrantRole` → `sendInvitation` pinned to the session org, records `inviterUserId`, 7-day expiry. Response omits the invite token. |
| `/api/get-name/members/[id]` | PATCH | admin | ownership check → `canGrantRole` → **last-admin guard (409)** → `updateOrganizationMembership` |
| `/api/get-name/members/[id]` | DELETE | admin | ownership check → **last-admin guard (409)** → `deleteOrganizationMembership` → 204 |
| `/api/get-name/invitations/[id]` | DELETE | admin | ownership check → 409 if not pending → `revokeInvitation` → 204 |

All four: `isCrossOrigin` → 403; malformed input → 400 (never 500); upstream
failure → generic **502** with detail logged server-side (never confirm/deny an
account or leak internals).

**Why the last-admin guard:** demoting or removing the only remaining active
admin would lock every admin action out of the workspace.

---

## Requirement 3 — admins, team leads, compliance

> *"admins who run the workspace; team leads who look after their own people;
> compliance folks who … must not be able to change anything."*

| Capability | admin | team_lead | compliance |
| --- | :-: | :-: | :-: |
| View members / invitations | ✓ | ✓ | ✓ |
| Invite a member | ✓ | ✓ (not as `admin`) | — |
| Change a role / remove a member / revoke an invite | ✓ | — | — |

- **Compliance = read-only everywhere.** 403 on every mutation; full read access
  to members and invitations. That's the "see everything, change nothing"
  persona.
- **Team leads can invite but not grant `admin`** (`canGrantRole`). Being
  allowed to invite is not the same as being allowed to hand out any role —
  without this, invite is a privilege-escalation path (a team lead could mint an
  admin). This is a deliberate reading of "look after their own people";
  removal and re-roling stay admin-only.
- `requireRole` matches against `role` or `roles[]`, exact — `"administrator"`
  is not `"admin"`.

---

## Requirement 4 — Acme signs in through their own Okta

> *"no Okta, no deal."*

Full setup and the problems hit along the way are in
[`sso-okta.md`](./sso-okta.md). Code:

- **`src/app/login/route.ts`** — `/login` → AuthKit hosted screen;
  `/login?org=acme` → `getSignInUrl({ organizationId })` → straight to Acme's
  SAML connection. Needed because the seed users' `@gmail.com` addresses can't
  be routed to an organization by email domain. `org` only *selects* the
  organization to authenticate against — the session's org and role are set by
  WorkOS *after* the user authenticates with Okta.
- **`src/app/page.tsx`** — "Sign in to Acme Corp (Okta)" button.
- **WorkOS/Okta** — Staging; SAML connection on the Acme Organization; a
  manually-built Okta SAML 2.0 app; metadata exchanged; connection Active. The
  three role slugs created in WorkOS with `compliance` as the default.

Verified end to end: SSO login → org-scoped session → role → member directory
reads the Acme roster live from WorkOS.

---

## Requirement 5 — per-tenant policy for the strict prospect

> *"Sessions expire 24 hours after sign-in, no exceptions, and admins have to
> sign in with MFA … for one customer without changing anything for the rest."*

Modelled as a second organization, **Northwind Traders**. Full detail in
[`security-policies.md`](./security-policies.md).

### MFA — native, per-organization

Environment MFA set to **Optional** ("enforcement configured by organization
membership") → Northwind's org policy set to **Require MFA**. AuthKit then
drives TOTP enrollment and the challenge on sign-in. Applies to non-SSO members
only and is org-wide, not role-scoped (documented interpretation — requiring it
of everyone in the org covers "admins must use MFA"). Acme and every other
tenant are untouched.

### 24-hour session cap — enforced in middleware

WorkOS session lifetime is an **environment-wide** setting, and access tokens
carry no "authenticated at" claim, so the sign-in time is recorded by the app.

| File | Role |
| --- | --- |
| `src/lib/session-policy.ts` | signs / verifies `sess_start = sid:ts:HMAC-SHA256` (keyed with `WORKOS_COOKIE_PASSWORD`, Web Crypto so it runs on the Edge). |
| `src/app/callback/route.ts` | `handleAuth({ onSuccess })` — for a policy tenant only, drops the signed `sess_start` httpOnly cookie with the sign-in timestamp. |
| `src/lib/tenants.ts` | Northwind carries `sessionPolicy: { maxSessionAgeHours: 24 }`. |
| `src/middleware.ts` | **rewritten** from `authkitMiddleware()` to the composed `authkit()` + `handleAuthkitHeaders()` form. For a policy tenant, a stale / missing / wrong-session stamp clears `wos-session` + `workos-access-token` + `sess_start` and redirects to `/login?org=<slug>&error=session_expired`. |

**Tamper-resistance:** the cookie is httpOnly and written only by the callback,
the timestamp is HMAC-signed, and a missing stamp on a live policy-tenant
session **fails closed** (forced re-auth) — deleting the cookie logs you out, it
doesn't reset the clock.

---

## Test coverage — 86 tests / 9 suites

| Suite | Focus |
| --- | --- |
| `lib/workspace.test.ts` | auth gates; 401-before-403; no substring role match; `roles[]` support |
| `lib/roles.ts` (via route tests) | assignable allowlist; `canGrantRole` matrix |
| `lib/tenants.test.ts` | slug ↔ org-id lookups; session-policy lookup |
| `lib/session-policy.test.ts` | stamp codec; forged-timestamp / swapped-sid / wrong-secret rejection; sid extraction |
| `middleware.test.ts` | passthrough vs forced re-auth; cookie clearing; org slug in the redirect |
| `api/.../members/route.test.ts` | tenant isolation; membership↔user join; 502 |
| `api/.../members/invite/route.test.ts` | RBAC; escalation block; tenant scope can't be widened via body; token non-leak; CSRF; input validation |
| `api/.../members/[id]/route.test.ts` | PATCH/DELETE; IDOR 404; last-admin guard; `canGrantRole` |
| `api/.../invitations/*.test.ts` | isolation; revoke; 409 non-pending; token non-leak |

---

## Deliberate deviations from the brief (call these out in the demo)

1. **Team leads can invite**, not just admins — a reading of "look after their
   own people." They still cannot change roles, remove members, or grant `admin`.
2. **MFA is required org-wide for Northwind's non-SSO members**, not just admins —
   WorkOS's per-org MFA policy has no role scope. Stricter than asked, not looser.
3. **`compliance` is the default role** for an unspecified invite / JIT-provisioned
   SSO user — least privilege.

---

## Known gaps / cut list

This list is kept current in `SUBMISSION.md` §6 — see that for the up-to-date,
prioritized cut list. (This section previously duplicated it and drifted out
of sync: the member-management UI, JIT provisioning, the deployed URL, and
`SUBMISSION.md` itself all shipped after this document was first written, but
the list below wasn't updated alongside them.)

Two items remain accurate and worth keeping here, since they're implementation
details rather than roadmap items:

- Single session per browser — switching between customer workspaces needs a
  sign-out. Normal for a B2B app.
- The `member` WorkOS role exists in the environment but isn't modelled by the
  app; the `/api/get-name/` path prefix is the scaffold's and was never renamed.
