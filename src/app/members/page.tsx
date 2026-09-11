import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { listWorkspaceMembers } from "@/lib/members";
import { listPendingInvitations } from "@/lib/invitations";
import { ROLES, type RoleSlug } from "@/lib/roles";
import { tenantByOrganizationId } from "@/lib/tenants";
import { MembersClient } from "./members-client";

// The self-serve member directory (requirements 2 and 3).
//
// Identity, tenant, and role come from the signed session. The member list is
// read live from WorkOS, scoped to the caller's organization. The client
// component below renders role-appropriate controls, but the API routes it
// calls are what actually enforce access.
export default async function MembersPage() {
  const { user, organizationId, role, roles } = await withAuth({
    ensureSignedIn: true,
  });
  if (!organizationId) redirect("/login");

  const held = new Set<string>([
    ...(role ? [role] : []),
    ...(roles ?? []),
  ]);
  const callerRole =
    (Object.values(ROLES) as RoleSlug[]).find((r) => held.has(r)) ?? "member";

  const workspaceName =
    tenantByOrganizationId(organizationId)?.tenant.name ?? organizationId;

  let members;
  let invitations;
  try {
    [members, invitations] = await Promise.all([
      listWorkspaceMembers(organizationId),
      listPendingInvitations(organizationId),
    ]);
  } catch {
    return (
      <Flex direction="column" gap="2">
        <Heading size="7">Members</Heading>
        <Text color="red">Could not load members from WorkOS.</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4" style={{ width: "min(680px, 90vw)" }}>
      <Flex direction="column" gap="1">
        <Heading size="7">Members</Heading>
        <Text color="gray" size="2">
          {workspaceName} · signed in as {callerRole}
        </Text>
      </Flex>
      <MembersClient
        members={members}
        invitations={invitations}
        callerRole={callerRole}
        selfUserId={user.id}
      />
    </Flex>
  );
}
