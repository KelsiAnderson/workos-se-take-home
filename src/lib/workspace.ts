import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { ADMIN_ROLE } from "@/lib/roles";

export type Workspace = { userId: string; organizationId: string };

// Resolves the caller's workspace from the signed AuthKit session.
//
// Identity and tenant are read from the session cookie only — never from the
// request URL, body, or query. Returns a ready-to-send NextResponse (401) when
// there is no signed-in user with an active workspace:
//
//   const workspace = await requireWorkspace();
//   if (workspace instanceof NextResponse) return workspace;
export async function requireWorkspace(): Promise<Workspace | NextResponse> {
  const { user, organizationId } = await withAuth();

  if (!user || !organizationId) {
    return NextResponse.json(
      { error: "Unauthorized: missing active workspace" },
      { status: 401 },
    );
  }

  return { userId: user.id, organizationId };
}

// Like requireWorkspace, but also requires the caller to hold the `admin` role
// for that workspace (403 otherwise). Every state-changing member/invitation
// route gates through this.
export async function requireAdminWorkspace(): Promise<Workspace | NextResponse> {
  const { user, organizationId, role, roles } = await withAuth();

  if (!user || !organizationId) {
    return NextResponse.json(
      { error: "Unauthorized: missing active workspace" },
      { status: 401 },
    );
  }

  const isAdmin = role === ADMIN_ROLE || roles?.includes(ADMIN_ROLE) === true;
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  return { userId: user.id, organizationId };
}
