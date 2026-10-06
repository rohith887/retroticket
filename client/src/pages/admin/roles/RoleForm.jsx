import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Badge, Checkbox, EmptyState, Field, Input, SearchInput, Section, Skeleton } from "../../../ui";
import { useUser } from "../../../store/session";
import { fetchUsers, USERS_KEY } from "../users/api";
import { PermissionMatrix } from "./PermissionMatrix";

export const EMPTY_ROLE = { name: "", description: "", permissions: [], userIds: [] };

/** Details, permission matrix and members. Shared by "New role" and "Edit role". */
export function RoleForm({ value, onChange, disabled }) {
  const { fetchWithAuth } = useUser();
  const [memberSearch, setMemberSearch] = useState("");
  const usersQuery = useQuery({ queryKey: USERS_KEY, queryFn: () => fetchUsers(fetchWithAuth), staleTime: 30_000 });

  const memberSet = useMemo(() => new Set(value.userIds), [value.userIds]);

  function toggleMember(id) {
    const next = new Set(memberSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...value, userIds: [...next] });
  }

  const users = usersQuery.data || [];
  const shownUsers = users.filter((u) => {
    const term = memberSearch.trim().toLowerCase();
    return !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
  });

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:items-start">
      <div className="min-w-0 space-y-4">
      <Section title="Role details">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Role name" required>
            {(f) => <Input {...f} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Support agent" maxLength={60} disabled={disabled} required />}
          </Field>
          <Field label="Description" hint="Optional. Shown to admins only.">
            {(f) => <Input {...f} value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} disabled={disabled} />}
          </Field>
        </div>
      </Section>

      <Section title="Permissions" description={`${value.permissions.length} selected. Administrators always have full access regardless of roles.`}>
        <PermissionMatrix value={value.permissions} onChange={(permissions) => onChange({ ...value, permissions })} disabled={disabled} />
      </Section>

      </div>

      <Section className="2xl:sticky 2xl:top-0" title="Members" description={`${value.userIds.length} ${value.userIds.length === 1 ? "person has" : "people have"} this role.`}>
        <SearchInput value={memberSearch} onChange={setMemberSearch} placeholder="Search people" aria-label="Search people" className="w-full sm:w-72" />
        {usersQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : usersQuery.isError ? (
          <p className="text-body-sm text-danger-ink">Couldn't load users. You can still save the role and add members later.</p>
        ) : shownUsers.length === 0 ? (
          <EmptyState title="No people found" className="py-6" />
        ) : (
          <ul className="max-h-72 2xl:max-h-[calc(100dvh-22rem)] divide-y divide-line overflow-y-auto rounded-ds-lg border border-line">
            {shownUsers.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-subtle">
                  <Checkbox checked={memberSet.has(u.id)} onChange={() => toggleMember(u.id)} label={`Add ${u.name}`} disabled={disabled} />
                  <Avatar name={u.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-caption text-ink-faint">{u.email}</span>
                  </span>
                  {u.isAdmin ? <Badge tone="brand">Admin</Badge> : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
