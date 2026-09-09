import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Lists the members of the caller's workspace.
//
// Tenant isolation: we read `organizationId` from the signed session cookie
// (via withAuth), never from the request, and scope the query to it. A user
// can only ever see members of the organization they're signed in to.
export async function GET() {
  const { user, organizationId } = await withAuth();
  if (!user || !organizationId) {
    return NextResponse.json(
      { error: "Unauthorized: missing active workspace" },
      { status: 401 },
    );
  }

  const members = await db.members.findMany({
    where: { organizationId },
  });

  return NextResponse.json({ members });
}
