import { withAuth } from "@workos-inc/authkit-nextjs";
import { Text, Heading, Flex, Badge } from "@radix-ui/themes";
import { ROLES, ROLE_DEFINITIONS, type RoleSlug } from "@/lib/roles";
import { tenantByOrganizationId } from "@/lib/tenants";

export default async function AccountPage() {
  const { user, organizationId, role, roles } = await withAuth({
    ensureSignedIn: true,
  });

  const held = new Set<string>([...(role ? [role] : []), ...(roles ?? [])]);
  const callerRole =
    (Object.values(ROLES) as RoleSlug[]).find((r) => held.has(r)) ??
    undefined;
  const workspaceName =
    tenantByOrganizationId(organizationId)?.tenant.name ?? organizationId;
  const roleLabel = callerRole ? ROLE_DEFINITIONS[callerRole].label : "Member";

  const fields: [string, string | undefined][] = [
    [
      "Name",
      [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    ],
    ["Email", user.email],
  ];

  return (
    <Flex direction="column" gap="4" style={{ width: "min(420px, 90vw)" }}>
      <Flex direction="column" gap="1">
        <Heading size="7">Account</Heading>
        <Text color="gray" size="2">
          {workspaceName} · signed in as {roleLabel}
        </Text>
      </Flex>

      <Flex direction="column" gap="3">
        {fields.map(([label, value]) =>
          value ? (
            <Flex key={label} justify="between" align="center">
              <Text color="gray" size="2">
                {label}
              </Text>
              <Text size="3">{value}</Text>
            </Flex>
          ) : null,
        )}
        <Flex justify="between" align="center">
          <Text color="gray" size="2">
            Role
          </Text>
          <Badge>{roleLabel}</Badge>
        </Flex>
      </Flex>
    </Flex>
  );
}
