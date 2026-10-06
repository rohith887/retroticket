// Admin > Users. The canonical list page: PageHeader, views, search, filter chips, column picker, bulk
// selection, DataTable (sticky header, sorting, row actions, pagination), detail drawer, dialogs.
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Columns3, KeyRound, LogOut, MoreHorizontal, Pencil, Trash2, UserPlus, Users as UsersIcon, X } from "lucide-react";
import { useUser } from "../../../store/session";
import {
  Button,
  DataTable,
  EmptyState,
  EntityCell,
  FilterChip,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Page,
  PageHeader,
  SearchInput,
  Tabs,
  Tooltip,
  toast,
} from "../../../ui";
import { formatDateTime, timeAgo } from "../../../ui/time";
import { fetchRoles, fetchUsers, ROLES_KEY, signOutEverywhere, USERS_KEY } from "./api";
import { DeleteUsersDialog, ResetPasswordDialog } from "./UserDialogs";
import { RoleBadges, UserDrawer } from "./UserDrawer";

const DAY = 24 * 60 * 60 * 1000;
const COLUMNS_KEY = "ds-users-columns";
const OPTIONAL_COLUMNS = [
  { id: "role", label: "Access" },
  { id: "lastLogin", label: "Last sign-in" },
  { id: "sessions", label: "Active sessions" },
  { id: "created", label: "Created" },
];

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY));
    if (Array.isArray(saved)) return saved;
  } catch {
    /* fall through to defaults */
  }
  return ["role", "lastLogin", "sessions"];
}

const neverSignedIn = (user) => !user.lastLoginAt;
const SIGN_IN_FILTERS = {
  active7: (user) => user.lastLoginAt && Date.now() - new Date(user.lastLoginAt).getTime() <= 7 * DAY,
  never: neverSignedIn,
  inactive30: (user) => user.lastLoginAt && Date.now() - new Date(user.lastLoginAt).getTime() > 30 * DAY,
};

export default function Users() {
  const { fetchWithAuth, user: currentUser } = useUser();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(null);
  const [signInFilter, setSignInFilter] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState(loadColumns);
  const [selected, setSelected] = useState(() => new Set());
  const [drawer, setDrawer] = useState({ id: null, tab: "overview" });
  const [resetting, setResetting] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const usersQuery = useQuery({ queryKey: USERS_KEY, queryFn: () => fetchUsers(fetchWithAuth), staleTime: 30_000 });
  const rolesQuery = useQuery({ queryKey: ROLES_KEY, queryFn: () => fetchRoles(fetchWithAuth), staleTime: 60_000 });
  const users = usersQuery.data || [];
  const roles = rolesQuery.data || [];
  const selfId = String(currentUser?.id || currentUser?._id || "");
  const isSelf = (u) => String(u.id) === selfId;

  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(visibleColumns));
    } catch {
      /* preference just won't persist */
    }
  }, [visibleColumns]);

  useEffect(() => setSelected(new Set()), [view, search, roleFilter, signInFilter]);

  const viewCounts = useMemo(
    () => ({ all: users.length, admins: users.filter((u) => u.isAdmin).length, never: users.filter(neverSignedIn).length }),
    [users]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (view === "admins" && !u.isAdmin) return false;
      if (view === "never" && !neverSignedIn(u)) return false;
      if (term && !u.name.toLowerCase().includes(term) && !u.email.toLowerCase().includes(term)) return false;
      if (roleFilter === "admin" && !u.isAdmin) return false;
      if (roleFilter && roleFilter !== "admin" && !u.roles.some((role) => role.id === roleFilter)) return false;
      if (signInFilter && !SIGN_IN_FILTERS[signInFilter](u)) return false;
      return true;
    });
  }, [users, view, search, roleFilter, signInFilter]);

  const selectedUsers = users.filter((u) => selected.has(u.id));
  const drawerUser = users.find((u) => u.id === drawer.id) || null;
  const hasFilters = Boolean(search || roleFilter || signInFilter || view !== "all");

  function clearFilters() {
    setView("all");
    setSearch("");
    setRoleFilter(null);
    setSignInFilter(null);
  }

  async function signOut(user) {
    try {
      await signOutEverywhere(fetchWithAuth, user.id);
      toast.success(`${user.name} was signed out everywhere`);
      usersQuery.refetch();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function bulkSignOut() {
    let failed = 0;
    for (const user of selectedUsers) {
      try {
        await signOutEverywhere(fetchWithAuth, user.id);
      } catch {
        failed += 1;
      }
    }
    if (failed) toast.error(`${failed} of ${selectedUsers.length} could not be signed out`);
    else toast.success(`${selectedUsers.length} ${selectedUsers.length === 1 ? "user" : "users"} signed out`);
    setSelected(new Set());
    usersQuery.refetch();
  }

  const columns = [
    {
      id: "name",
      header: "User",
      sortValue: (u) => u.name,
      cell: (u) => <EntityCell avatar name={u.name} title={u.name} subtitle={u.email} suffix={isSelf(u) ? "(you)" : null} />,
    },
    { id: "role", header: "Access", cell: (u) => <RoleBadges user={u} /> },
    {
      id: "lastLogin",
      header: "Last sign-in",
      sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null),
      className: "whitespace-nowrap text-ink-muted",
      cell: (u) => <span title={formatDateTime(u.lastLoginAt)}>{timeAgo(u.lastLoginAt)}</span>,
    },
    { id: "sessions", header: "Sessions", sortValue: (u) => u.activeSessions, className: "text-ink-muted", cell: (u) => u.activeSessions },
    {
      id: "created",
      header: "Created",
      hideBelow: "lg",
      sortValue: (u) => (u.createdAt ? new Date(u.createdAt).getTime() : null),
      className: "whitespace-nowrap text-ink-muted",
      cell: (u) => timeAgo(u.createdAt, "—"),
    },
  ].filter((column) => column.id === "name" || visibleColumns.includes(column.id));

  const rowActions = (u) => (
    <>
      <Tooltip content="Edit">
        <Button variant="ghost" size="sm" icon aria-label={`Edit ${u.name}`} onClick={() => setDrawer({ id: u.id, tab: "edit" })}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="Reset password">
        <Button variant="ghost" size="sm" icon aria-label={`Reset password for ${u.name}`} onClick={() => setResetting(u)}>
          <KeyRound className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" icon aria-label={`More actions for ${u.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={LogOut} disabled={u.activeSessions === 0} onSelect={() => signOut(u)}>
            Sign out everywhere
          </MenuItem>
          {!isSelf(u) ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setDeleting([u])}>
                Delete user
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>
    </>
  );

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to the workspace, and what they can access."
        actions={
          <Button as={Link} to="/admin/users/new" variant="primary">
            <UserPlus className="h-4 w-4" /> New user
          </Button>
        }
      />

      <Tabs
        idBase="users-views"
        label="User views"
        variant="segmented"
        value={view}
        onValueChange={setView}
        className="self-start"
        items={[
          { value: "all", label: "All users", count: usersQuery.isSuccess ? viewCounts.all : undefined },
          { value: "admins", label: "Admins", count: usersQuery.isSuccess ? viewCounts.admins : undefined },
          { value: "never", label: "Never signed in", count: usersQuery.isSuccess ? viewCounts.never : undefined },
        ]}
      />

      {selected.size > 0 ? (
        <div role="region" aria-label="Bulk actions" className="flex h-8 items-center gap-2 rounded-ds border border-brand-softline bg-brand-soft pl-3 pr-1">
          <span className="text-body-sm font-medium text-brand-ink" aria-live="polite">
            {selected.size} selected
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" onClick={bulkSignOut}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
            <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(selectedUsers)} disabled={selectedUsers.every(isSelf)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            <Button size="sm" variant="ghost" icon aria-label="Clear selection" onClick={() => setSelected(new Set())}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or email" aria-label="Search users" className="w-full sm:w-64" />
          <FilterChip
            label="Access"
            value={roleFilter}
            onChange={setRoleFilter}
            anyLabel="Any access"
            options={[{ value: "admin", label: "Admin" }, ...roles.map((role) => ({ value: role._id, label: role.name }))]}
          />
          <FilterChip
            label="Sign-in"
            value={signInFilter}
            onChange={setSignInFilter}
            anyLabel="Any time"
            options={[
              { value: "active7", label: "Last 7 days" },
              { value: "inactive30", label: "Inactive 30+ days" },
              { value: "never", label: "Never" },
            ]}
          />
          {hasFilters ? (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
          <div className="ml-auto hidden md:block">
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm">
                  <Columns3 className="h-3.5 w-3.5" /> Columns
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Show columns</MenuLabel>
                {OPTIONAL_COLUMNS.map((column) => (
                  <MenuCheckboxItem
                    key={column.id}
                    checked={visibleColumns.includes(column.id)}
                    onCheckedChange={(checked) => setVisibleColumns((current) => (checked ? [...current, column.id] : current.filter((id) => id !== column.id)))}
                  >
                    {column.label}
                  </MenuCheckboxItem>
                ))}
              </MenuContent>
            </Menu>
          </div>
        </div>
      )}

      <DataTable
        label="Users"
        columns={columns}
        rows={filtered}
        getRowId={(u) => u.id}
        loading={usersQuery.isPending}
        error={usersQuery.isError ? usersQuery.error : null}
        onRetry={() => usersQuery.refetch()}
        onRowClick={(u) => setDrawer({ id: u.id, tab: "overview" })}
        selected={selected}
        onSelectedChange={setSelected}
        rowActions={rowActions}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={`${view}|${search}|${roleFilter}|${signInFilter}`}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={hasFilters ? "No users match your filters" : "No users yet"}
            description={hasFilters ? "Try a different search or clear the filters." : "Invite your first team member to get started."}
            action={hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : <Button as={Link} to="/admin/users/new" variant="primary">New user</Button>}
          />
        }
      />

      <UserDrawer
        user={drawerUser}
        isSelf={drawerUser ? isSelf(drawerUser) : false}
        roles={roles}
        initialTab={drawer.tab}
        open={Boolean(drawerUser)}
        onOpenChange={(open) => !open && setDrawer({ id: null, tab: "overview" })}
        onChanged={() => usersQuery.refetch()}
        onResetPassword={setResetting}
        onDelete={(u) => setDeleting([u])}
      />
      <ResetPasswordDialog user={resetting} open={Boolean(resetting)} onOpenChange={(open) => !open && setResetting(null)} />
      <DeleteUsersDialog
        users={(deleting || []).filter((u) => !isSelf(u))}
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDone={() => {
          setSelected(new Set());
          setDrawer({ id: null, tab: "overview" });
          usersQuery.refetch();
        }}
      />
    </Page>
  );
}
