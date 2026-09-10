// Single source of truth for the workspace's role model.
//
// These slugs mirror the roles configured on the WorkOS Organization and the
// demo data layer (see src/lib/db.ts). Keeping them in one place means the
// invite route and the role-change route validate against the same list, so
// there is exactly one definition of "which roles an admin may hand out".

export const ADMIN_ROLE = "admin";

// The roles an admin is allowed to assign via an invite or a role change.
// Anything outside this set is rejected before it reaches WorkOS, so a caller
// can't grant an unknown/misspelled slug or a privileged role we don't model.
export const ASSIGNABLE_ROLES = new Set(["admin", "team_lead", "compliance"]);

// Least-privileged default: an invite that doesn't name a role lands the
// invitee as read-only compliance rather than silently granting more.
export const DEFAULT_ROLE = "compliance";

export function isAssignableRole(value: unknown): value is string {
  return typeof value === "string" && ASSIGNABLE_ROLES.has(value);
}
