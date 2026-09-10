import { requireWorkspace, requireRole, requireAdminWorkspace } from "./workspace";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { ROLES } from "@/lib/roles";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;

function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    role: "admin",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithAuth.mockResolvedValue(session());
});

describe("requireWorkspace", () => {
  it("returns the workspace from the signed session", async () => {
    const result = await requireWorkspace();

    expect(result).toEqual({ userId: "user_1", organizationId: "org_acme" });
  });

  it("returns a 401 response when there is no user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null }));

    const result = await requireWorkspace();

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns a 401 response when there is no active organization", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: undefined }));

    const result = await requireWorkspace();

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });
});

describe("requireRole", () => {
  it("passes when `role` is in the allowlist and returns the held roles", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "team_lead" }));

    const result = await requireRole([ROLES.team_lead, ROLES.admin]);

    expect(result).toEqual({
      userId: "user_1",
      organizationId: "org_acme",
      roles: ["team_lead"],
    });
  });

  it("passes when a `roles` array entry is in the allowlist", async () => {
    mockWithAuth.mockResolvedValue(
      session({ role: undefined, roles: ["compliance", "team_lead"] }),
    );

    const result = await requireRole([ROLES.team_lead]);

    expect(result).toEqual({
      userId: "user_1",
      organizationId: "org_acme",
      roles: ["compliance", "team_lead"],
    });
  });

  it("returns 403 when the caller holds none of the allowed roles", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "compliance" }));

    const result = await requireRole([ROLES.admin]);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    await expect((result as NextResponse).json()).resolves.toEqual({
      error: "Forbidden: insufficient role",
    });
  });

  it("returns 401 (not 403) when unauthenticated, before any role check", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null }));

    const result = await requireRole([ROLES.admin]);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("does not treat a role string as a substring match", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "administrator" }));

    const result = await requireRole([ROLES.admin]);

    expect((result as NextResponse).status).toBe(403);
  });
});

describe("requireAdminWorkspace", () => {
  it("is requireRole([admin])", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "team_lead" }));

    const result = await requireAdminWorkspace();

    expect((result as NextResponse).status).toBe(403);
  });
});
