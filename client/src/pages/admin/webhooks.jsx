// Admin > Webhooks. Outbound event hooks.
// API: GET /v1/webhook/all, POST /v1/webhook/create, DELETE /v1/webhook/:id/delete.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useUser } from "../../store/session";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Detail,
  Dialog,
  DialogContent,
  Drawer,
  DrawerContent,
  EmptyState,
  EntityCell,
  Field,
  Input,
  Page,
  PageHeader,
  PasswordInput,
  SearchInput,
  Select,
  Switch,
  Tooltip,
  toast,
} from "../../ui";
import { timeAgo } from "../../ui/time";

const HOOKS_KEY = ["adminWebhooks"];
const EVENT_TYPES = [
  { value: "ticket_created", label: "Ticket created" },
  { value: "ticket_status_changed", label: "Ticket status changed" },
];
const eventLabel = (type) => EVENT_TYPES.find((t) => t.value === type)?.label || type;
const EMPTY = { name: "", url: "", type: "ticket_created", secret: "", active: true };

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

async function fetchHooks(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/webhook/all");
  if (!res.ok) throw new Error(await readError(res, `Could not load webhooks (${res.status})`));
  const data = await res.json();
  if (data.success === false) throw new Error(data.message || "Could not load webhooks");
  return data.webhooks || [];
}

function NewWebhookDialog({ open, onOpenChange, onCreated }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithAuth("/v1/webhook/create", {
        method: "POST",
        body: JSON.stringify({ name: form.name.trim(), active: form.active, url: form.url.trim(), type: form.type, secret: form.secret }),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add webhook"));
      const data = await res.json();
      if (data.success === false) throw new Error(data.message || "Failed to add webhook");
      toast.success("Webhook added");
      setForm(EMPTY);
      onCreated();
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent
        title="New webhook"
        description="Send an HTTP request to a URL whenever the chosen event happens."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="new-webhook-form" loading={busy} disabled={!form.name.trim() || !form.url.trim()}>
              Add webhook
            </Button>
          </>
        }
      >
        <form id="new-webhook-form" onSubmit={submit} className="space-y-4">
          <Field label="Name" required>{(f) => <Input {...f} value={form.name} onChange={set("name")} placeholder="Notify Slack" disabled={busy} required />}</Field>
          <Field label="URL" required>{(f) => <Input {...f} type="url" value={form.url} onChange={set("url")} placeholder="https://hooks.example.com/…" disabled={busy} required />}</Field>
          <Field label="Event">
            {(f) => (
              <Select {...f} value={form.type} onChange={set("type")} disabled={busy}>
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Secret" hint="Optional. Sent with the request so the receiver can verify it.">
            {(f) => <PasswordInput {...f} value={form.secret} onChange={set("secret")} autoComplete="off" disabled={busy} />}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="new-webhook-active" className="text-body-sm font-medium text-ink">
              Enabled
            </label>
            <Switch id="new-webhook-active" checked={form.active} onCheckedChange={(active) => setForm((c) => ({ ...c, active }))} disabled={busy} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Webhooks() {
  const { fetchWithAuth } = useUser();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useQuery({ queryKey: HOOKS_KEY, queryFn: () => fetchHooks(fetchWithAuth), staleTime: 30_000 });
  const hooks = query.data || [];
  const openHook = hooks.find((h) => h._id === openId) || null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? hooks.filter((h) => [h.name, h.url, h.type].some((v) => String(v || "").toLowerCase().includes(term))) : hooks;
  }, [hooks, search]);

  const columns = [
    { id: "name", header: "Webhook", sortValue: (h) => h.name, cell: (h) => <EntityCell title={h.name} subtitle={h.url} /> },
    { id: "type", header: "Event", sortValue: (h) => h.type, cell: (h) => <Badge>{eventLabel(h.type)}</Badge> },
    { id: "created", header: "Added", hideBelow: "lg", className: "whitespace-nowrap text-ink-muted", sortValue: (h) => (h.createdAt ? new Date(h.createdAt).getTime() : 0), cell: (h) => timeAgo(h.createdAt, "—") },
    { id: "status", header: "Status", sortValue: (h) => (h.active ? 0 : 1), cell: (h) => <Badge tone={h.active ? "success" : "neutral"} dot>{h.active ? "Enabled" : "Disabled"}</Badge> },
  ];

  const remove = async () => {
    const res = await fetchWithAuth(`/v1/webhook/${deleting._id}/delete`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res, "Failed to delete webhook"));
    toast.success("Webhook deleted");
    setOpenId(null);
    query.refetch();
  };

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        description="Notify other systems when tickets are created or change status."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New webhook
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search webhooks" aria-label="Search webhooks" className="w-full sm:w-64" />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "webhook" : "webhooks"}` : ""}</span>
      </div>

      <DataTable
        label="Webhooks"
        columns={columns}
        rows={filtered}
        getRowId={(h) => h._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(h) => setOpenId(h._id)}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={search}
        rowActions={(h) => (
          <Tooltip content="Delete">
            <Button variant="danger-ghost" size="sm" icon aria-label={`Delete ${h.name}`} onClick={() => setDeleting(h)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
        empty={
          <EmptyState
            icon={WebhookIcon}
            title={search ? "No webhooks match your search" : "No webhooks yet"}
            description={search ? "Try a different search." : "Add a webhook to push ticket events to another system."}
            action={search ? <Button onClick={() => setSearch("")}>Clear search</Button> : <Button variant="primary" onClick={() => setCreating(true)}>New webhook</Button>}
          />
        }
      />

      <Drawer open={Boolean(openHook)} onOpenChange={(open) => !open && setOpenId(null)}>
        {openHook ? (
          <DrawerContent
            title={openHook.name}
            description={eventLabel(openHook.type)}
            footer={
              <Button variant="danger-ghost" size="sm" onClick={() => setDeleting(openHook)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete webhook
              </Button>
            }
          >
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Status"><Badge tone={openHook.active ? "success" : "neutral"} dot>{openHook.active ? "Enabled" : "Disabled"}</Badge></Detail>
              <Detail label="Event">{eventLabel(openHook.type)}</Detail>
              <Detail label="URL">{openHook.url}</Detail>
              <Detail label="Secret">{openHook.secret ? "Set" : "Not set"}</Detail>
            </dl>
          </DrawerContent>
        ) : null}
      </Drawer>

      <NewWebhookDialog open={creating} onOpenChange={setCreating} onCreated={() => query.refetch()} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete webhook?"
        description={deleting ? `${deleting.name} will stop receiving events. This cannot be undone.` : ""}
        confirmLabel="Delete webhook"
        onConfirm={remove}
      />
    </Page>
  );
}
