// Single source of truth for the workspace's role model.
//
// A customer like Acme has three kinds of people in a workspace: the admins who
// run it, the team leads who look after their own reports, and the compliance
// folks who must be able to see everything but change nothing. Each maps to
// exactly one slug below, and these slugs mirror the roles configured on the
// WorkOS Organization.
//
// Keeping them here means the invite route and the role-change route validate
// against the same allowlist, so there is one definition of "which roles an
// admin may hand out".

// Machine-readable role slugs. Values match the WorkOS role slugs exactly.
export const ROLES = {
  admin: "admin",
  team_lead: "team_lead",
  compliance: "compliance",
} as const;

export type RoleSlug = (typeof ROLES)[keyof typeof ROLES];

// The role an admin holds; every state-changing member/invitation route gates
// on it (see src/lib/workspace.ts).
export const ADMIN_ROLE = ROLES.admin;

// Least-privileged default: an invite that doesn't name a role lands the
// invitee as read-only compliance rather than silently granting more.
export const DEFAULT_ROLE: RoleSlug = ROLES.compliance;

// User-facing copy for each role. Pickers, badges, and the member directory
// read from here so the UI never hard-codes a label next to a slug.
export const ROLE_DEFINITIONS: Record<
  RoleSlug,
  { label: string; description: string }
> = {
  [ROLES.admin]: {
    label: "Admin",
    description:
      "Runs the workspace. Full read, write, and delete access to members, roles, and invitations.",
  },
  [ROLES.team_lead]: {
    label: "Team Lead",
    description:
      "Looks after their own people. Can view the directory and send invitations, but cannot change roles or remove members.",
  },
  [ROLES.compliance]: {
    label: "Compliance",
    description:
      "Sees everything, changes nothing. Strictly read-only access to the entire workspace.",
  },
};

// The roles that can be assigned via an invite or a role change at all. Anything
// outside this allowlist is rejected before it reaches WorkOS, so a caller
// can't grant an unknown/misspelled slug or a privileged role we don't model.
const ASSIGNABLE_ROLES: readonly RoleSlug[] = [
  ROLES.admin,
  ROLES.team_lead,
  ROLES.compliance,
];

export function isAssignableRole(role: string): role is RoleSlug {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

// Which roles a caller may hand out, keyed by the caller's own role. Being
// allowed to invite is not the same as being allowed to grant any role: a team
// lead brings their own people in, but only an admin creates other admins.
// Without this, "invite" is a privilege-escalation path — a team lead could
// mint an admin and inherit workspace-wide control.
const GRANTABLE_BY_ROLE: Record<RoleSlug, readonly RoleSlug[]> = {
  [ROLES.admin]: [ROLES.admin, ROLES.team_lead, ROLES.compliance],
  [ROLES.team_lead]: [ROLES.team_lead, ROLES.compliance],
  [ROLES.compliance]: [],
};

// True when a caller holding `callerRoles` is permitted to assign `targetRole`.
// `targetRole` is assumed to have already passed isAssignableRole().
export function canGrantRole(
  callerRoles: readonly string[],
  targetRole: string,
): boolean {
  return callerRoles.some((role) => {
    const grantable = GRANTABLE_BY_ROLE[role as RoleSlug] as
      | readonly string[]
      | undefined;
    return grantable?.includes(targetRole) === true;
  });
}
