import {
  signSessionStamp,
  readSessionStamp,
  sessionIdFromAccessToken,
} from "./session-policy";

beforeEach(() => {
  process.env.WORKOS_COOKIE_PASSWORD =
    "test-cookie-password-at-least-32-characters";
});

// Build a JWT-shaped string with the given payload (signature is ignored).
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("signSessionStamp / readSessionStamp", () => {
  it("round-trips the session id and timestamp", async () => {
    const cookie = await signSessionStamp("session_abc", 1_700_000_000_000);

    await expect(readSessionStamp(cookie)).resolves.toEqual({
      sid: "session_abc",
      issuedAt: 1_700_000_000_000,
    });
  });

  it("rejects a forged timestamp (signature no longer matches)", async () => {
    const cookie = await signSessionStamp("session_abc", 1_700_000_000_000);
    const [sid, , sig] = cookie.split(":");
    const tampered = `${sid}:9999999999999:${sig}`;

    await expect(readSessionStamp(tampered)).resolves.toBeNull();
  });

  it("rejects a swapped session id", async () => {
    const cookie = await signSessionStamp("session_abc", 1_700_000_000_000);
    const [, ts, sig] = cookie.split(":");

    await expect(readSessionStamp(`session_evil:${ts}:${sig}`)).resolves.toBeNull();
  });

  it("rejects a stamp signed with a different secret", async () => {
    const cookie = await signSessionStamp("session_abc", 1_700_000_000_000);
    process.env.WORKOS_COOKIE_PASSWORD = "a-completely-different-secret-value-here";

    await expect(readSessionStamp(cookie)).resolves.toBeNull();
  });

  it("returns null for missing or malformed values", async () => {
    for (const value of [undefined, null, "", "garbage", "no-signature-here"]) {
      await expect(readSessionStamp(value)).resolves.toBeNull();
    }
  });
});

describe("sessionIdFromAccessToken", () => {
  it("pulls the sid claim out of an access token", () => {
    expect(sessionIdFromAccessToken(fakeJwt({ sid: "session_xyz" }))).toBe(
      "session_xyz",
    );
  });

  it("returns null when there is no sid or the token is unparseable", () => {
    expect(sessionIdFromAccessToken(fakeJwt({ org_id: "org_1" }))).toBeNull();
    expect(sessionIdFromAccessToken("not-a-jwt")).toBeNull();
    expect(sessionIdFromAccessToken("")).toBeNull();
  });
});
