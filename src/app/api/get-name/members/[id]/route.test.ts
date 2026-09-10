import { PATCH, DELETE } from "./route";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
  getWorkOS: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockGetWorkOS = getWorkOS as jest.MockedFunction<typeof getWorkOS>;

type Membership = {
  id: string;
  userId: string;
  organizationId: string;
  status: string;
  role: { slug: string };
};

// Fixture memberships. `om_globex` lives in a different tenant and must never
// be reachable from an org_acme session.
const MEMBERSHIPS: Record<string, Membership> = {
  om_lead: { id: "om_lead", userId: "user_2", organizationId: "org_acme", status: "active", role: { slug: "team_lead" } },
  om_admin: { id: "om_admin", userId: "user_3", organizationId: "org_acme", status: "active", role: { slug: "admin" } },
  om_globex: { id: "om_globex", userId: "user_9", organizationId: "org_globex", status: "active", role: { slug: "admin" } },
};

const notFound = () => Object.assign(new Error("not found"), { status: 404 });

const mockGetMembership = jest.fn(async (id: string) => {
  const membership = MEMBERSHIPS[id];
  if (!membership) throw notFound();
  return membership;
});
const mockUpdateMembership = jest.fn(async (id: string, { roleSlug }: { roleSlug: string }) => ({
  ...MEMBERSHIPS[id],
  role: { slug: roleSlug },
}));
const mockDeleteMembership = jest.fn(async () => undefined);

// listOrganizationMemberships returns an AutoPaginatable; the route calls
// `.autoPagination()` on it. `activeMembers` is what that resolves to and is
// reset per test.
let activeMembers: Membership[] = [];
const mockListMemberships = jest.fn(async () => ({
  autoPagination: async () => activeMembers,
}));

function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    role: "admin",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

function req(
  body: unknown,
  { headers = {}, badJson = false }: { headers?: Record<string, string>; badJson?: boolean } = {},
) {
  return {
    headers: new Headers(headers),
    json: badJson ? () => Promise.reject(new SyntaxError("bad")) : async () => body,
  } as unknown as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  activeMembers = [MEMBERSHIPS.om_lead, MEMBERSHIPS.om_admin];
  mockWithAuth.mockResolvedValue(session());
  mockGetWorkOS.mockReturnValue({
    userManagement: {
      getOrganizationMembership: mockGetMembership,
      updateOrganizationMembership: mockUpdateMembership,
      deleteOrganizationMembership: mockDeleteMembership,
      listOrganizationMemberships: mockListMemberships,
    },
  } as unknown as ReturnType<typeof getWorkOS>);
});

describe("PATCH /api/get-name/members/[id]", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await PATCH(req({ role: "compliance" }), ctx("om_lead"));

    expect(res.status).toBe(401);
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an admin", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "team_lead" }));

    const res = await PATCH(req({ role: "compliance" }), ctx("om_lead"));

    expect(res.status).toBe(403);
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    const res = await PATCH(
      req({ role: "compliance" }, { headers: { origin: "https://evil.example", host: "localhost:3000" } }),
      ctx("om_lead"),
    );

    expect(res.status).toBe(403);
    expect(mockGetMembership).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await PATCH(req(undefined, { badJson: true }), ctx("om_lead"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
  });

  it("returns 400 for a role outside the assignable allowlist", async () => {
    const res = await PATCH(req({ role: "owner" }), ctx("om_lead"));

    expect(res.status).toBe(400);
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("returns 404 for a membership in another organization", async () => {
    const res = await PATCH(req({ role: "compliance" }), ctx("om_globex"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Member not found" });
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown membership id", async () => {
    const res = await PATCH(req({ role: "compliance" }), ctx("om_missing"));

    expect(res.status).toBe(404);
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("changes the role and returns a projected member", async () => {
    const res = await PATCH(req({ role: "compliance" }), ctx("om_lead"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpdateMembership).toHaveBeenCalledWith("om_lead", { roleSlug: "compliance" });
    expect(body.member).toEqual({
      id: "om_lead",
      userId: "user_2",
      organizationId: "org_acme",
      status: "active",
      role: "compliance",
    });
  });

  it("refuses to demote the last remaining admin", async () => {
    activeMembers = [MEMBERSHIPS.om_lead, MEMBERSHIPS.om_admin]; // exactly one admin

    const res = await PATCH(req({ role: "team_lead" }), ctx("om_admin"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Cannot demote the last admin" });
    expect(mockUpdateMembership).not.toHaveBeenCalled();
  });

  it("allows demoting an admin when another admin remains", async () => {
    activeMembers = [
      MEMBERSHIPS.om_admin,
      { ...MEMBERSHIPS.om_admin, id: "om_admin2", userId: "user_4" },
    ];

    const res = await PATCH(req({ role: "team_lead" }), ctx("om_admin"));

    expect(res.status).toBe(200);
    expect(mockUpdateMembership).toHaveBeenCalledWith("om_admin", { roleSlug: "team_lead" });
  });

  it("returns a generic 502 when the WorkOS update fails", async () => {
    mockUpdateMembership.mockRejectedValueOnce(new Error("boom"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(req({ role: "compliance" }), ctx("om_lead"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not update member" });
    consoleError.mockRestore();
  });
});

describe("DELETE /api/get-name/members/[id]", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await DELETE(req(undefined), ctx("om_lead"));

    expect(res.status).toBe(401);
    expect(mockDeleteMembership).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an admin", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "compliance" }));

    const res = await DELETE(req(undefined), ctx("om_lead"));

    expect(res.status).toBe(403);
    expect(mockDeleteMembership).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    const res = await DELETE(
      req(undefined, { headers: { origin: "https://evil.example", host: "localhost:3000" } }),
      ctx("om_lead"),
    );

    expect(res.status).toBe(403);
    expect(mockGetMembership).not.toHaveBeenCalled();
  });

  it("returns 404 for a membership in another organization", async () => {
    const res = await DELETE(req(undefined), ctx("om_globex"));

    expect(res.status).toBe(404);
    expect(mockDeleteMembership).not.toHaveBeenCalled();
  });

  it("removes the member and returns 204", async () => {
    const res = await DELETE(req(undefined), ctx("om_lead"));

    expect(res.status).toBe(204);
    expect(mockDeleteMembership).toHaveBeenCalledWith("om_lead");
  });

  it("refuses to remove the last remaining admin", async () => {
    activeMembers = [MEMBERSHIPS.om_lead, MEMBERSHIPS.om_admin];

    const res = await DELETE(req(undefined), ctx("om_admin"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Cannot remove the last admin" });
    expect(mockDeleteMembership).not.toHaveBeenCalled();
  });

  it("allows removing an admin when another admin remains", async () => {
    activeMembers = [
      MEMBERSHIPS.om_admin,
      { ...MEMBERSHIPS.om_admin, id: "om_admin2", userId: "user_4" },
    ];

    const res = await DELETE(req(undefined), ctx("om_admin"));

    expect(res.status).toBe(204);
    expect(mockDeleteMembership).toHaveBeenCalledWith("om_admin");
  });

  it("returns a generic 502 when the WorkOS delete fails", async () => {
    mockDeleteMembership.mockRejectedValueOnce(new Error("boom"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(req(undefined), ctx("om_lead"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not remove member" });
    consoleError.mockRestore();
  });
});
