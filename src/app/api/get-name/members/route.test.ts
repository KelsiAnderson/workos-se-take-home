import { GET } from "./route";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
  getWorkOS: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockGetWorkOS = getWorkOS as jest.MockedFunction<typeof getWorkOS>;

// Fixtures spanning two tenants. The route must never let one org's session
// see the other's rows.
type Membership = {
  id: string;
  userId: string;
  organizationId: string;
  status: string;
  role: { slug: string };
};
type User = { id: string; email: string; firstName: string | null; lastName: string | null };

const MEMBERSHIPS: Record<string, Membership[]> = {
  org_acme: [
    { id: "om_1", userId: "user_ada", organizationId: "org_acme", status: "active", role: { slug: "admin" } },
    { id: "om_2", userId: "user_leo", organizationId: "org_acme", status: "active", role: { slug: "team_lead" } },
    { id: "om_3", userId: "user_cara", organizationId: "org_acme", status: "inactive", role: { slug: "compliance" } },
  ],
  org_globex: [
    { id: "om_9", userId: "user_gil", organizationId: "org_globex", status: "active", role: { slug: "admin" } },
  ],
};

const USERS: Record<string, User[]> = {
  org_acme: [
    { id: "user_ada", email: "ada@acme.test", firstName: "Ada", lastName: "Admin" },
    { id: "user_leo", email: "leo@acme.test", firstName: "Leo", lastName: "Lead" },
    { id: "user_cara", email: "cara@acme.test", firstName: null, lastName: null },
  ],
  org_globex: [
    { id: "user_gil", email: "gil@globex.test", firstName: "Gil", lastName: "Globex" },
  ],
};

const page = <T,>(rows: T[]) => ({ autoPagination: async () => rows });

const mockListMemberships = jest.fn(
  async ({ organizationId }: { organizationId: string }) =>
    page(MEMBERSHIPS[organizationId] ?? []),
);
const mockListUsers = jest.fn(
  async ({ organizationId }: { organizationId: string }) =>
    page(USERS[organizationId] ?? []),
);

function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_ada", email: "ada@acme.test" },
    organizationId: "org_acme",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithAuth.mockResolvedValue(session());
  mockGetWorkOS.mockReturnValue({
    userManagement: {
      listOrganizationMemberships: mockListMemberships,
      listUsers: mockListUsers,
    },
  } as unknown as ReturnType<typeof getWorkOS>);
});

describe("GET /api/get-name/members", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "Unauthorized: missing active workspace",
    });
    expect(mockListMemberships).not.toHaveBeenCalled();
  });

  it("returns 401 when the user has no active workspace", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: undefined }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockListMemberships).not.toHaveBeenCalled();
  });

  it("joins membership role/status with the user's email and name", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.members).toEqual([
      {
        id: "om_1",
        userId: "user_ada",
        organizationId: "org_acme",
        email: "ada@acme.test",
        name: "Ada Admin",
        role: "admin",
        status: "active",
      },
      {
        id: "om_2",
        userId: "user_leo",
        organizationId: "org_acme",
        email: "leo@acme.test",
        name: "Leo Lead",
        role: "team_lead",
        status: "active",
      },
      {
        id: "om_3",
        userId: "user_cara",
        organizationId: "org_acme",
        email: "cara@acme.test",
        // no first/last name on the user -> falls back to the email
        name: "cara@acme.test",
        role: "compliance",
        status: "inactive",
      },
    ]);
  });

  it("isolates tenants: a different org sees only its own members", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_globex" }));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.members.map((m: { email: string }) => m.email)).toEqual(["gil@globex.test"]);
    expect(body.members.some((m: { organizationId: string }) => m.organizationId === "org_acme")).toBe(false);
  });

  it("scopes both WorkOS queries to the session's organization, not the request", async () => {
    const res = await GET();
    await res.json();

    expect(GET.length).toBe(0);
    expect(mockWithAuth).toHaveBeenCalledTimes(1);
    expect(mockListMemberships).toHaveBeenCalledWith({ organizationId: "org_acme" });
    expect(mockListUsers).toHaveBeenCalledWith({ organizationId: "org_acme" });
  });

  it("returns a generic 502 when the WorkOS call fails", async () => {
    mockListMemberships.mockRejectedValueOnce(new Error("boom: upstream"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "Could not list members" });
    expect(JSON.stringify(body)).not.toContain("upstream");
    consoleError.mockRestore();
  });
});
