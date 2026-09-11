import { getWorkOS } from "@workos-inc/authkit-nextjs";

// Reads a workspace's member directory live from WorkOS.
//
// WorkOS splits this across two resources: OrganizationMembership carries the
// role and status, User carries the email and name. We fetch both scoped to the
// organization and join them on userId.
//
// Both the `GET /api/get-name/members` route and the `/members` page use this,
// so the projection (and the tenant scoping) live in one place. The caller is
// responsible for passing an `organizationId` that came from the signed session
// — this function does no authorization of its own.

export type WorkspaceMember = {
  id: string; // organization membership id — what /members/[id] operates on
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

export async function listWorkspaceMembers(
  organizationId: string,
): Promise<WorkspaceMember[]> {
  const [memberships, users] = await Promise.all([
    getWorkOS()
      .userManagement.listOrganizationMemberships({ organizationId })
      .then((page) => page.autoPagination()),
    getWorkOS()
      .userManagement.listUsers({ organizationId })
      .then((page) => page.autoPagination()),
  ]);

  const usersById = new Map(users.map((user) => [user.id, user]));

  return memberships.map((membership) => {
    const user = usersById.get(membership.userId);
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    return {
      id: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      email: user?.email ?? "",
      name: fullName || user?.email || membership.userId,
      role: membership.role?.slug ?? "",
      status: membership.status,
    };
  });
}
