// The demo's customer tenants, keyed by a short URL-safe slug.
//
// Each slug maps to a real WorkOS Organization ID so a sign-in link can target
// one customer's SSO connection directly — e.g. `/login?org=acme` sends the
// user straight to Acme's Okta instead of the generic email-entry screen. That
// matters here because the seed users sign in with @gmail.com addresses, which
// AuthKit can't route to an organization by email domain.
//
// Tenants can also carry a `sessionPolicy`. WorkOS session lifetime is an
// environment-wide setting, so a per-tenant "sessions expire 24h after sign-in"
// rule is enforced in middleware against this table (see src/lib/session-policy
// and src/middleware.ts).
//
// In a real deployment this lookup would be a database query keyed by the
// customer's email domain or subdomain; the shape is deliberately the same, so
// swapping the implementation later doesn't touch callers.

export type SessionPolicy = { maxSessionAgeHours: number };

export type Tenant = {
  name: string;
  organizationId: string;
  sessionPolicy?: SessionPolicy;
};

export const TENANTS: Record<string, Tenant> = {
  acme: {
    name: "Acme Corp",
    organizationId: "org_01M22148NBHDQSB8DCE7TRNK56",
  },
  northwind: {
    name: "Northwind Traders",
    // The strict "biggest prospect" from the brief: a non-SSO (AuthKit
    // email/password) org with Require-MFA turned on in its WorkOS
    // Authentication Policy, plus the 24h session cap enforced below.
    organizationId: "org_01M26FDRA9QEW6RME8KN1HJ8BD",
    sessionPolicy: { maxSessionAgeHours: 24 },
  },
  strawberry: {
    name: "Strawberry Bikes",
    organizationId: "org_01M2214SR7QTB858X2GX9Q9MET",
  },
};

// Resolve a slug (e.g. from a query param) to a tenant, or undefined if it
// isn't one we know. Callers treat undefined as "fall back to the default
// sign-in flow" rather than an error.
export function resolveTenant(slug: string | null | undefined): Tenant | undefined {
  if (!slug) return undefined;
  return TENANTS[slug.toLowerCase()];
}

// Find a tenant by its WorkOS Organization ID (the session carries the ID, not
// the slug).
export function tenantByOrganizationId(
  organizationId: string | null | undefined,
): { slug: string; tenant: Tenant } | undefined {
  if (!organizationId) return undefined;
  const entry = Object.entries(TENANTS).find(
    ([, t]) => t.organizationId === organizationId,
  );
  return entry ? { slug: entry[0], tenant: entry[1] } : undefined;
}

// The session policy for the org a session belongs to, if any.
export function sessionPolicyFor(
  organizationId: string | null | undefined,
): SessionPolicy | undefined {
  return tenantByOrganizationId(organizationId)?.tenant.sessionPolicy;
}
