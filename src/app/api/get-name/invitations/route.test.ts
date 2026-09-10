import { GET } from "./route";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
  getWorkOS: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockGetWorkOS = getWorkOS as jest.MockedFunction<typeof getWorkOS>;

// A mix of states, and the secret fields the route must not expose.
const INVITATIONS = [
  {
    id: "invitation_1",
    email: "pending@acme.test",
    state: "pending",
    expiresAt: "2026-01-08T00:00:00.000Z",
    organizationId: "org_acme",
    token: "secret-token-1",
    acceptInvitationUrl: "https://auth.example.com/invite?token=secret-token-1",
  },
  {
    id: "invitation_2",
    email: "accepted@acme.test",
    state: "accepted",
    expiresAt: "2026-01-08T00:00:00.000Z",
    organizationId: "org_acme",
    token: "secret-token-2",
    acceptInvitationUrl: "https://auth.example.com/invite?token=secret-token-2",
  },
];

const mockListInvitations = jest.fn(async () => ({
  autoPagination: async () => INVITATIONS,
}));

function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    role: "compliance",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithAuth.mockResolvedValue(session());
  mockGetWorkOS.mockReturnValue({
    userManagement: { listInvitations: mockListInvitations },
  } as unknown as ReturnType<typeof getWorkOS>);
});

describe("GET /api/get-name/invitations", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockListInvitations).not.toHaveBeenCalled();
  });

  it("is readable by a non-admin member (compliance)", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("scopes the query to the session's organization", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_acme" }));

    await GET();

    expect(mockListInvitations).toHaveBeenCalledWith({ organizationId: "org_acme" });
  });

  it("returns only pending invitations, without the token or accept URL", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.invitations).toEqual([
      {
        id: "invitation_1",
        email: "pending@acme.test",
        state: "pending",
        expiresAt: "2026-01-08T00:00:00.000Z",
      },
    ]);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("secret-token-1");
    expect(serialised).not.toContain("acceptInvitationUrl");
  });

  it("returns a generic 502 when the WorkOS call fails", async () => {
    mockListInvitations.mockRejectedValueOnce(new Error("boom"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not list invitations" });
    consoleError.mockRestore();
  });
});
