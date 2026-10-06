import React, { useEffect, useState } from "react";
import { KeyRound, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar, Badge, Button, Checkbox, Detail, Drawer, DrawerContent, Field, Input, TabPanel, Tabs, ToggleChip, toast } from "../../../ui";
import { formatDateTime, timeAgo } from "../../../ui/time";
import { useUser } from "../../../store/session";
import { signOutEverywhere, updateUser } from "./api";

export function RoleBadges({ user }) {
  const items = [];
  if (user.isAdmin) {
    items.push(
      <Badge key="admin" tone="brand">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Admin
      </Badge>
    );
  }
  user.roles.forEach((role) => items.push(<Badge key={role.id}>{role.name}</Badge>));
  if (items.length === 0) return <span className="text-caption text-ink-faint">No role</span>;
  return <div className="flex flex-wrap gap-1">{items}</div>;
}

/** Right-hand detail panel: overview and inline edit, with account actions in the footer. */
export function UserDrawer({ user, isSelf, roles, initialTab, open, onOpenChange, onChanged, onResetPassword, onDelete }) {
  const { fetchWithAuth } = useUser();
  const [tab, setTab] = useState("overview");
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [roleIds, setRoleIds] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && user) {
      setTab(initialTab || "overview");
      setName(user.name);
      setAdmin(user.isAdmin);
      setRoleIds(user.roles.map((role) => role.id));
    }
  }, [open, user?.id, initialTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    user &&
    (name.trim() !== user.name ||
      admin !== user.isAdmin ||
      [...roleIds].sort().join() !== user.roles.map((role) => role.id).sort().join());

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateUser(fetchWithAuth, user.id, { name, admin, roleIds });
      toast.success("User updated");
      onChanged();
      setTab("overview");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await signOutEverywhere(fetchWithAuth, user.id);
      toast.success(`${user.name} was signed out everywhere`);
      onChanged();
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {user ? (
        <DrawerContent
          title={user.name}
          description={user.email}
          header={
            <div className="flex items-center gap-3">
              <Avatar name={user.name} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-title font-semibold text-ink">
                  {user.name}
                  {isSelf ? <span className="ml-2 text-caption font-normal text-ink-faint">(you)</span> : null}
                </div>
                <div className="truncate text-body-sm text-ink-muted">{user.email}</div>
              </div>
            </div>
          }
          footer={
            <>
              <Button size="sm" onClick={() => onResetPassword(user)}>
                <KeyRound className="h-3.5 w-3.5" /> Reset password
              </Button>
              <Button size="sm" onClick={signOut} disabled={user.activeSessions === 0}>
                <LogOut className="h-3.5 w-3.5" /> Sign out everywhere
              </Button>
              {!isSelf ? (
                <Button size="sm" variant="danger-ghost" onClick={() => onDelete(user)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              ) : null}
            </>
          }
        >
          <div className="px-4 pt-2">
            <Tabs
              idBase="user-drawer"
              label="User details"
              value={tab}
              onValueChange={setTab}
              items={[
                { value: "overview", label: "Overview" },
                { value: "edit", label: "Edit" },
              ]}
            />
          </div>

          <TabPanel idBase="user-drawer" value="overview" active={tab === "overview"} className="px-4 py-2">
            <dl className="divide-y divide-line">
              <Detail label="Access">
                <RoleBadges user={user} />
              </Detail>
              <Detail label="Last sign-in">
                <span title={formatDateTime(user.lastLoginAt)}>{timeAgo(user.lastLoginAt)}</span>
              </Detail>
              <Detail label="Active sessions">{user.activeSessions}</Detail>
              <Detail label="Created">{formatDateTime(user.createdAt) || "—"}</Detail>
            </dl>
          </TabPanel>

          <TabPanel idBase="user-drawer" value="edit" active={tab === "edit"} className="px-4 py-4">
            <form onSubmit={save} className="space-y-5">
              <Field label="Name" required>
                {(fieldProps) => <Input {...fieldProps} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={busy} />}
              </Field>

              <label className="flex items-start gap-3 rounded-ds-lg border border-line p-3">
                <Checkbox checked={admin} onChange={(e) => setAdmin(e.target.checked)} disabled={busy || (isSelf && user.isAdmin)} label="Administrator" className="mt-0.5" />
                <span>
                  <span className="block text-body-sm font-medium text-ink">Administrator</span>
                  <span className="block text-caption text-ink-faint">
                    {isSelf && user.isAdmin ? "You cannot remove your own admin access." : "Full access to every setting and record."}
                  </span>
                </span>
              </label>

              <div>
                <div className="mb-1.5 text-body-sm font-medium text-ink">Roles</div>
                {roles.length === 0 ? (
                  <p className="text-body-sm text-ink-muted">No roles have been created yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {roles.map((role) => (
                      <ToggleChip
                        key={role._id}
                        pressed={roleIds.includes(role._id)}
                        disabled={busy}
                        onClick={() => setRoleIds((current) => (current.includes(role._id) ? current.filter((id) => id !== role._id) : [...current, role._id]))}
                      >
                        {role.name}
                      </ToggleChip>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setTab("overview")} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" loading={busy} disabled={!dirty || !name.trim()}>
                  Save changes
                </Button>
              </div>
            </form>
          </TabPanel>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}
