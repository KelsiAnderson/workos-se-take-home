import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";

// Lists the workspace's pending invitations.
//
// Tenant isolation: scoped to the caller's `organizationId` from the signed
// session. Read-only, so any member of the workspace may call it (the
// compliance role needs visibility into everything in flight); mutations live
// on /invitations/[id] and require admin.
//
// The projection deliberately omits `token` and `acceptInvitationUrl` — those
// are the secret an invitee uses to claim the account and must never reach the
// browser.
export async function GET() {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;
  const { organizationId } = workspace;

  try {
    const invitations = await getWorkOS()
      .userManagement.listInvitations({ organizationId })
      .then((page) => page.autoPagination());

    const pending = invitations
      .filter((invitation) => invitation.state === "pending")
      .map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        state: invitation.state,
        expiresAt: invitation.expiresAt,
      }));

    return NextResponse.json({ invitations: pending });
  } catch (error) {
    console.error("listInvitations failed", error);
    return NextResponse.json(
      { error: "Could not list invitations" },
      { status: 502 },
    );
  }
}
