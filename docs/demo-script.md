# Demo recording script

Every code block below is copy-pasted from the actual files as of this
session — what's on screen in VS Code will match what you say, word for word.

**One open decision before you record** — see the box at the top of Act 3.

---

## Pre-recording layout

**Left half — browser, incognito, signed out:**
- Tab 1: `http://localhost:3000`
- Tab 2: `dashboard.workos.com` → Organizations

**Right half — VS Code:**
- Tab 3: `src/lib/workspace.ts`
- Tab 4: `src/app/api/get-name/members/invite/route.ts`
- Tab 5: `src/lib/roles.ts`
- Tab 6 (split): `src/app/callback/route.ts` + `src/middleware.ts`
- Integrated terminal, bottom: run `npm test` once beforehand so it's sitting
  there green and ready to re-run on camera.

**Also confirm before you hit record:**
- `kelsi@ochithreads.com` is currently Acme's **only active admin** — that's
  what makes the last-admin 409 in Act 2 real, not staged.
- Dev server running (`npm run dev`), `.next` freshly built at least once
  (`npx next build`) so there's no first-request compile lag on camera.

---

## Act 1 — Tenant isolation & the auth gate (0:00–1:15)

**UI:**
1. Tab 2 → Organizations → Acme Corp. Point at the Organization ID (`org_01M22148…`) at the top — this is the value everything downstream is scoped to.
2. Tab 1 → **"Sign in to Acme Corp (Okta)"** → authenticate as `kelsi@ochithreads.com`.
3. Click **Members** in the header nav → lands on `/members`, table populated live.

**Code — `src/lib/workspace.ts`:**
```ts
export async function requireWorkspace(): Promise<Workspace | NextResponse> {
  const { user, organizationId } = await withAuth();

  if (!user || !organizationId) {
    return unauthorized();
  }

  return { userId: user.id, organizationId };
}

export async function requireRole(
  allowedRoles: RoleSlug[],
): Promise<AuthorizedWorkspace | NextResponse> {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;

  const { role, roles } = await withAuth();
  const held = Array.from(
    new Set([role, ...(roles ?? [])].filter((r): r is string => !!r)),
  );

  const permitted = allowedRoles.some((allowed) => held.includes(allowed));
  if (!permitted) return forbidden();

  return { ...workspace, roles: held };
}
```

**Say:**
> "Hi Priya and team. This is Meridian Analytics' multi-tenant user management,
> built on WorkOS AuthKit.
>
> The top requirement is hard tenant isolation. WorkOS resolves identity and
> seals the tenant into a signed, httpOnly cookie. `requireWorkspace()` calls
> `withAuth()` to read `organizationId` straight off that cookie — never from a
> URL, a request body, or a header a client could edit.
>
> `requireRole()` builds on that: it re-reads the caller's role — which AuthKit
> can hand back as a single `role` or a `roles` array, so we normalize both — and
> checks it against an explicit allowlist before anything else runs. Fail either
> check and the handler returns a `NextResponse` right there — 401 unauthenticated,
> 403 authenticated-but-wrong-role — and nothing downstream, no WorkOS call, no
> data read, ever executes for a caller who shouldn't be there."

---

## Act 2 — Self-serve admin actions, without the API key in the browser (1:15–2:45)

**UI:**
1. Tab 1, still `/members`. In the invite row: `test.invite@acme.test`, role **Team Lead**, click **Send invite**.
2. Point out: nothing changes in the members table (they haven't accepted yet) — scroll to **Pending invitations** below it, where the new row actually appears.
3. Click **Remove** on your own row (`kelsi@ochithreads.com`). Point at the callout: `Remove failed (409): Cannot remove the last admin`.

**Code — `src/app/api/get-name/members/invite/route.ts`:**
```ts
if (!canGrantRole(callerRoles, roleSlug)) {
  return NextResponse.json(
    { error: "Your role cannot assign that role" },
    { status: 403 },
  );
}

try {
  const invitation = await getWorkOS().userManagement.sendInvitation({
    email,
    // Tenant scope: forced to the caller's org, ignoring anything in the body.
    organizationId,
    roleSlug,
    inviterUserId: userId,
    expiresInDays: 7,
  });

  const payload: InvitePayload = {
    id: invitation.id,
    email: invitation.email,
    state: invitation.state,
    expiresAt: invitation.expiresAt,
    organizationId: invitation.organizationId,
  };
  return NextResponse.json({ invite: payload }, { status: 201 });
```
*(Point out `InvitePayload` doesn't have `token` or `acceptInvitationUrl` — the raw WorkOS object does; we just never project them into the response.)*

**Say:**
> "You asked whether we could just call WorkOS directly from the frontend with
> the API key — we didn't, deliberately. Put the key in a browser bundle and
> DevTools' Network tab hands anyone your credential to WorkOS. Every mutation
> goes through our own Next.js route handlers instead, where three things
> happen before WorkOS is ever touched:
>
> One — `canGrantRole` checks the role being granted against the *caller's*
> role, not just whether the role exists. A team lead can invite a team lead or
> a compliance user, but not an admin — otherwise invite becomes an escalation
> path.
>
> Two — the invite response is a hand-built projection. The real WorkOS
> invitation object carries a secret `acceptInvitationUrl`; we never put it in
> `InvitePayload`, so it can't leak into the browser or a log.
>
> Three — you just saw it: I tried to remove the only admin in this workspace,
> and got a 409, not a 200. Same guard runs on a role-change that would demote
> the last admin. There's also an `isCrossOrigin` check on every one of these
> routes as a second CSRF layer on top of the session cookie's `SameSite=Lax`."

---

## Act 3 — Three personas (2:45–4:00)

> **⚠️ Decision needed before recording this act.** Acme is SSO-only, and your
> Okta trial signs you in via Google federation as `kelsi@ochithreads.com`.
> There's no clean second/third Okta identity to sign in as without a real
> second email you control. Script below uses **Option B** — reroling your one
> identity in the WorkOS dashboard between segments. If you have two more real
> email addresses you can actually receive mail at, tell me and I'll swap this
> for three distinct SSO logins instead (more convincing, more setup).

**UI — Team Lead:**
1. Tab 2 → Organizations → Acme Corp → **Members** → click `kelsi@ochithreads.com` → **Role → Team Lead** → Save.
   *(Note out loud: this is the WorkOS dashboard editing the membership directly — it does **not** go through our `canGrantRole` or last-admin guard. That's expected: the dashboard is the platform operator's break-glass control, separate from the tenant-facing app.)*
2. Tab 1 → **Sign Out** → **Sign in to Acme Corp (Okta)** again. *(Role is baked into the session at auth time — a page refresh alone won't pick up the change, you have to fully re-authenticate. Since Okta/Google still has you signed in, this should flash through with no password prompt.)*
3. `/members`: no role selects, no Remove column on the table (you're not admin) — but the invite form is present, and its role dropdown offers only **Team Lead** and **Compliance**, no **Admin**.

**UI — Compliance:**
4. Tab 2 → same membership → **Role → Compliance** → Save.
5. Tab 1 → **Sign Out** → sign back in via Okta.
6. `/members`: table is read-only, the invite form is gone entirely, replaced by "Your role has read-only access to the directory." The Pending Invitations table is still visible (compliance can *see* everything) but has no Revoke column.

**Code — `src/lib/roles.ts`:**
```ts
export const ROLES = {
  admin: "admin",
  team_lead: "team_lead",
  compliance: "compliance",
} as const;

export const DEFAULT_ROLE: RoleSlug = ROLES.compliance; // least privilege

const GRANTABLE_BY_ROLE: Record<RoleSlug, readonly RoleSlug[]> = {
  [ROLES.admin]: [ROLES.admin, ROLES.team_lead, ROLES.compliance],
  [ROLES.team_lead]: [ROLES.team_lead, ROLES.compliance],
  [ROLES.compliance]: [],
};

export function canGrantRole(
  callerRoles: readonly string[],
  targetRole: string,
): boolean {
  return callerRoles.some((role) => {
    const grantable = GRANTABLE_BY_ROLE[role as RoleSlug] as
      | readonly string[]
      | undefined;
    return grantable?.includes(targetRole) === true;
  });
}
```

**Say:**
> "Three roles: admin runs the workspace, team lead brings their own people in,
> compliance sees everything and changes nothing.
>
> You just watched the same UI — same page, same account — render three
> different capability sets purely from the role on the session. That's not
> the UI hiding buttons for looks: the dropdown options you saw for team lead
> came from this exact `GRANTABLE_BY_ROLE` matrix, the same table
> `POST /members/invite` runs server-side. If someone bypassed the UI entirely
> and curled the API as compliance, they'd get the identical 403
> `requireRole` returns — the UI and the API can't drift because they're reading
> the same source of truth in `lib/roles.ts`.
>
> And notice the default: an invite that doesn't name a role lands the invitee
> as compliance, not as something more privileged. Least privilege by default,
> not by convention."

*(Before moving on: dashboard → Acme → Members → set `kelsi@ochithreads.com`'s role back to **Admin**, so the rest of the demo — and your own testing afterward — isn't stuck on a read-only account.)*

---

## Act 4 — Okta SAML SSO (4:00–4:45)

**UI:**
1. Tab 2 → Organizations → Acme Corp → **Single Sign-On** → open the connection. Point at the **Active** status and the ACS URL field.
2. Tab 1 → Sign Out → homepage → **"Sign in to Acme Corp (Okta)"** → complete the Okta login → land back on the app.

**Code — `src/app/login/route.ts`:**
```ts
export const GET = async (request: NextRequest) => {
  const tenant = resolveTenant(request.nextUrl.searchParams.get("org"));

  const signInUrl = await getSignInUrl(
    tenant ? { organizationId: tenant.organizationId } : {},
  );

  return redirect(signInUrl);
};
```

**Say:**
> "Acme's dealbreaker was their own Okta. We paired a SAML connection on
> Acme's WorkOS Organization with a SAML app in their Okta tenant — that's
> the Active connection you just saw.
>
> On the sign-in side: AuthKit can normally route a user to their org by email
> domain, but our test identities don't live on a real Acme domain, so domain
> matching isn't reliable for this evaluation. `resolveTenant` is a small
> slug-to-organization-ID map in `lib/tenants.ts`, and we hand that ID straight
> to AuthKit's own `getSignInUrl()` — not the raw WorkOS SDK method, the AuthKit
> wrapper, because it's the one that sets up PKCE state correctly. That sends
> the user straight to Acme's Okta connection, no domain guessing, and the
> session that comes back already has the right `organizationId` and role."

---

## Act 5 — Per-tenant policy for Northwind (4:45–6:00)

**UI:**
1. Tab 2 → Organizations → **Northwind Traders** → the authentication/policy tab → point at **MFA: Required**.
2. Tab 2 → Organizations → **Acme Corp** → same tab → point out MFA is not required there — different tenant, different policy, no shared switch.
3. Tab 1 → incognito → `http://localhost:3000/login?org=northwind` → sign in as the Northwind admin user → show the TOTP enrollment / challenge screen firing.
4. **Show the cutoff actually happening**, live: in VS Code, temporarily change `src/lib/tenants.ts` — `maxSessionAgeHours: 24` → `0.011` (~40 seconds) — save (dev hot-reloads). Reload `/account` after the window passes → redirected to `/login?org=northwind&error=session_expired`, and the session cookies are gone from devtools. Set it back to `24` immediately after and show the file saved.

**Code — `src/app/callback/route.ts`:**
```ts
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
      maxAge: 60 * 60 * 24,
    });
  },
});
```

**Code — `src/middleware.ts`:**
```ts
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
```

**Say:**
> "Northwind's security team had two hard rules, isolated to them: MFA for
> everyone signing in with a password, and a 24-hour hard session cutoff.
>
> MFA is native — Northwind's organization policy in WorkOS requires it, Acme's
> doesn't, and that's a per-org setting with no code involved. One caveat worth
> being upfront about: WorkOS's policy applies to *non-SSO* members, org-wide —
> there's no "admins only" toggle. Since Northwind is a password-based org,
> that satisfies "admins must use MFA" and then some.
>
> The 24-hour cutoff was the harder half, because WorkOS session length is an
> environment-wide setting, not per-organization — turning it on for Northwind
> would've meant turning it on for Acme too. And there's no "signed in at"
> claim on the access token to check — it refreshes every few minutes, and
> `user.createdAt` is account age, not login time.
>
> So we record it ourselves: `callback/route.ts` drops an HMAC-signed cookie at
> sign-in with the session ID and the timestamp, only for organizations that
> carry a policy. `middleware.ts` verifies that signature on every request. If
> it's missing, doesn't match the current session, or the signed timestamp is
> past 24 hours, it clears the session outright and sends them back to sign in
> — you just watched that happen. Fail closed: there's no way to edit or
> delete that cookie to buy more time, only to log yourself out early."

---

## Act 6 — Test suite & close (6:00–6:20)

**Terminal:**
```
npm test
```
```
Test Suites: 9 passed, 9 total
Tests:       86 passed, 86 total
```

**Say:**
> "86 tests across 9 suites cover the RBAC gates, cross-tenant IDOR checks,
> CSRF, the last-admin lockout guard, and the HMAC session-stamp validation —
> including the tamper cases, a forged timestamp and a swapped session ID both
> get rejected. Thanks for watching."

---

## Things to sanity-check right before you hit record

- [ ] `kelsi@ochithreads.com` role is currently **admin** (not left at compliance from a previous test run)
- [ ] The Northwind admin test user's password + authenticator app are ready to go — don't fumble MFA enrollment live if you can help it; consider having it pre-enrolled and just showing the *challenge*, not first-time setup
- [ ] `src/lib/tenants.ts` is at `maxSessionAgeHours: 24` before you start (only drop it for the live cutoff demo in Act 5, then restore it)
- [ ] `npm test` run once beforehand so you know it's green before doing it live
- [ ] Decide the Act 3 approach (see the box) before you script your exact clicks
