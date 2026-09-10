# Okta SAML SSO for Acme Corp

Covers requirement 4 of the brief: *"Acme won't roll this out unless their
employees sign in through their own Okta. No Okta, no deal."*

This document is the reference for how SSO is wired, the decisions behind it,
the problems hit while setting it up, and how to demo it.

---

## 1. What was built

A user at Acme Corp signs in at `/login?org=acme`, is redirected to Acme's own
Okta, authenticates there, and lands back in the app with a session scoped to
the Acme workspace and a role that drives what they can do.

| Layer | Piece |
| --- | --- |
| WorkOS | Staging environment. A SAML **SSO connection** on the **Acme Corp** Organization (`org_01M22148…`). |
| Okta | A manually-built **SAML 2.0 app** in an Okta Developer trial (`trial-4936233.okta.com`), users assigned to it. |
| App | `/login?org=acme` → `getSignInUrl({ organizationId })` → Okta → `/callback` → session with `organizationId` + `role`. |

Everything runs against WorkOS **Staging**; the app's `WORKOS_API_KEY` is an
`sk_test_…` key, so localhost redirect URIs are allowed and no deployed URL is
required to test.

---

## 2. Architecture

```
Browser
  │  GET /login?org=acme
  ▼
App  ── resolveTenant("acme") → org_01M22148…
  │  getSignInUrl({ organizationId }) → WorkOS authorize URL
  ▼
WorkOS ── routes to Acme's SSO connection
  ▼
Okta (trial-4936233) ── SAML: user authenticates, POSTs assertion to
  │                     https://auth.workos.com/sso/saml/acs/g5ffp41p8CNEEr06eV99EX10g
  ▼
WorkOS ── validates assertion, finds/creates the WorkOS user,
  │       resolves the Acme organization membership + role
  │       redirects to the app callback with a code
  ▼
App  /callback (handleAuth) ── exchanges code, seals the session cookie
  ▼
withAuth() → { user, organizationId: "org_01M22148…", role: "admin" }
```

Two important properties:

- **Identity, tenant, and role come only from the sealed session cookie.** No
  API route trusts an org ID or role from the URL, body, or a header. See
  `src/lib/workspace.ts`.
- **The org selector cannot widen access.** `/login?org=acme` only picks which
  Organization to authenticate against. The session's `organizationId` and
  `role` are set by WorkOS *after* the user actually authenticates with Okta,
  from their real membership — not from the query parameter.

---

## 3. Setup steps (reproducible)

### 3.1 WorkOS — start the connection

1. Dashboard → **Staging** environment.
2. **Applications** section → **Redirects** → add `http://localhost:3000/callback`.
3. **Organizations → Acme Corp → Single Sign-On → Configure Connection → Okta
   SAML**. WorkOS shows:
   - **ACS URL**: `https://auth.workos.com/sso/saml/acs/g5ffp41p8CNEEr06eV99EX10g`
   - **SP Entity ID**: `g5ffp41p8CNEEr06eV99EX10g`

### 3.2 Okta — build the SAML app

**Applications → Applications → Create App Integration → SAML 2.0.**

| Okta field | Value |
| --- | --- |
| Single sign-on URL | `https://auth.workos.com/sso/saml/acs/g5ffp41p8CNEEr06eV99EX10g` |
| Use this for Recipient / Destination | checked |
| Audience URI (SP Entity ID) | `g5ffp41p8CNEEr06eV99EX10g` |
| Name ID format | `Unspecified` |
| Application username | `Custom` → `user.getInternalProperty("id")` |
| Update application username on | Create and update |

Attribute Statements (Name format `Basic`):

| Name | Value |
| --- | --- |
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

No group attribute — roles are assigned in WorkOS (see decision 3).

Then: **Assignments** tab → assign the users who should be able to sign in →
**Sign On** tab → copy the **Metadata URL**
(`https://trial-4936233.okta.com/app/exk17g3w8kcrqz81H698/sso/saml/metadata`).

### 3.3 WorkOS — finish the connection

1. Connection → **Identity Provider Configuration → Edit configuration →
   Dynamic configuration** → paste the Metadata URL → Save. Status → **Active**.
2. **Authentication → Roles** — the environment needs `admin`, `team_lead`, and
   `compliance` (slugs must match `src/lib/roles.ts` exactly). Set `compliance`
   as the default role.

### 3.4 App

Nothing to configure beyond the existing `.env.local`
(`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`,
`NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback`). `npm run dev`,
then use the **"Sign in to Acme Corp (Okta)"** button on the home page.

---

## 4. Decisions

1. **Manual SAML app in Okta, not the Okta Integration Network app.** Every
   field is visible and explainable in the demo video; nothing hidden behind a
   one-click integration.

2. **Explicit org selector (`/login?org=acme`), not email-domain routing.** The
   demo/seed users sign in with `@gmail.com` addresses, which AuthKit cannot map
   to an Organization by domain. `src/lib/tenants.ts` holds a slug → org-ID
   registry; in production this lookup would be a database query keyed by the
   customer's email domain or subdomain, so the shape stays the same and the
   swap is localized. Plain `/login` still goes to AuthKit's hosted screen.

3. **Roles assigned in WorkOS, not driven by Okta groups.** Simpler for a
   time-boxed evaluation. Group-based IdP role mapping is a configuration
   change — add a `groups` SAML attribute in Okta and map it in WorkOS — not a
   code change. Listed as a next step.

4. **`compliance` is the default role.** Least privilege: a user who is
   provisioned without an explicit role lands read-only, matching `DEFAULT_ROLE`
   in `src/lib/roles.ts`. Admin access is granted deliberately.

5. **Name ID = `Unspecified`; Application username = Okta's internal user ID.**
   Per WorkOS's Okta guide. WorkOS gets a stable identifier that survives the
   user changing their email; the human-readable email and name come from the
   mapped attribute statements.

6. **The member directory reads live from WorkOS.** `GET /api/members`
   previously read a static in-memory seed, so invitations, role changes,
   removals, and SSO logins never showed up in it ("split-brain"). It now joins
   `listOrganizationMemberships` + `listUsers` scoped to the caller's org. One
   source of truth; the static `src/lib/db.ts` was deleted.

7. **`requireRole` returns the caller's held role slugs.** So a handler can make
   a second, finer-grained authorization decision (below) without another
   `withAuth()` round-trip.

---

## 5. Related fix: invite privilege-escalation

Found while working through requirement 3.

**Problem.** `POST /api/members/invite` is open to admins *and* team leads (team
leads look after their own people). It validated the requested role only against
"is this an assignable role" — a list that includes `admin`. So a team lead
could invite a new user straight in as an **admin** and effectively escalate to
full workspace control.

**Fix.** Being allowed to invite is now separate from being allowed to grant a
given role. `src/lib/roles.ts` gained `canGrantRole(callerRoles, targetRole)`
backed by a matrix:

| Caller | May assign |
| --- | --- |
| `admin` | `admin`, `team_lead`, `compliance` |
| `team_lead` | `team_lead`, `compliance` |
| `compliance` | — |

Enforced in the invite route and in `PATCH /api/members/[id]` (the latter is
admin-only today, so the check is a guard against the gate ever being widened).
Covered by new tests.

---

## 6. Problems hit during setup (and fixes)

These are the non-obvious ones — useful for anyone reproducing this or debugging
a similar setup.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Couldn't find "Redirects" in the WorkOS dashboard | It lives in the **Applications** section (with API keys), not under "Authentication", and is unrelated to "Organizations" (those are customer tenants) | Applications → Redirects |
| Okta: **"User is not assigned to this application"** | SSO authenticates as your *current Okta session* — the trial admin (`kelsi@ochithreads.com`) — but only a separately-created test user was assigned to the app | Assign the account you are actually logged into Okta as; use an incognito window to test as a different user |
| Only `admin` and `member` roles existed in WorkOS | `member` is the scaffold default; the brief's three personas weren't created | Create `team_lead` and `compliance`; slugs must match `src/lib/roles.ts` |
| After a successful SSO login, the session had **`organizationId: null` and `role: null`** — every API route returned `401 "missing active workspace"` | The SSO login authenticated the user but **did not create an Organization membership** in Acme. WorkOS/AuthKit only attaches an org + role to the session when the user has a membership. | Add the membership (manually for now: Organizations → Acme Corp → Members → add user → role); enable **JIT provisioning** on the connection so this is automatic for real users |
| Changed a role in WorkOS but the app still showed the old one | The role is baked into the access token at sign-in. WorkOS docs: *"Roles are granted to SSO profiles when the user authenticates."* | Sign out and back in |

---

## 7. Automatic vs. manual / known limitations

- **JIT provisioning is not yet enabled on the connection.** The first SSO user
  had to be added to the Acme organization by hand. Turning on JIT provisioning
  (connection settings) makes "an Acme employee just signs in through Okta"
  work with no WorkOS-side step — which is the actual requirement. Do this
  before the demo.
- **One SSO identity is set up so far** (`kelsi@ochithreads.com`, admin). A
  second Okta user provisioned as `compliance` or `team_lead` would demonstrate
  requirement 3 through real SSO rather than only through tests.
- **A stray `member`-role membership** (`kelsi.anderson26+acme@gmail.com`)
  exists in Acme. The app's RBAC doesn't model `member`, so that user can read
  but not act. Delete it or re-role it for a clean demo.
- **No production redirect URI.** When the app is deployed, add
  `https://<domain>/callback` to WorkOS → Applications → Redirects. No Okta
  change is needed — Okta only ever talks to WorkOS's ACS URL.
- **The member-management APIs have no UI yet.** SSO and the APIs behind
  requirements 2–3 work and are tested, but a reviewer clicking the deployed app
  can't exercise invite / change-role / remove without a frontend.

---

## 8. Demo walkthrough

1. **Home page → "Sign in to Acme Corp (Okta)".** Point out this goes to Acme's
   *own* Okta, not a WorkOS login.
2. **Authenticate in Okta.** (In the trial, `kelsi@ochithreads.com` federates
   through Google — that's Okta's config, not ours.)
3. **Land back in the app.** `/account` shows the email, name, and **Role**, all
   from the WorkOS session.
4. **`GET /api/members`** returns the Acme roster read live from WorkOS —
   membership status and role joined with each user's email and name.
5. **Tenant isolation:** the session is pinned to `org_01M22148…`; no route
   accepts an org ID from the caller, so an Acme user cannot enumerate another
   customer's members. Backed by the isolation tests in
   `src/app/api/**/route.test.ts`.
6. **Roles:** as `admin`, invite / change-role / remove work; as `compliance`,
   the same calls return `403`. A team lead can invite but cannot grant `admin`.

---

## 9. Reference values

| | |
| --- | --- |
| WorkOS environment | Staging |
| Acme Corp Organization ID | `org_01M22148NBHDQSB8DCE7TRNK56` |
| SSO connection ACS URL | `https://auth.workos.com/sso/saml/acs/g5ffp41p8CNEEr06eV99EX10g` |
| SSO connection SP Entity ID | `g5ffp41p8CNEEr06eV99EX10g` |
| Okta org | `https://trial-4936233.okta.com` |
| Okta SAML app metadata URL | `https://trial-4936233.okta.com/app/exk17g3w8kcrqz81H698/sso/saml/metadata` |
| Redirect URI | `http://localhost:3000/callback` |
| Role slugs | `admin`, `team_lead`, `compliance` (default: `compliance`) |
