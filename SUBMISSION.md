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

Here's how I read each requirement — where I built it, and where I made a judgment call.

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

**Tools used:** Claude Code with the WorkOS agent skills (`workos`, `workos-widgets`) installed per the README. Used for full implementation, unit/integration test coverage, and generating reference materials under `docs/` (`sso-okta.md`, `security-policies.md`, `implementation-overview.md`, and `demo-script.md`).

**Two or three things the AI produced that you kept, and why:**

- The `canGrantRole` / `GRANTABLE_BY_ROLE` matrix in `src/lib/roles.ts`: It neatly separated "who can invite" from "who can assign a specific role." This closed a critical privilege-escalation path (a Team Lead using invites to mint new Admins) that wasn't explicitly flagged in the prompt.
- The HMAC-signed `sess_start` cookie approach in `src/lib/session-policy.ts`: Once we realized WorkOS session lengths are global across the environment rather than per-organization, this gave us a clean, fail-closed way to enforce Northwind's 24-hour session cap. If the cookie timestamp is missing or the HMAC signature fails, it defaults to forcing re-authentication rather than giving the user the benefit of the doubt.
- Replacing static in-memory data with live WorkOS API calls: Re-wrote the member directory to pull dynamically from `listOrganizationMemberships` and `listUsers` instead of relying on a static seed file (`src/lib/db.ts`). The static version broke synchronization the moment an invite was sent or a role was updated — something that would have completely derailed a live demo.

**Two or three things you rejected or reworked, and why:**

- Generic upstream error handling: The initial code mapped every WorkOS SDK failure to a generic `502 Bad Gateway`, including client errors like inviting an email that already had a pending invite. I reworked this in `src/app/api/get-name/members/invite/route.ts` to catch duplicate invites specifically and return a `409 Conflict` with a clear, user-facing error message.
- Flawed Okta re-authentication advice: When Okta SAML logins started silently completing without prompting for credentials during testing, the AI originally suggested manually clearing browser cookies and logging out of Google/Okta before every test run. This wasted time and didn't solve the root issue. The real fix was identifying Okta's application-level Authentication Policy re-authentication frequency setting (defaulted to 12 hours) and setting the rule to require re-authentication "every time" (documented in `docs/sso-okta.md` §6).

**The prompt or technique that paid off most:**
Refusing to debug blindly from high-level UI error messages ("Invalid SAML Response" or `oauth_provider_generic_error`) and instead extracting the raw `SAMLResponse` directly from the browser's Network tab. Copying the network request as cURL, decoding the base64 XML payload locally, and inspecting the actual SAML assertions made it immediately clear whether we were dealing with a malformed NameID format, missing Attribute Statements, or an unapplied SSO policy. Having the exact payload on hand cut through three completely different root causes that all produced identical error screens in the dashboard.

**The worst thing the AI gave you:**
A chain of plausible-sounding but wrong guesses during Okta SAML debugging because it relied on indirect error screens rather than raw payload inspection:

- Non-existent UI paths: Guided me to look for a legacy "Configure SAML" wizard and a "Global Session Policy → Sign On" tab that didn't exist in our Okta admin console version.
- Incorrect attribute syntax: Generated three invalid Okta expression variants (`user.email`, `user.getInternalProperty('id')`, `user.login`) before landing on the correct `user.profile.{property}` format — which I only resolved after pulling Okta's actual documentation.
- Blocked profile edits: Suggested updating the user's email directly under Directory → People, which Okta blocked because the account was provisioned externally ("Username is set by Acme Corp - WorkOS"). The actual fix was setting an app-level assignment override.
- Misleading certificate theories: Chased a false certificate-mismatch lead for the generic "Invalid SAML Response" error. Proving the signature was cryptographically valid required decoding and verifying it with `signxml`, only to confirm the real issue was simply missing Attribute Statements.

Every single one of these got corrected because I pushed back using what was actually rendering on my screen and in my network tab rather than taking the suggested steps at face value.

## 5. Pushback

Anything in the brief you'd push back on as the SE, and what you'd propose instead:

**"Can the demo just call the WorkOS API directly from the frontend with the API key?"**

The pushback: Absolutely not. Exposing a secret API key in client-side code bundles or browser network requests gives any user full administrative control over your entire WorkOS tenant — including reading, inviting, or removing members across any organization. It also bypasses every backend security control we built (`canGrantRole` matrix, last-admin lockout, and CSRF protection).

What we did instead: Kept the WorkOS API key strictly server-side in Node.js, proxied all administrative mutations through our own Next.js API route handlers, and derived identity, workspace context, and permissions exclusively from HTTP-only session cookies.

**"Only Admins can invite team members"**

The pushback: In a real B2B enterprise application, requiring an Admin to handle every single user invite creates an operational bottleneck that defeats the purpose of self-serve team management.

What we did instead: Interpreted requirement 3 ("Team leads need to manage their own people") as allowing Team Leads to invite members to their team, while using our `canGrantRole` matrix to strictly cap what roles they can assign. A Team Lead can invite another Team Lead or a Compliance user, but can never grant Admin privileges. This satisfies self-serve requirements without opening privilege escalation risks.

**"Admins have to sign in with MFA"**

The pushback: WorkOS enforces MFA policies at the Organization level rather than at the individual role level. In AuthKit, enabling "Require MFA" applies to all non-SSO logins across the entire workspace, not just users with an admin role.

What we did instead: Enforced the MFA policy at the organization level for Northwind Traders, ensuring complete coverage. In a customer conversation with Priya's team, I would position this as a strictly stronger security guarantee than originally requested (protecting all workspace users) while verifying their team doesn't require lower-friction access for non-admin accounts.

## 6. Cut list

What you'd do next with more time, roughly in order.

1. Provision one or two more real Okta identities (or local Okta users) so the demo can show independent SSO logins for team-lead and compliance, instead of re-roling one identity in the dashboard.
2. Map Okta groups to WorkOS roles (SAML `groups` attribute + WorkOS role mapping) so role assignment happens in Okta, where Acme's IT already manages access, rather than by hand in the WorkOS dashboard.
3. Replace the static `src/lib/tenants.ts` slug→org-ID table with a real lookup (by email domain or subdomain), which is the shape it's already written to swap into.
4. The customer-success Slack ping on member add/remove (brief's "down the road" item), using WorkOS Pipes — explicitly optional, not attempted here for time.
5. Clean up the stray `member`-role membership in Acme (`kelsi.anderson26+acme@gmail.com`) left over from setup — harmless (RBAC doesn't grant that slug any write access) but worth tidying before a customer-facing review.
6. Dial Okta's Authentication Policy re-authentication frequency back down from "every time" (set during SSO debugging so the prompt was visible on every attempt) to a normal window once the integration is stable — see `docs/sso-okta.md` §7.

_(JIT provisioning is already enabled — see requirement 4 in §3 and `docs/sso-okta.md` §7 — so it's no longer on this list.)_
