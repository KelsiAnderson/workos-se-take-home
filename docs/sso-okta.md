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
| Application username | `Custom` — mapped via **General → SAML Settings → Configure profile mapping**, `login` and `email` fields, not typed directly into the Sign On tab |
| Update application username on | Create and update |

Attribute Statements — this Okta org runs the newer "EL for OIE" expression
language, which requires the `user.profile.{property}` form. Bare `user.email`
and functions like `user.getInternalProperty("id")` both fail validation here
(`Invalid property …` / `Invalid function name …`) even though they're the
syntax shown in older Okta SAML guides:

| Name | Expression |
| --- | --- |
| `id` | `user.profile.login` |
| `email` | `user.profile.email` |
| `firstName` | `user.profile.firstName` |
| `lastName` | `user.profile.lastName` |

All four are **required** — WorkOS's connection has `idpId`/`email`/`firstName`/`lastName`
each marked Required in its Attribute mapping (Connection → Attribute mapping).
Missing any of them fails the whole SAML response with a generic
`{"code": "server_error", "message": "Invalid SAML Response"}` in WorkOS's
Events log — it does not say which attribute is missing, or that attributes
are the problem at all.

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

5. **Name ID = `Unspecified`, value = the user's email; Application username
   is sourced from the Profile Mapping, not typed into the Sign On tab.**
   WorkOS pulls email from the NameID *and* from the `email` attribute
   statement, so both need to actually carry the email — not a display name.
   The per-app username is driven by **General → Configure profile mapping**
   (`login`/`email` fields); the individual "Assigned Applications" entry for
   a user (Directory → People → *user* → Applications) can also carry a
   manually-typed override that silently wins over the mapping, with no
   indication in the UI that it's doing so — see §6.

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
| NameID kept coming through as the user's **display name** ("Kelsi Anderson Ochi") instead of their email, no matter what the Custom username expression or profile mapping said | The per-user **Assigned Applications** entry (Directory → People → *user* → Applications → pencil icon next to the app) carries its own manually-typed username, entered once at assignment time, which silently overrides any mapping or expression — nothing in the Sign On tab or Profile Mapping UI shows that an override exists | Edit the per-user assignment directly and set it to the real email |
| WorkOS Events logged `authentication.sso_failed`, `{"code": "server_error", "message": "Invalid SAML Response"}` — identical message before *and* after the NameID fix above, with `email: null` both times | The Okta app had **zero Attribute Statements configured**. WorkOS's connection requires `idpId`/`email`/`firstName`/`lastName` (Connection → Attribute mapping, all marked Required) and fails the whole response as a generic, undifferentiated error when any are missing — it never says "missing attribute," so this looks identical to a signature or config problem | Add all four Attribute Statements (see §3.2). Confirmed via `signxml` that the Response- and Assertion-level signatures were valid and the cert matched WorkOS's trusted cert the whole time — the failure was purely the missing attributes, not crypto |
| Attribute Statement expressions errored: `Invalid property email in expression user.email`, `Invalid function name getInternalProperty in expression user.getInternalProperty('id')`, `Invalid property login in expression user.login` | This Okta org uses the newer "EL for OIE" expression language, which only accepts `user.profile.{property}` — the bare `user.{property}` form and `getInternalProperty()` from older Okta SAML guides aren't supported in this dialog | Use `user.profile.email`, `user.profile.firstName`, `user.profile.lastName`, `user.profile.login` |
| SSO "succeeded" per Okta's own System Log, but signing in through the app showed AuthKit's generic email/social chooser and sent an email one-time code instead of going to Okta | Acme Corp's WorkOS Organization policy is **"SSO required for domain members"** — scoped to a verified domain. The test identity's email domain (`ochithreads.com`) wasn't registered as a domain on the org, so WorkOS treated the sign-in as a guest and didn't enforce SSO | Organizations → Acme Corp → add `ochithreads.com` as a verified domain |
| After every fix above, sign-in kept silently completing with no visible Okta prompt at all — looked identical whether something was still broken or genuinely fixed | Okta's **Authentication Policy** for the app (Security → Authentication Policies → the policy assigned to this app, e.g. "Any two factors" → its rule) had **Re-authentication frequency: Every 12 hours**, so Okta silently reused the existing session on every retry regardless of app-side or browser-side changes — this is *separate* from the SSO session cookie and isn't cleared by a normal sign-out | Set the rule's re-authentication frequency to "Every time user signs in to resource" while actively debugging or recording a repeatable demo |

The bottom two rows in particular are worth calling out: several of these
problems produced *the exact same symptom* (generic error, or "nothing
happens"), so the only reliable way to tell them apart was decoding the raw
`SAMLResponse` payload (base64 → XML) from the browser's Network tab and
checking it directly — the WorkOS dashboard and Okta admin UI's own error
text were not specific enough to distinguish "bad NameID" from "missing
attributes" from "valid response, org policy doesn't require SSO for this
user" from "valid response, Okta just isn't re-prompting."

---

## 7. Automatic vs. manual / known limitations

- **JIT provisioning is enabled** (Organization → Authentication → User
  provisioning → "JIT-provision SSO users"). A new Acme employee's first Okta
  sign-in now creates their org membership automatically, no WorkOS-side
  manual step required — this satisfies the "no ticket to us" part of
  requirement 4.
- **Okta's Authentication Policy re-authentication frequency is set to
  "Every time user signs in to resource"** for the demo/debug period, so the
  SSO prompt is visible on every attempt. This trades away Okta's normal
  frictionless-repeat-login convenience; a real Acme rollout would likely want
  a longer window (e.g. the default 12h) once the integration is stable.
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
2. **Authenticate in Okta.** (In the trial, `kelsi@ochithreads.com` is a
   native Okta account with its own password, challenged on every sign-in —
   that's Okta's config, not ours.)
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
