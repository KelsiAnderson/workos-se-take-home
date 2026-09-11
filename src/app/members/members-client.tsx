"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Callout,
  Flex,
  Select,
  Table,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { WorkspaceMember } from "@/lib/members";
import type { PendingInvitation } from "@/lib/invitations";
import {
  ROLES,
  ROLE_DEFINITIONS,
  canGrantRole,
  isAssignableRole,
  type RoleSlug,
} from "@/lib/roles";

type CallerRole = RoleSlug | "member";

// The member directory UI.
//
// This is a convenience layer, not a security boundary: the API routes
// (`/api/get-name/members/*`) enforce every rule. The UI just avoids showing a
// control the caller can't use — the "which roles can I hand out" options come
// from the same `canGrantRole()` the server runs, so the two never drift.
export function MembersClient({
  members,
  invitations,
  callerRole,
  selfUserId,
}: {
  members: WorkspaceMember[];
  invitations: PendingInvitation[];
  callerRole: CallerRole;
  selfUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const grantable = (Object.values(ROLES) as RoleSlug[]).filter((r) =>
    canGrantRole([callerRole], r),
  );
  const canInvite = grantable.length > 0;
  const canManageMembers = callerRole === ROLES.admin;

  async function run(label: string, req: () => Promise<Response>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await req();
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(`${label} failed (${res.status}): ${body.error ?? "unknown error"}`);
          return;
        }
        router.refresh();
      } catch {
        setError(`${label} failed: network error`);
      }
    });
  }

  return (
    <Flex direction="column" gap="4">
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Role</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            {canManageMembers && <Table.ColumnHeaderCell />}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {members.map((m) => (
            <Table.Row key={m.id}>
              <Table.Cell>
                {m.name}
                {m.userId === selfUserId && (
                  <Text color="gray" size="1">
                    {" "}
                    (you)
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>{m.email}</Table.Cell>
              <Table.Cell>
                {canManageMembers ? (
                  <Select.Root
                    value={isAssignableRole(m.role) ? m.role : undefined}
                    disabled={pending}
                    onValueChange={(role) =>
                      run("Role change", () =>
                        fetch(`/api/get-name/members/${m.id}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ role }),
                        }),
                      )
                    }
                  >
                    <Select.Trigger />
                    <Select.Content>
                      {(Object.values(ROLES) as RoleSlug[]).map((r) => (
                        <Select.Item key={r} value={r}>
                          {ROLE_DEFINITIONS[r].label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <Badge color="gray">
                    {isAssignableRole(m.role)
                      ? ROLE_DEFINITIONS[m.role].label
                      : m.role || "—"}
                  </Badge>
                )}
              </Table.Cell>
              <Table.Cell>
                <Badge color={m.status === "active" ? "green" : "gray"}>
                  {m.status}
                </Badge>
              </Table.Cell>
              {canManageMembers && (
                <Table.Cell>
                  <Button
                    variant="soft"
                    color="red"
                    size="1"
                    disabled={pending}
                    onClick={() =>
                      run("Remove", () =>
                        fetch(`/api/get-name/members/${m.id}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                  >
                    Remove
                  </Button>
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {canInvite ? (
        <InviteForm grantable={grantable} pending={pending} onInvite={run} />
      ) : (
        <Text color="gray" size="2">
          Your role has read-only access to the directory.
        </Text>
      )}

      {invitations.length > 0 && (
        <Flex direction="column" gap="2">
          <Text weight="bold" size="2">
            Pending invitations
          </Text>
          <Table.Root variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Expires</Table.ColumnHeaderCell>
                {canManageMembers && <Table.ColumnHeaderCell />}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invitations.map((invite) => (
                <Table.Row key={invite.id}>
                  <Table.Cell>{invite.email}</Table.Cell>
                  <Table.Cell>
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </Table.Cell>
                  {canManageMembers && (
                    <Table.Cell>
                      <Button
                        variant="soft"
                        color="red"
                        size="1"
                        disabled={pending}
                        onClick={() =>
                          run("Revoke", () =>
                            fetch(`/api/get-name/invitations/${invite.id}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                      >
                        Revoke
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Flex>
      )}
    </Flex>
  );
}

function InviteForm({
  grantable,
  pending,
  onInvite,
}: {
  grantable: RoleSlug[];
  pending: boolean;
  onInvite: (label: string, req: () => Promise<Response>) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleSlug>(grantable[grantable.length - 1]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onInvite("Invite", () =>
          fetch("/api/get-name/members/invite", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, role }),
          }),
        );
        setEmail("");
      }}
    >
      <Flex gap="2" align="center" wrap="wrap">
        <TextField.Root
          type="email"
          required
          placeholder="new.person@acme.test"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <Select.Root
          value={role}
          onValueChange={(r) => setRole(r as RoleSlug)}
        >
          <Select.Trigger />
          <Select.Content>
            {grantable.map((r) => (
              <Select.Item key={r} value={r}>
                {ROLE_DEFINITIONS[r].label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Button type="submit" disabled={pending || !email}>
          Send invite
        </Button>
      </Flex>
    </form>
  );
}
