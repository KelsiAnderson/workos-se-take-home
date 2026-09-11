import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ROLE, ROLES, canGrantRole, isAssignableRole } from "@/lib/roles";
import { isCrossOrigin } from "@/lib/http";
import { requireRole } from "@/lib/workspace";

// Invites a new member into the caller's workspace.
//
// Tenant isolation: `organizationId` is read from the signed AuthKit session
// (via withAuth), never from the request body. The invite is pinned to that
// organization, so a caller can only ever add people to their own workspace.
//
// Authorization: the caller must be signed in, have an active workspace, and
// hold the `admin` or `team_lead` role for that workspace — team leads look
// after their own people, so bringing someone in is part of the job. Compliance
// users are strictly read-only and get 403.
//
// Being allowed to invite is not the same as being allowed to grant any role:
// a team lead can invite `team_lead`/`compliance` but not `admin`, otherwise
// the invite endpoint becomes a way for a team lead to escalate to admin. The
// per-role grant matrix lives in @/lib/roles (canGrantRole).

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

  // Identity, tenant, and the role check all come from the signed session.
  const workspace = await requireRole([ROLES.admin, ROLES.team_lead]);
  if (workspace instanceof NextResponse) return workspace;
  const { userId, organizationId, roles: callerRoles } = workspace;

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

  // A caller can only hand out a role at or below their own authority. This is
  // what stops a team lead from inviting someone straight in as an admin.
  if (!canGrantRole(callerRoles, roleSlug)) {
    return NextResponse.json(
      { error: "Your role cannot assign that role" },
      { status: 403 },
    );
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
    // WorkOS rejects a second invite while one is still pending for the same
    // email — that's a real conflict, not an upstream failure, so it gets its
    // own 409 instead of falling into the generic 502 below.
    const { status, message } = error as { status?: number; message?: string };
    if (status === 400 && /already invited/i.test(message ?? "")) {
      return NextResponse.json(
        { error: "This email already has a pending invitation to this workspace" },
        { status: 409 },
      );
    }

    // Log the detail server-side; return a generic message so we don't leak
    // upstream internals or confirm/deny account existence in the response.
    console.error("sendInvitation failed", error);
    return NextResponse.json(
      { error: "Could not send invitation" },
      { status: 502 },
    );
  }
}
