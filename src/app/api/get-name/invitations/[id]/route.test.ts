import { DELETE } from "./route";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
  getWorkOS: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockGetWorkOS = getWorkOS as jest.MockedFunction<typeof getWorkOS>;

type Invitation = { id: string; organizationId: string; state: string };

const INVITATIONS: Record<string, Invitation> = {
  inv_pending: { id: "inv_pending", organizationId: "org_acme", state: "pending" },
  inv_accepted: { id: "inv_accepted", organizationId: "org_acme", state: "accepted" },
  inv_globex: { id: "inv_globex", organizationId: "org_globex", state: "pending" },
};

const notFound = () => Object.assign(new Error("not found"), { status: 404 });

const mockGetInvitation = jest.fn(async (id: string) => {
  const invitation = INVITATIONS[id];
  if (!invitation) throw notFound();
  return invitation;
});
const mockRevokeInvitation = jest.fn(async (id: string) => INVITATIONS[id]);

function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    role: "admin",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockWithAuth.mockResolvedValue(session());
  mockGetWorkOS.mockReturnValue({
    userManagement: {
      getInvitation: mockGetInvitation,
      revokeInvitation: mockRevokeInvitation,
    },
  } as unknown as ReturnType<typeof getWorkOS>);
});

describe("DELETE /api/get-name/invitations/[id]", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await DELETE(req(), ctx("inv_pending"));

    expect(res.status).toBe(401);
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an admin", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "team_lead" }));

    const res = await DELETE(req(), ctx("inv_pending"));

    expect(res.status).toBe(403);
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    const res = await DELETE(
      req({ origin: "https://evil.example", host: "localhost:3000" }),
      ctx("inv_pending"),
    );

    expect(res.status).toBe(403);
    expect(mockGetInvitation).not.toHaveBeenCalled();
  });

  it("returns 404 for an invitation in another organization", async () => {
    const res = await DELETE(req(), ctx("inv_globex"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Invitation not found" });
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown invitation id", async () => {
    const res = await DELETE(req(), ctx("inv_missing"));

    expect(res.status).toBe(404);
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes a pending invitation and returns 204", async () => {
    const res = await DELETE(req(), ctx("inv_pending"));

    expect(res.status).toBe(204);
    expect(mockRevokeInvitation).toHaveBeenCalledWith("inv_pending");
  });

  it("returns 409 when the invitation is no longer pending", async () => {
    const res = await DELETE(req(), ctx("inv_accepted"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Invitation is no longer pending" });
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
  });

  it("returns a generic 502 when the WorkOS call fails", async () => {
    mockRevokeInvitation.mockRejectedValueOnce(new Error("boom"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(req(), ctx("inv_pending"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not revoke invitation" });
    consoleError.mockRestore();
  });
});
