import { getWorkOS } from "@workos-inc/authkit-nextjs";

// Reads a workspace's pending invitations live from WorkOS.
//
// The projection deliberately omits `token` and `acceptInvitationUrl` — those
// are the secret an invitee uses to claim the account and must never reach the
// browser. Shared by `GET /api/get-name/invitations` and the `/members` page.
// The caller is responsible for passing an `organizationId` that came from the
// signed session — this function does no authorization of its own.

export type PendingInvitation = {
  id: string;
  email: string;
  state: string;
  expiresAt: string;
};

export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitation[]> {
  const invitations = await getWorkOS()
    .userManagement.listInvitations({ organizationId })
    .then((page) => page.autoPagination());

  return invitations
    .filter((invitation) => invitation.state === "pending")
    .map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      state: invitation.state,
      expiresAt: invitation.expiresAt,
    }));
}
