import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ROLE, isAssignableRole } from "@/lib/roles";
import { isCrossOrigin } from "@/lib/http";
import { requireAdminWorkspace } from "@/lib/workspace";

// Invites a new member into the caller's workspace.
//
// Tenant isolation: `organizationId` is read from the signed AuthKit session
// (via withAuth), never from the request body. The invite is pinned to that
// organization, so an admin can only ever add people to their own workspace.
//
// Authorization: the caller must be signed in, have an active workspace, and
// hold the `admin` role for that workspace. Team leads and compliance users
// get 403.

// Keep the response to a safe projection. The raw WorkOS Invitation object
// also carries `token` and `acceptInvitationUrl`; those are delivered to the
// invitee by email and should not be echoed back to the browser or logs.
type InvitePayload = {
  id: string;
  email: string;
  state: string;
  expiresAt: string;
  organizationId: string | null;
};

export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  // Identity, tenant, and the admin check all come from the signed session.
  const workspace = await requireAdminWorkspace();
  if (workspace instanceof NextResponse) return workspace;
  const { userId, organizationId } = workspace;

  // Parse and validate the body. A missing or malformed body is a 400, never
  // a 500.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email: rawEmail, role: rawRole } = body as Record<string, unknown>;

  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    return NextResponse.json({ error: "`email` is required" }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();
  // Cheap shape check; WorkOS does the authoritative validation.
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "`email` is not a valid address" }, { status: 400 });
  }

  let roleSlug = DEFAULT_ROLE;
  if (rawRole !== undefined) {
    if (typeof rawRole !== "string" || !isAssignableRole(rawRole)) {
      return NextResponse.json({ error: "`role` is not an assignable role" }, { status: 400 });
    }
    roleSlug = rawRole;
  }

  try {
    const invitation = await getWorkOS().userManagement.sendInvitation({
      email,
      // Tenant scope: forced to the caller's org, ignoring anything in the body.
      organizationId,
      roleSlug,
      // Attribution + expiry are recorded server-side, not client-controlled.
      inviterUserId: userId,
      expiresInDays: 7,
    });

    const payload: InvitePayload = {
      id: invitation.id,
      email: invitation.email,
      state: invitation.state,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
    };
    return NextResponse.json({ invite: payload }, { status: 201 });
  } catch (error) {
    // Log the detail server-side; return a generic message so we don't leak
    // upstream internals or confirm/deny account existence in the response.
    console.error("sendInvitation failed", error);
    return NextResponse.json(
      { error: "Could not send invitation" },
      { status: 502 },
    );
  }
}
