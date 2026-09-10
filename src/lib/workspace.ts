import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { ADMIN_ROLE, type RoleSlug } from "@/lib/roles";

export type Workspace = { userId: string; organizationId: string };

// A workspace plus the caller's held role slugs, returned by requireRole so a
// handler can make a second authorization decision from the same session.
export type AuthorizedWorkspace = Workspace & { roles: string[] };

// Centralized server-side security checks for the API routes.
//
// Identity, tenant, and role are read from the signed AuthKit session cookie
// (via withAuth) and nowhere else — never from the request URL, body, query, or
// a client-supplied header. That is the whole point of doing this on the
// server: a caller cannot tamper with who they are or what they're allowed to
// do by editing a parameter.
//
// Both helpers return a ready-to-send NextResponse on failure rather than
// throwing, so a route handler stays a straight line:
//
//   const workspace = await requireRole([ROLES.admin]);
//   if (workspace instanceof NextResponse) return workspace;
//   // ...workspace.userId / workspace.organizationId are now trustworthy

const unauthorized = () =>
  NextResponse.json(
    { error: "Unauthorized: missing active workspace" },
    { status: 401 },
  );

const forbidden = () =>
  NextResponse.json({ error: "Forbidden: insufficient role" }, { status: 403 });

// Resolves the caller's workspace from the signed session. 401 when there is no
// valid user or no active organization on the cookie.
export async function requireWorkspace(): Promise<Workspace | NextResponse> {
  const { user, organizationId } = await withAuth();

  if (!user || !organizationId) {
    return unauthorized();
  }

  return { userId: user.id, organizationId };
}

// Resolves the caller's workspace and confirms they hold at least one of
// `allowedRoles`. 401 when unauthenticated (delegated to requireWorkspace),
// 403 when authenticated but lacking every allowed role.
//
// AuthKit may surface the caller's role as a single `role` slug, a `roles`
// array, or both depending on how the environment is configured; we accept a
// match in either.
//
// On success the caller's held role slugs are returned alongside the workspace,
// so a handler can run a second, finer-grained check (e.g. "which roles may
// this caller hand out") without calling withAuth again.
export async function requireRole(
  allowedRoles: RoleSlug[],
): Promise<AuthorizedWorkspace | NextResponse> {
  const workspace = await requireWorkspace();
  if (workspace instanceof NextResponse) return workspace;

  const { role, roles } = await withAuth();
  const held = Array.from(
    new Set([role, ...(roles ?? [])].filter((r): r is string => !!r)),
  );

  const permitted = allowedRoles.some((allowed) => held.includes(allowed));
  if (!permitted) return forbidden();

  return { ...workspace, roles: held };
}

// Convenience wrapper: the common case of "must be an admin". Every
// state-changing member/invitation route gates through this.
export function requireAdminWorkspace(): Promise<
  AuthorizedWorkspace | NextResponse
> {
  return requireRole([ADMIN_ROLE]);
}
