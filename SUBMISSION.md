# Submission

Fill in every section and commit this file to your repo. Reviewers work from this document first, so treat it as part of the deliverable.

## 1. Links

Deployed URL, repo, and demo video.

- **Deployed app**: https://workos-se-take-home.vercel.app/
- **Repo**: https://github.com/KelsiAnderson/workos-se-take-home
- **Video**: https://www.youtube.com/watch?v=ArBMPjkEobU

## 2. Test credentials

Try it out! Grab a row below, sign in with those credentials at the deployed URL (§1), and follow that row's "what to try" to see that role's experience firsthand.

| Role | Email | Password | What to try while logged in as this user |
| ---- | ----- | -------- | ----------------------------------------- |
| Acme Corp — Admin | `kelsi@ochithreads.com` | `Kelsiacme12!` — this is the Okta account password, not a WorkOS/app password. Click **"Sign in to Acme Corp (Okta)"** on the homepage (`/login?org=acme`); Okta is set to re-prompt every sign-in, so enter this when challenged. | Invite a member, change a role, remove a member, try removing yourself (the last admin) and see the `409` block. |
| Acme Corp — Team Lead | `kelsi@ochithreads.com` (re-roled) | _same as above_ | In the WorkOS dashboard, set this membership's role to **Team Lead**, sign out and back in via Okta, then confirm the invite form's role dropdown only offers Team Lead / Compliance and the Remove column is gone. |
| Acme Corp — Compliance | `kelsi@ochithreads.com` (re-roled) | _same as above_ | Set the role to **Compliance** in the dashboard, sign back in, confirm `/members` is fully read-only (no invite form, no Revoke column). |
| Northwind Traders — Admin | `kelsi.anderson26+northwind@gmail.com` | `Kelsinorthwind12!` | Sign in at `/login?org=northwind`, complete the TOTP enrollment/challenge (MFA is required org-wide here), view Northwind's roster and confirm it shares no members with Acme. |

**Why Acme is one identity, re-roled:** Acme is intentionally SSO-only per requirement 4 — the *app* has no password login for Acme, full stop; `/login?org=acme` only ever routes into Okta. The password above is the Okta account's own login credential (Okta's Authentication Policy requires a factor — Password is one of the accepted ones — and is set to re-prompt on every sign-in), not a WorkOS/app-level password, so this doesn't reopen a non-SSO path into the app. The Okta developer trial only has one real identity provisioned (`kelsi@ochithreads.com`), so the three Acme personas are demonstrated by changing that membership's role in the WorkOS dashboard between segments, not by three separate logins. The demo video shows all three; a reviewer clicking through independently can reproduce the same thing using the WorkOS dashboard access below.

**WorkOS dashboard access:** granted separately from app logins — coordinate an invite email through the recruiting contact and I'll add it as a team member on the WorkOS account (Staging environment) so the reviewer can inspect the Acme and Northwind Organizations, the Okta SAML connection, the Authentication Policies, and re-role the Acme test identity directly.

## 3. Requirement map

One row per requirement as you understood them from the brief. Your enumeration is part of the answer.

| Scenario requirement | Where it's addressed (route / file / dashboard surface) | Notes on your interpretation |
| --------------------- | --------------------------------------------------------- | ------------------------------ |
| 1. Hard tenant isolation — a customer's people/data never bleed into another customer's view | `src/lib/workspace.ts` (`requireWorkspace`, `requireRole`), `src/app/api/get-name/members/route.ts`, isolation/IDOR tests across `src/app/api/**/route.test.ts` | `organizationId` and role are read only from the signed, httpOnly AuthKit session cookie — never from a URL param, request body, or header a client controls. No route accepts a tenant ID from the caller, so there's no parameter to tamper with to reach another org's data. Proven live in the demo by putting Acme's and Northwind's `/members` screens side by side under the same code path. |
| 2. Fully self-serve admin actions (invite, remove, change access) inside the app, no support ticket | `src/app/api/get-name/members/invite/route.ts`, `src/app/api/get-name/members/[id]/route.ts` (PATCH/DELETE), `src/app/api/get-name/invitations/route.ts` + `[id]/route.ts`, `src/app/members` (UI) | All mutations go through our own Next.js route handlers, never the WorkOS SDK from the browser (see the direct answer to the customer's frontend-API-key question below). A last-admin guard blocks removing or demoting the sole remaining admin (`409`), and `isCrossOrigin` (`src/lib/http.ts`) is a second CSRF layer on top of the session cookie's `SameSite=Lax`. |
| 3. Three role tiers: admin (runs the workspace), team lead (own people, no structural changes), compliance (sees everything, changes nothing) | `src/lib/roles.ts` (`ROLES`, `ROLE_DEFINITIONS`, `canGrantRole`/`GRANTABLE_BY_ROLE`), enforced via `requireRole` in every state-changing route; WorkOS Dashboard → environment Roles (`admin`, `team_lead`, `compliance` slugs, `compliance` set as default) | Named and presented per the brief's invitation to use our own judgment. `canGrantRole` separates "who may invite" from "who may grant which role" — without it, a team lead inviting someone was a privilege-escalation path to admin (found and fixed during requirement 2's work, see `docs/sso-okta.md` §5). Default role for an un-specified invite is `compliance`, the least-privileged option, not silently something stronger. |
| 4. Acme employees sign in through their own Okta — dealbreaker, no exceptions | `src/app/login/route.ts`, `src/lib/tenants.ts` (Okta SAML connection `g5ffp41p8...`, WorkOS Staging) | The app never gates SSO by role — `/login?org=acme` routes anyone into Acme's Okta connection, and in production an Okta admin assigns the SAML app to a group (not individual users), with WorkOS JIT-provisioning the org membership on first SSO login. That means no per-user manual setup is required on our side. The one caveat is environmental, not architectural: this demo's Okta trial only has a single real identity provisioned (`kelsi@ochithreads.com`), so the team-lead/compliance personas are simulated by re-roling that one identity in the WorkOS dashboard between segments (see `docs/demo-script.md` Act 3) rather than three distinct Okta logins. |
| 5. Per-tenant security policy for one strict customer: 24h session cap and admin MFA, without changing anything for other tenants | WorkOS Dashboard → Organizations → Northwind Traders → Authentication Policy (MFA: Required); `src/middleware.ts`, `src/lib/session-policy.ts`, `src/lib/tenants.ts`, `src/app/callback/route.ts` (session cap) | MFA is native and per-organization in WorkOS, so it's a dashboard toggle scoped to Northwind only — Acme and every other tenant are untouched. Session lifetime is *not* per-organization in WorkOS (it's an environment-wide setting), so the 24h cap is enforced in application middleware: an HMAC-signed `sess_start` cookie is written at the OAuth callback for any org carrying a `sessionPolicy`, and re-validated on every request, failing closed (forced re-auth) if it's missing, mismatched, or stale. Interpretation: WorkOS's org MFA policy applies to all non-SSO members of the org, not just admins — there's no role-scoped MFA switch — so requiring it org-wide for Northwind satisfies "admins must use MFA" and is stricter, not looser, than literally asked. |
| Customer engineering question: "can we just call the WorkOS API directly from the frontend with the API key?" | `src/app/api/get-name/**` (all mutating routes proxy through here); `WORKOS_API_KEY` is read only in server-side route handlers, never a `NEXT_PUBLIC_*` variable | No — pushed back on this, see §5. The API key never leaves the server; every mutation goes through our route handlers so `canGrantRole`, the last-admin guard, and CSRF checks run before WorkOS is ever touched, and response payloads are hand-projected so secrets like `acceptInvitationUrl` never reach the browser. |

## 4. Decision log

How you worked with AI on this engagement. Be specific: name files, prompts, and moments.

- **Tools used**: Claude Code, with the WorkOS agent skills (`workos`, `workos-widgets`) installed per the README, for implementation, tests, and the `docs/` reference material (`sso-okta.md`, `security-policies.md`, `implementation-overview.md`, `demo-script.md`).
- **Two or three things the AI produced that you kept, and why**:
  - The `canGrantRole` / `GRANTABLE_BY_ROLE` matrix in `src/lib/roles.ts`, separating "who may invite" from "who may grant a given role." It closed a real privilege-escalation path (a team lead could otherwise mint a new admin) that wasn't obvious from the brief alone.
  - The HMAC-signed `sess_start` cookie approach in `src/lib/session-policy.ts` for the Northwind 24h cap, once we established WorkOS session length is environment-wide, not per-org. Fail-closed by construction: no stamp or a bad signature forces re-auth rather than granting benefit of the doubt.
  - Rewriting the member directory to read live from `listOrganizationMemberships` + `listUsers` instead of a static in-memory seed (`src/lib/db.ts`, since deleted) — the static version went "split-brain" the moment an invite or role change happened, which would have been an embarrassing thing to hit live in the demo.
- **Two or three things you rejected or reworked, and why**:
  - An early version returned a generic `502` for every WorkOS failure, including "this email already has a pending invite" — that's a real client-correctable conflict, not an upstream outage, so it now gets its own `409` with a clear message (`src/app/api/get-name/members/invite/route.ts`).
  - When Okta's SSO started silently completing with no visible prompt during live debugging, the AI's first fix was "sign out of Google and Okta manually before each attempt." That didn't work and wasted a round trip — the real cause was Okta's Authentication Policy re-authentication frequency (12h), a policy-level setting that ignores a plain sign-out. Reworked into a real fix: set the policy rule's re-auth frequency to "every time" (see `docs/sso-okta.md` §6, last row).
- **The prompt or technique that paid off most**: Refusing to keep debugging from the WorkOS dashboard's and Okta admin UI's own error text (`"Invalid SAML Response"`, `oauth_provider_generic_error` — both too generic to act on) and instead pulling the actual `SAMLResponse` out of the browser's Network tab (DevTools → Copy as cURL, grabbed via clipboard so nothing got hand-retyped) and decoding the base64 XML directly. That's what actually distinguished "NameID is a display name, not an email" from "no attribute statements at all" from "valid response, org policy just doesn't require SSO for this user" — three different bugs that all produced near-identical symptoms in the dashboards.
- **The worst thing the AI gave you**: A long string of plausible-sounding but wrong guesses during the Okta debugging, made from indirect signals (UI text, console noise, generic error codes) instead of asking for the raw payload up front. In order:
  1. Pointed at a classic "Configure SAML" wizard / Name ID format dropdown in Okta that didn't exist in this org's admin UI version — had to be corrected before finding the real location.
  2. Three wrong attribute-statement expression forms in a row (`user.email` → "Invalid property email", `user.getInternalProperty('id')` → "Invalid function name", `user.login` → "Invalid property login") before landing on the correct `user.profile.{property}` syntax, which only turned up after actually fetching Okta's own docs instead of guessing again.
  3. Sent me to edit the Username field directly on the person's Okta profile (Directory → People), which Okta blocked ("Username is set by Acme Corp - WorkOS") — wrong path entirely; the real fix was the per-app "Assigned Applications" override on that person.
  4. Chased a certificate-mismatch theory for the generic "Invalid SAML Response" error, which took decoding and cryptographically verifying the signature with `signxml` to rule out — the actual cause (missing Attribute Statements) was unrelated to the cert.
  5. When sign-in started silently completing with no visible prompt, first fix was "sign out of Google and Okta manually" — wrong; the real cause was Okta's Authentication Policy re-authentication frequency (12h), which a plain sign-out doesn't touch.
  6. Pointed at a "Global Session Policy → Sign On tab" location in Okta admin for that re-auth setting, which also didn't exist in this org's UI — the setting turned out to live inside the app's assigned Authentication Policy rule instead.

  Every one of these got corrected only because I pushed back with what was actually on screen rather than accepting the first explanation. The pattern that broke the cycle was insisting on raw evidence (the actual SAML payload, the actual WorkOS Events entry, the actual Okta docs) over guessing from UI descriptions — see "prompt that paid off most" above.

## 5. Pushback

Anything in the brief you'd push back on as the SE, and what you'd propose instead.

- **"Can the demo just call the WorkOS API directly from the frontend with the API key?"** No. A secret key shipped to the browser is visible in the JS bundle and in every DevTools Network request — any signed-in user (or anyone who opens dev tools) would have the same power as your backend: create/remove members, escalate roles, and query any Organization, since a raw API key isn't scoped to "the caller's org and role." It also throws away every check we built in — `canGrantRole`, the last-admin lockout, CSRF validation — because those live in our route handlers, not in WorkOS's API surface. Proposal (already built): keep the API key server-side only, proxy every mutation through your own backend route handlers, and let the session cookie (not a client-supplied credential) carry identity, tenant, and role.
- **The brief says "admins can invite people"** — I read this as "admins, plus team leads for their own reports," since requirement 3 explicitly gives team leads responsibility for "their own people," and a self-serve model where every new hire needs an admin is not really self-serve for a team lead. `canGrantRole` caps what a team lead can grant (never admin) so this reading doesn't reopen the privilege-escalation risk above.
- **"Admins have to sign in with MFA" (requirement 5)** — WorkOS's per-organization MFA policy has no admin-only mode; it's all-or-nothing for the org's non-SSO members. Rather than treat that as a gap, I'd tell Priya's team it's a stricter guarantee than they asked for (every Northwind user is covered, not just admins) and confirm that's acceptable before they roll it out to a customer who might have opinions about MFA friction for non-admin staff.

## 6. Cut list

What you'd do next with more time, roughly in order.

1. Provision one or two more real Okta identities (or local Okta users) so the demo can show independent SSO logins for team-lead and compliance, instead of re-roling one identity in the dashboard.
2. Map Okta groups to WorkOS roles (SAML `groups` attribute + WorkOS role mapping) so role assignment happens in Okta, where Acme's IT already manages access, rather than by hand in the WorkOS dashboard.
3. Replace the static `src/lib/tenants.ts` slug→org-ID table with a real lookup (by email domain or subdomain), which is the shape it's already written to swap into.
4. The customer-success Slack ping on member add/remove (brief's "down the road" item), using WorkOS Pipes — explicitly optional, not attempted here for time.
5. Clean up the stray `member`-role membership in Acme (`kelsi.anderson26+acme@gmail.com`) left over from setup — harmless (RBAC doesn't grant that slug any write access) but worth tidying before a customer-facing review.
6. Dial Okta's Authentication Policy re-authentication frequency back down from "every time" (set during SSO debugging so the prompt was visible on every attempt) to a normal window once the integration is stable — see `docs/sso-okta.md` §7.

_(JIT provisioning is already enabled — see requirement 4 in §3 and `docs/sso-okta.md` §7 — so it's no longer on this list.)_
