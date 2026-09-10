import {
  TENANTS,
  resolveTenant,
  tenantByOrganizationId,
  sessionPolicyFor,
} from "./tenants";

describe("resolveTenant", () => {
  it("resolves a known slug, case-insensitively", () => {
    expect(resolveTenant("acme")).toBe(TENANTS.acme);
    expect(resolveTenant("ACME")).toBe(TENANTS.acme);
  });

  it("returns undefined for an unknown or empty slug", () => {
    expect(resolveTenant("nope")).toBeUndefined();
    expect(resolveTenant(null)).toBeUndefined();
    expect(resolveTenant(undefined)).toBeUndefined();
  });
});

describe("tenantByOrganizationId", () => {
  it("maps a WorkOS org id back to its slug and tenant", () => {
    expect(tenantByOrganizationId(TENANTS.acme.organizationId)).toEqual({
      slug: "acme",
      tenant: TENANTS.acme,
    });
  });

  it("returns undefined for an unknown or missing org id", () => {
    expect(tenantByOrganizationId("org_unknown")).toBeUndefined();
    expect(tenantByOrganizationId(undefined)).toBeUndefined();
  });
});

describe("sessionPolicyFor", () => {
  it("returns the 24h policy for the strict tenant", () => {
    expect(sessionPolicyFor(TENANTS.northwind.organizationId)).toEqual({
      maxSessionAgeHours: 24,
    });
  });

  it("returns undefined for tenants without a policy", () => {
    expect(sessionPolicyFor(TENANTS.acme.organizationId)).toBeUndefined();
    expect(sessionPolicyFor(TENANTS.strawberry.organizationId)).toBeUndefined();
  });

  it("returns undefined for an unknown org", () => {
    expect(sessionPolicyFor("org_unknown")).toBeUndefined();
  });
});
