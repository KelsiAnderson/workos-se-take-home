import NextLink from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { SignInButton } from "./components/sign-in-button";
import { ROLES, ROLE_DEFINITIONS, type RoleSlug } from "@/lib/roles";
import { tenantByOrganizationId } from "@/lib/tenants";

export default async function HomePage() {
  const { user, organizationId, role, roles } = await withAuth();

  if (user) {
    const held = new Set<string>([...(role ? [role] : []), ...(roles ?? [])]);
    const callerRole =
      (Object.values(ROLES) as RoleSlug[]).find((r) => held.has(r)) ??
      undefined;
    const workspaceName =
      tenantByOrganizationId(organizationId)?.tenant.name ?? organizationId;

    return (
      <Flex direction="column" align="center" gap="2">
        <Heading size="8">
          Welcome back{user.firstName && `, ${user.firstName}`}
        </Heading>
        <Text size="5" color="gray">
          {workspaceName
            ? `${workspaceName} · signed in as ${
                callerRole ? ROLE_DEFINITIONS[callerRole].label : "member"
              }`
            : "Signed in to Meridian Analytics"}
        </Text>
        <Flex align="center" gap="3" mt="4">
          <Button asChild size="3" variant="soft">
            <NextLink href="/members">Team members</NextLink>
          </Button>
          <Button asChild size="3" variant="soft">
            <NextLink href="/account">View account</NextLink>
          </Button>
          <SignInButton large />
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" align="center" gap="2">
      <Heading size="8">Meridian Analytics</Heading>
      <Text size="5" color="gray" mb="4">
        Sign in to your team's workspace
      </Text>
      <Flex align="center" gap="3">
        <SignInButton large />
        <Button asChild size="3" variant="soft">
          <a href="/login?org=acme">Sign in to Acme Corp (Okta)</a>
        </Button>
      </Flex>
    </Flex>
  );
}
