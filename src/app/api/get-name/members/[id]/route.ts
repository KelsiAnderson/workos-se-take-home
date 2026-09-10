import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_ROLE, isAssignableRole } from "@/lib/roles";
import { isCrossOrigin } from "@/lib/http";
import { requireAdminWorkspace } from "@/lib/workspace";

// Change a member's role (PATCH) or remove them from the workspace (DELETE).
//
// The membership id comes from the URL, which the caller controls — unlike the
// invite route, where the only input is an email. So ownership can't be
// implicit: every handler re-fetches the membership and confirms it belongs to
// the caller's organization before touching it. A membership in another tenant,
// and an id that doesn't exist at all, both return an identical 404 so a caller
// can't probe which ids are real elsewhere.

type RouteContext = { params: Promise<{ id: string }> };

type MemberPayload = {
  id: string;
  userId: string;
  organizationId: string;
  status: string;
  role: string;
};

// Minimal shape we rely on from WorkOS's OrganizationMembership.
type Membership = {
  id: string;
  userId: string;
  organizationId: string;
  status: string;
  role: { slug: string };
  roles?: { slug: string }[];
};

function projectMember(membership: Membership): MemberPayload {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    status: membership.status,
    role: membership.role.slug,
  };
}

function hasAdminRole(membership: Membership): boolean {
  return (
    membership.role.slug === ADMIN_ROLE ||
    membership.roles?.some((r) => r.slug === ADMIN_ROLE) === true
  );
}

// Returns the membership only if it exists AND lives in `organizationId`.
// null means "show the caller a 404"; a thrown error means WorkOS itself
// failed and the caller should see a 502.
async function loadOwnedMembership(
  membershipId: string,
  organizationId: string,
): Promise<Membership | null> {
  try {
    const membership = (await getWorkOS().userManagement.getOrganizationMembership(
      membershipId,
    )) as unknown as Membership;
    return membership.organizationId === organizationId ? membership : null;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

// True when this membership is the workspace's only remaining active admin —
// demoting or removing it would lock everyone out of admin actions.
async function isLastActiveAdmin(
  membership: Membership,
  organizationId: string,
): Promise<boolean> {
  if (!hasAdminRole(membership)) return false;

  const memberships = (await getWorkOS().userManagement
    .listOrganizationMemberships({ organizationId, statuses: ["active"] })
    .then((page) => page.autoPagination())) as unknown as Membership[];

  const admins = memberships.filter(hasAdminRole);
  return admins.length <= 1;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (isCrossOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const workspace = await requireAdminWorkspace();
  if (workspace instanceof NextResponse) return workspace;
  const { organizationId } = workspace;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { role: rawRole } = body as Record<string, unknown>;
  if (!isAssignableRole(rawRole)) {
    return NextResponse.json({ error: "`role` is not an assignable role" }, { status: 400 });
  }

  try {
    const membership = await loadOwnedMembership(id, organizationId);
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (
      rawRole !== ADMIN_ROLE &&
      (await isLastActiveAdmin(membership, organizationId))
    ) {
      return NextResponse.json(
        { error: "Cannot demote the last admin" },
        { status: 409 },
      );
    }

    const updated = (await getWorkOS().userManagement.updateOrganizationMembership(
      id,
      { roleSlug: rawRole },
    )) as unknown as Membership;

    return NextResponse.json({ member: projectMember(updated) });
  } catch (error) {
    console.error("updateOrganizationMembership failed", error);
    return NextResponse.json({ error: "Could not update member" }, { status: 502 });
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
    const membership = await loadOwnedMembership(id, organizationId);
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (await isLastActiveAdmin(membership, organizationId)) {
      return NextResponse.json(
        { error: "Cannot remove the last admin" },
        { status: 409 },
      );
    }

    await getWorkOS().userManagement.deleteOrganizationMembership(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("deleteOrganizationMembership failed", error);
    return NextResponse.json({ error: "Could not remove member" }, { status: 502 });
  }
}
