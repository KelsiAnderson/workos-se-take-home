import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";
import { listWorkspaceMembers } from "@/lib/members";

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

export async function GET() {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;

  try {
    const members = await listWorkspaceMembers(workspace.organizationId);
    return NextResponse.json({ members });
  } catch (error) {
    console.error("listWorkspaceMembers failed", error);
    return NextResponse.json(
      { error: "Could not list members" },
      { status: 502 },
    );
  }
}
