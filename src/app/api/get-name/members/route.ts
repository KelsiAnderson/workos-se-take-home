import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";

// Lists the members of the caller's workspace, read live from WorkOS.
//
// Tenant isolation: `organizationId` comes from the signed session cookie (via
// requireWorkspace), never from the request, and every WorkOS query is scoped
// to it. A user can only ever see members of the organization they're signed
// in to.
//
// Read-only, so any member of the workspace may call it — the compliance role
// needs visibility into everyone. Mutations live on /members/[id] and require
// admin.
//
// WorkOS splits this across two resources: OrganizationMembership carries the
// role and status, User carries the email and name. We fetch both scoped to
// the org and join them on userId.

type MemberPayload = {
  id: string; // organization membership id (what /members/[id] operates on)
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

export async function GET() {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;
  const { organizationId } = workspace;

  try {
    const [memberships, users] = await Promise.all([
      getWorkOS()
        .userManagement.listOrganizationMemberships({ organizationId })
        .then((page) => page.autoPagination()),
      getWorkOS()
        .userManagement.listUsers({ organizationId })
        .then((page) => page.autoPagination()),
    ]);

    const usersById = new Map(users.map((user) => [user.id, user]));

    const members: MemberPayload[] = memberships.map((membership) => {
      const user = usersById.get(membership.userId);
      const fullName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ");

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

    return NextResponse.json({ members });
  } catch (error) {
    console.error("listOrganizationMemberships failed", error);
    return NextResponse.json(
      { error: "Could not list members" },
      { status: 502 },
    );
  }
}
