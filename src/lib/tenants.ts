// The demo's customer tenants, keyed by a short URL-safe slug.
//
// Each slug maps to a real WorkOS Organization ID so a sign-in link can target
// one customer's SSO connection directly — e.g. `/login?org=acme` sends the
// user straight to Acme's Okta instead of the generic email-entry screen. That
// matters here because the seed users sign in with @gmail.com addresses, which
// AuthKit can't route to an organization by email domain.
//
// In a real deployment this lookup would be a database query keyed by the
// customer's email domain or subdomain; the shape is deliberately the same, so
// swapping the implementation later doesn't touch callers.

export type Tenant = { name: string; organizationId: string };

export const TENANTS: Record<string, Tenant> = {
  acme: {
    name: "Acme Corp",
    organizationId: "org_01M22148NBHDQSB8DCE7TRNK56",
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
