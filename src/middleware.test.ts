import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import middleware from "./middleware";
import { TENANTS } from "@/lib/tenants";
import { SESSION_STAMP_COOKIE, signSessionStamp } from "@/lib/session-policy";

jest.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: jest.fn(),
  handleAuthkitHeaders: jest.fn(),
}));

const mockAuthkit = authkit as jest.MockedFunction<typeof authkit>;
const mockHandleHeaders = handleAuthkitHeaders as jest.MockedFunction<
  typeof handleAuthkitHeaders
>;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WORKOS_COOKIE_PASSWORD =
    "test-cookie-password-at-least-32-characters";
  mockHandleHeaders.mockReturnValue(NextResponse.next());
});

function request(cookie?: string) {
  return new NextRequest("http://localhost:3000/account", {
    headers: cookie ? { cookie } : {},
  });
}

type PartialSession = { user: unknown; sessionId?: string; organizationId?: string };

function mockSession(session: PartialSession) {
  mockAuthkit.mockResolvedValue({
    session,
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof authkit>>);
}

const strictSession = (overrides = {}) => ({
  user: { id: "user_1", email: "sec@northwind.test" },
  sessionId: "session_nw_1",
  organizationId: TENANTS.northwind.organizationId,
  ...overrides,
});

describe("middleware — session policy enforcement", () => {
  it("passes through when there is no session", async () => {
    mockSession({ user: null });

    const res = await middleware(request());

    expect(mockHandleHeaders).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("passes through for a tenant with no session policy", async () => {
    mockSession({
      user: { id: "user_1" },
      sessionId: "session_acme_1",
      organizationId: TENANTS.acme.organizationId,
    });

    await middleware(request());

    expect(mockHandleHeaders).toHaveBeenCalledTimes(1);
  });

  it("passes through a strict tenant with a fresh, valid stamp", async () => {
    mockSession(strictSession());
    const stamp = await signSessionStamp("session_nw_1", Date.now() - 1 * HOUR);

    await middleware(request(`${SESSION_STAMP_COOKIE}=${stamp}`));

    expect(mockHandleHeaders).toHaveBeenCalledTimes(1);
  });

  it("forces re-auth for a strict tenant with no stamp cookie", async () => {
    mockSession(strictSession());

    const res = await middleware(request());

    expect(mockHandleHeaders).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).toContain("org=northwind");
    expect(location).toContain("error=session_expired");
    // Session cookies are cleared on the way out.
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain(`${SESSION_STAMP_COOKIE}=`);
    expect(setCookie).toContain("wos-session=");
  });

  it("forces re-auth once the stamp is older than the 24h cap", async () => {
    mockSession(strictSession());
    const stamp = await signSessionStamp("session_nw_1", Date.now() - 25 * HOUR);

    const res = await middleware(request(`${SESSION_STAMP_COOKIE}=${stamp}`));

    expect(res.status).toBe(307);
    expect(mockHandleHeaders).not.toHaveBeenCalled();
  });

  it("forces re-auth when the stamp belongs to a different session", async () => {
    mockSession(strictSession({ sessionId: "session_nw_2" }));
    const stamp = await signSessionStamp("session_nw_1", Date.now());

    const res = await middleware(request(`${SESSION_STAMP_COOKIE}=${stamp}`));

    expect(res.status).toBe(307);
  });
});
