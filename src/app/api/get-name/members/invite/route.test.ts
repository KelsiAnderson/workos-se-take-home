import { POST } from "./route";
import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: jest.fn(),
  getWorkOS: jest.fn(),
}));

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;
const mockGetWorkOS = getWorkOS as jest.MockedFunction<typeof getWorkOS>;

// Stand-in for workos.userManagement.sendInvitation. It echoes the org it was
// called with so the isolation assertions are real, and it returns the secret
// fields (`token`, `acceptInvitationUrl`) that the route must NOT leak back.
const mockSendInvitation = jest.fn(
  async ({ organizationId, email }: { organizationId: string; email: string }) => ({
    object: "invitation",
    id: "invitation_1",
    email,
    state: "pending",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: "2026-01-08T00:00:00.000Z",
    organizationId,
    inviterUserId: "user_1",
    acceptedUserId: null,
    token: "super-secret-token",
    acceptInvitationUrl: "https://auth.example.com/invite?token=super-secret-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
);

// Shapes the mocked session the way withAuth() resolves it.
function session(overrides: Partial<Awaited<ReturnType<typeof withAuth>>> = {}) {
  return {
    user: { id: "user_1", email: "ada@acme.test" },
    organizationId: "org_acme",
    role: "admin",
    ...overrides,
  } as Awaited<ReturnType<typeof withAuth>>;
}

// Builds a request the way the route consumes it: `headers.get()` + `json()`.
function inviteRequest(
  body: unknown,
  { headers = {}, badJson = false }: { headers?: Record<string, string>; badJson?: boolean } = {},
) {
  return {
    headers: new Headers(headers),
    json: badJson
      ? () => Promise.reject(new SyntaxError("Unexpected token"))
      : async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetWorkOS.mockReturnValue({
    userManagement: { sendInvitation: mockSendInvitation },
  } as unknown as ReturnType<typeof getWorkOS>);
});

describe("POST /api/get-name/members/invite", () => {
  it("returns 401 when there is no signed-in user", async () => {
    mockWithAuth.mockResolvedValue(session({ user: null, organizationId: undefined }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "Unauthorized: missing active workspace",
    });
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns 401 when the user has no active workspace", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: undefined }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(401);
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns 403 for a compliance user (strictly read-only)", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "compliance" }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden: insufficient role" });
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the invite allowlist", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "auditor" }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(403);
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("allows a team lead to invite", async () => {
    mockWithAuth.mockResolvedValue(session({ role: "team_lead" }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(201);
    expect(mockSendInvitation).toHaveBeenCalledTimes(1);
  });

  it("accepts an allowed role from the `roles` array too", async () => {
    mockWithAuth.mockResolvedValue(session({ role: undefined, roles: ["team_lead"] }));

    const res = await POST(inviteRequest({ email: "new@acme.test" }));

    expect(res.status).toBe(201);
    expect(mockSendInvitation).toHaveBeenCalledTimes(1);
  });

  it("invites into the caller's organization and records the inviter", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_acme" }));

    const res = await POST(inviteRequest({ email: "New@Acme.test", role: "team_lead" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockSendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@acme.test", // normalised to lowercase
        organizationId: "org_acme",
        roleSlug: "team_lead",
        inviterUserId: "user_1",
      }),
    );
    expect(body.invite.organizationId).toBe("org_acme");
  });

  it("isolates tenants: an organizationId in the body cannot widen the scope", async () => {
    mockWithAuth.mockResolvedValue(session({ organizationId: "org_acme" }));

    await POST(
      inviteRequest({ email: "new@acme.test", organizationId: "org_globex" }),
    );

    // The org is taken from the session, never the request body.
    expect(mockSendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_acme" }),
    );
    const call = mockSendInvitation.mock.calls[0][0];
    expect(call.organizationId).not.toBe("org_globex");
  });

  it("does not leak the invitation token or accept URL in the response", async () => {
    mockWithAuth.mockResolvedValue(session());

    const res = await POST(inviteRequest({ email: "new@acme.test" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.invite).toEqual({
      id: "invitation_1",
      email: "new@acme.test",
      state: "pending",
      expiresAt: "2026-01-08T00:00:00.000Z",
      organizationId: "org_acme",
    });
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("super-secret-token");
    expect(serialised).not.toContain("acceptInvitationUrl");
  });

  it("defaults an unspecified role to the least-privileged one", async () => {
    mockWithAuth.mockResolvedValue(session());

    await POST(inviteRequest({ email: "new@acme.test" }));

    expect(mockSendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ roleSlug: "compliance" }),
    );
  });

  it("rejects a role that is not in the assignable allowlist", async () => {
    mockWithAuth.mockResolvedValue(session());

    const res = await POST(
      inviteRequest({ email: "new@acme.test", role: "owner" }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "`role` is not an assignable role" });
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    mockWithAuth.mockResolvedValue(session());

    const res = await POST(inviteRequest(undefined, { badJson: true }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns 400 when email is missing or not a valid address", async () => {
    mockWithAuth.mockResolvedValue(session());

    for (const email of [undefined, "", "   ", "not-an-email"]) {
      const res = await POST(inviteRequest({ email }));
      expect(res.status).toBe(400);
    }
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request even with a valid session", async () => {
    mockWithAuth.mockResolvedValue(session());

    const res = await POST(
      inviteRequest(
        { email: "new@acme.test" },
        { headers: { origin: "https://evil.example", host: "localhost:3000" } },
      ),
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Cross-origin request rejected" });
    expect(mockSendInvitation).not.toHaveBeenCalled();
  });

  it("returns a generic 502 when the WorkOS call fails", async () => {
    mockWithAuth.mockResolvedValue(session());
    mockSendInvitation.mockRejectedValueOnce(new Error("boom: user already invited"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(inviteRequest({ email: "new@acme.test" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "Could not send invitation" });
    // The upstream detail is logged, not returned.
    expect(JSON.stringify(body)).not.toContain("already invited");
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
