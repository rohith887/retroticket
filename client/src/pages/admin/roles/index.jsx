// Admin > Roles. List page + the global "enforce roles" switch (PATCH /v1/config/authentication/toggle-roles).
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useUser } from "../../../store/session";
import { Alert, Badge, Button, ConfirmDialog, DataTable, EmptyState, EntityCell, Page, PageHeader, Panel, SearchInput, Switch, Tooltip, toast } from "../../../ui";
import { deleteRole, fetchRolesFull, ROLES_LIST_KEY, setRolesEnforced } from "./api";

export default function Roles() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [confirmEnforce, setConfirmEnforce] = useState(null); // true | false | null
  const [switching, setSwitching] = useState(false);

  const query = useQuery({ queryKey: ROLES_LIST_KEY, queryFn: () => fetchRolesFull(fetchWithAuth), staleTime: 15_000 });
  const roles = query.data?.roles || [];
  const enforced = query.data?.rolesActive === true;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? roles.filter((r) => r.name.toLowerCase().includes(term) || (r.description || "").toLowerCase().includes(term)) : roles;
  }, [roles, search]);

  const columns = [
    { id: "name", header: "Role", sortValue: (r) => r.name, cell: (r) => <EntityCell title={r.name} subtitle={r.description || null} suffix={r.isDefault ? "Default" : null} /> },
    { id: "permissions", header: "Permissions", sortValue: (r) => (r.permissions || []).length, cell: (r) => <Badge>{(r.permissions || []).length} granted</Badge> },
    { id: "users", header: "Members", sortValue: (r) => (r.users || []).length, className: "text-ink-muted", cell: (r) => (r.users || []).length },
  ];

  async function applyEnforce(next) {
    setSwitching(true);
    try {
      await setRolesEnforced(fetchWithAuth, next);
      toast.success(next ? "Role permissions are now enforced" : "Role permissions are no longer enforced");
      await query.refetch();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Roles"
        description="Bundles of permissions you can give to people."
        actions={
          <Button as={Link} to="/admin/roles/new" variant="primary">
            <Plus className="h-4 w-4" /> New role
          </Button>
        }
      />

      {query.isSuccess ? (
        <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="enforce-roles" className="block text-body-sm font-medium text-ink">
              Enforce role permissions
            </label>
            <p className="text-caption text-ink-muted">
              {enforced ? "People can only do what their roles allow. Administrators always have full access." : "Off: every signed-in user can use every feature. Turn this on once your roles are set up."}
            </p>
          </div>
          <Switch id="enforce-roles" checked={enforced} onCheckedChange={setConfirmEnforce} disabled={switching} aria-label="Enforce role permissions" />
        </Panel>
      ) : null}
      {query.isSuccess && !enforced ? (
        <Alert tone="warning" title="Roles are not being enforced">
          Until enforcement is on, the permissions in these roles have no effect.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search roles" aria-label="Search roles" className="w-full sm:w-64" />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "role" : "roles"}` : ""}</span>
      </div>

      <DataTable
        label="Roles"
        columns={columns}
        rows={filtered}
        getRowId={(r) => r._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(r) => navigate(`/admin/roles/${r._id}`)}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={search}
        rowActions={(r) => (
          <>
            <Tooltip content="Edit">
              <Button variant="ghost" size="sm" icon aria-label={`Edit ${r.name}`} onClick={() => navigate(`/admin/roles/${r._id}`)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Delete">
              <Button variant="danger-ghost" size="sm" icon aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </>
        )}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title={search ? "No roles match your search" : "No roles yet"}
            description={search ? "Try a different search." : "Create a role to control what people can do."}
            action={search ? <Button onClick={() => setSearch("")}>Clear search</Button> : <Button as={Link} to="/admin/roles/new" variant="primary">New role</Button>}
          />
        }
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete role?"
        description={deleting ? `"${deleting.name}" will be removed from ${(deleting.users || []).length} ${(deleting.users || []).length === 1 ? "person" : "people"}. This cannot be undone.` : ""}
        confirmLabel="Delete role"
        onConfirm={async () => {
          await deleteRole(fetchWithAuth, deleting._id);
          toast.success("Role deleted");
          query.refetch();
        }}
      />

      <ConfirmDialog
        open={confirmEnforce !== null}
        onOpenChange={(open) => !open && setConfirmEnforce(null)}
        title={confirmEnforce ? "Enforce role permissions?" : "Stop enforcing role permissions?"}
        description={
          confirmEnforce
            ? "People will only be able to do what their roles allow. Anyone without a suitable role loses access to those features immediately."
            : "Every signed-in user will be able to use every feature until you turn enforcement back on."
        }
        confirmLabel={confirmEnforce ? "Enforce roles" : "Stop enforcing"}
        tone={confirmEnforce ? "primary" : "danger"}
        onConfirm={() => applyEnforce(confirmEnforce)}
      />
    </Page>
  );
}
