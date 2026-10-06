import React, { useEffect, useState } from "react";
import { Button, Section, Switch, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { updateNotifications } from "./api";

const OPTIONS = [
  { key: "notify_ticket_created", userKey: "ticket_created", label: "New tickets", description: "Email me when a ticket is created." },
  { key: "notify_ticket_assigned", userKey: "ticket_assigned", label: "Assignments", description: "Email me when a ticket is assigned to me." },
  { key: "notify_ticket_comments", userKey: "ticket_comments", label: "Comments", description: "Email me when someone comments on a ticket I follow." },
  { key: "notify_ticket_status_changed", userKey: "ticket_status_changed", label: "Status changes", description: "Email me when a ticket I follow changes status." },
];

const read = (user) => Object.fromEntries(OPTIONS.map((o) => [o.key, user?.[o.userKey] !== false]));

export default function NotificationSettings() {
  const { user, fetchWithAuth, refreshSession } = useUser();
  const [prefs, setPrefs] = useState(() => read(user));
  const [busy, setBusy] = useState(false);

  useEffect(() => setPrefs(read(user)), [user]);

  const saved = read(user);
  const dirty = OPTIONS.some((o) => prefs[o.key] !== saved[o.key]);

  async function save() {
    setBusy(true);
    try {
      await updateNotifications(fetchWithAuth, prefs);
      await refreshSession();
      toast.success("Notification settings saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Email notifications"
      description="Choose which ticket events are sent to your email."
      actions={
        <Button variant="primary" size="sm" onClick={save} loading={busy} disabled={!dirty}>
          Save changes
        </Button>
      }
    >
      <ul className="-my-2 divide-y divide-line">
        {OPTIONS.map((option) => (
          <li key={option.key} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <label htmlFor={option.key} className="block text-body-sm font-medium text-ink">
                {option.label}
              </label>
              <p className="text-caption text-ink-muted">{option.description}</p>
            </div>
            <Switch id={option.key} checked={prefs[option.key]} onCheckedChange={(value) => setPrefs((c) => ({ ...c, [option.key]: value }))} disabled={busy} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
