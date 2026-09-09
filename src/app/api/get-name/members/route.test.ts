import { GET } from "./route";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { db } from "@/lib/db";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
}));

// Mock the data layer so these tests exercise the route's tenant-scoping
// logic, not whatever seed rows happen to live in db.ts. The fake still
// filters by `where.organizationId`, so the isolation assertions are real.
jest.mock("@/lib/db", () => {
  const FIXTURE_MEMBERS = [
    { id: "m_1", organizationId: "org_acme", email: "ada@acme.test", name: "Ada Admin", role: "admin" },
    { id: "m_2", organizationId: "org_acme", email: "leo@acme.test", name: "Leo Lead", role: "team_lead" },
    { id: "m_3", organizationId: "org_acme", email: "cara@acme.test", name: "Cara Compliance", role: "compliance" },
    { id: "m_4", organizationId: "org_globex", email: "gil@globex.test", name: "Gil Globex", role: "admin" },
  ];

  return {
    db: {
      members: {
        findMany: jest.fn(
          async ({ where }: { where: { organizationId: string } }) =>
            FIXTURE_MEMBERS.filter((m) => m.organizationId === where.organizationId),
        ),
      },
    },
  };
});

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockFindMany = db.members.findMany as jest.MockedFunction<typeof db.members.findMany>;

// Shapes the mocked session the way withAuth() resolves it.
function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/get-name/members", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "Unauthorized: missing active workspace",
    });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the user has no active workspace", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: undefined }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns only the members of the caller's organization", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_acme" }));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(3);
    expect(body.members.every((m: { organizationId: string }) => m.organizationId === "org_acme")).toBe(true);
  });

  it("isolates tenants: a different org sees a different member list", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_globex" }));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.members.map((m: { email: string }) => m.email)).toEqual(["gil@globex.test"]);
    // No Acme rows leak into Globex's response.
    expect(body.members.some((m: { organizationId: string }) => m.organizationId === "org_acme")).toBe(false);
  });

  it("scopes the query to the session's organization, not the request", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_acme" }));

    await GET();

    // The route must derive the tenant from withAuth() (the signed cookie),
    // and it takes no arguments that a client could use to widen the scope.
    expect(mockWithAuth).toHaveBeenCalledTimes(1);
    expect(GET.length).toBe(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({ where: { organizationId: "org_acme" } });
  });
});
