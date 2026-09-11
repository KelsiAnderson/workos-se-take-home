import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";
import { listPendingInvitations } from "@/lib/invitations";

// Lists the workspace's pending invitations.
//
// Tenant isolation: scoped to the caller's `organizationId` from the signed
// session. Read-only, so any member of the workspace may call it (the
// compliance role needs visibility into everything in flight); mutations live
// on /invitations/[id] and require admin.
export async function GET() {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;

  try {
    const invitations = await listPendingInvitations(workspace.organizationId);
    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("listPendingInvitations failed", error);
    return NextResponse.json(
      { error: "Could not list invitations" },
      { status: 502 },
    );
  }
}
