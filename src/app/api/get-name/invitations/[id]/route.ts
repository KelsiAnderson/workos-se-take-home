import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isCrossOrigin } from "@/lib/http";
import { requireAdminWorkspace } from "@/lib/workspace";

// Revoke a pending invitation.
//
// This is the "remove them" path for people who were invited but haven't
// accepted yet — they aren't memberships, so DELETE /members/[id] doesn't
// touch them. Same rules as the member routes: admin only, and the invitation
// id from the URL is verified to belong to the caller's organization before
// anything happens. An invitation in another tenant and a non-existent id both
// return 404.

type RouteContext = { params: Promise<{ id: string }> };

type Invitation = {
  id: string;
  organizationId: string | null;
  state: string;
};

async function loadOwnedInvitation(
  invitationId: string,
  organizationId: string,
): Promise<Invitation | null> {
  try {
    const invitation = (await getWorkOS().userManagement.getInvitation(
      invitationId,
    )) as unknown as Invitation;
    return invitation.organizationId === organizationId ? invitation : null;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (isCrossOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const workspace = await requireAdminWorkspace();
  if (workspace instanceof NextResponse) return workspace;
  const { organizationId } = workspace;

  const { id } = await params;

  try {
    const invitation = await loadOwnedInvitation(id, organizationId);
    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (invitation.state !== "pending") {
      return NextResponse.json(
        { error: "Invitation is no longer pending" },
        { status: 409 },
      );
    }

    await getWorkOS().userManagement.revokeInvitation(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("revokeInvitation failed", error);
    return NextResponse.json(
      { error: "Could not revoke invitation" },
      { status: 502 },
    );
  }
}
