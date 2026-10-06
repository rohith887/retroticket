import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Dialog, DialogContent, Field, Input, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { deleteUser, resetPassword } from "./api";

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function ResetPasswordDialog({ user, open, onOpenChange }) {
  const { fetchWithAuth } = useUser();
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setReveal(false);
    }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await resetPassword(fetchWithAuth, user.id, password);
      toast.success(`Password reset for ${user.email}. Their sessions were signed out.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      toast.info("Password copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent
        title="Reset password"
        description={user ? `Set a new password for ${user.email}. They will be signed out everywhere.` : ""}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="reset-password-form" loading={busy} disabled={password.length < 8}>
              Reset password
            </Button>
          </>
        }
      >
        <form id="reset-password-form" onSubmit={submit} className="space-y-2">
          <Field label="New password" hint="At least 8 characters." required>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPassword(generatePassword());
                setReveal(true);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Generate
            </Button>
            {password ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}>
                  {reveal ? "Hide" : "Show"}
                </Button>
                <Button size="sm" variant="ghost" onClick={copy}>
                  Copy
                </Button>
              </>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms deleting one or many users. `users` is the list to delete (self is never deletable). */
export function DeleteUsersDialog({ users, open, onOpenChange, onDone }) {
  const { fetchWithAuth } = useUser();
  const [busy, setBusy] = useState(false);
  const list = users || [];
  const single = list.length === 1;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    let failed = 0;
    for (const user of list) {
      try {
        await deleteUser(fetchWithAuth, user.id);
      } catch (error) {
        failed += 1;
        toast.error(`${user.email}: ${error.message}`);
      }
    }
    setBusy(false);
    if (failed < list.length) toast.success(single ? "User deleted" : `${list.length - failed} users deleted`);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent
        size="sm"
        title={single ? "Delete user?" : `Delete ${list.length} users?`}
        description={
          single
            ? `${list[0]?.name} (${list[0]?.email}) will lose access immediately and their notes and notifications will be removed. This cannot be undone.`
            : "These users lose access immediately and their notes and notifications are removed. This cannot be undone."
        }
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" form="delete-users-form" loading={busy}>
              {single ? "Delete user" : `Delete ${list.length} users`}
            </Button>
          </>
        }
      >
        <form id="delete-users-form" onSubmit={submit} />
        {!single ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-body-sm text-ink-muted">
            {list.map((user) => (
              <li key={user.id} className="truncate">
                {user.name} · {user.email}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
