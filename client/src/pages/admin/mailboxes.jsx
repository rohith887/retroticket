// Admin > Mailboxes. Shared inboxes that threads can be assigned to.
// API unchanged: GET /v1/mailboxes, POST /v1/mailboxes (there is no update/delete endpoint).
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mailbox as MailboxIcon, Plus } from "lucide-react";
import { useUser } from "../../store/session";
import { Badge, Button, DataTable, Detail, Dialog, DialogContent, Drawer, DrawerContent, EmptyState, EntityCell, Field, Input, Page, PageHeader, SearchInput, Textarea, toast } from "../../ui";

const MAILBOXES_KEY = ["adminMailboxes"];
const EMPTY = { name: "", emailAddress: "", slug: "", description: "" };

async function fetchMailboxes(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/mailboxes");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "Failed to fetch mailboxes");
  return Array.isArray(data.mailboxes) ? data.mailboxes : [];
}

function NewMailboxDialog({ open, onOpenChange, onCreated }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((current) => ({ ...current, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithAuth("/v1/mailboxes", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          emailAddress: form.emailAddress.trim(),
          slug: form.slug.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || "Failed to save mailbox");
      toast.success("Mailbox created");
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
        title="New mailbox"
        description="Create a shared inbox that threads can be assigned to."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="new-mailbox-form" loading={busy} disabled={!form.name.trim() || !form.emailAddress.trim()}>
              Create mailbox
            </Button>
          </>
        }
      >
        <form id="new-mailbox-form" onSubmit={submit} className="space-y-4">
          <Field label="Name" required>
            {(f) => <Input {...f} value={form.name} onChange={set("name")} placeholder="Support inbox" disabled={busy} required />}
          </Field>
          <Field label="Email address" required>
            {(f) => <Input {...f} type="email" value={form.emailAddress} onChange={set("emailAddress")} placeholder="support@example.com" disabled={busy} required />}
          </Field>
          <Field label="Slug" hint="Optional short name used in URLs.">
            {(f) => <Input {...f} value={form.slug} onChange={set("slug")} placeholder="support" disabled={busy} />}
          </Field>
          <Field label="Description">
            {(f) => <Textarea {...f} value={form.description} onChange={set("description")} placeholder="Shared mailbox for customer communication" disabled={busy} rows={3} />}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminMailboxes() {
  const { fetchWithAuth } = useUser();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const query = useQuery({ queryKey: MAILBOXES_KEY, queryFn: () => fetchMailboxes(fetchWithAuth), staleTime: 30_000 });
  const mailboxes = query.data || [];
  const openMailbox = mailboxes.find((m) => m._id === openId) || null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? mailboxes.filter((m) => [m.name, m.emailAddress, m.slug].some((v) => String(v || "").toLowerCase().includes(term))) : mailboxes;
  }, [mailboxes, search]);

  const statusBadge = (m) => <Badge tone={m.isActive ? "success" : "neutral"} dot>{m.isActive ? "Active" : "Inactive"}</Badge>;

  const columns = [
    { id: "name", header: "Mailbox", sortValue: (m) => m.name, cell: (m) => <EntityCell title={m.name} subtitle={m.emailAddress} /> },
    { id: "slug", header: "Slug", hideBelow: "lg", className: "text-ink-muted", sortValue: (m) => m.slug, cell: (m) => m.slug || "—" },
    { id: "queue", header: "Email queue", hideBelow: "lg", className: "text-ink-muted", cell: (m) => m.emailQueueId?.name || "Not linked" },
    { id: "shared", header: "Shared", className: "text-ink-muted", cell: (m) => (m.isShared ? "Yes" : "No") },
    { id: "status", header: "Status", sortValue: (m) => (m.isActive ? 0 : 1), cell: statusBadge },
  ];

  return (
    <Page>
      <PageHeader
        title="Mailboxes"
        description="Shared inboxes that threads can be assigned to."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New mailbox
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search mailboxes" aria-label="Search mailboxes" className="w-full sm:w-64" />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "mailbox" : "mailboxes"}` : ""}</span>
      </div>

      <DataTable
        label="Mailboxes"
        columns={columns}
        rows={filtered}
        getRowId={(m) => m._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(m) => setOpenId(m._id)}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={search}
        empty={
          <EmptyState
            icon={MailboxIcon}
            title={search ? "No mailboxes match your search" : "No mailboxes yet"}
            description={search ? "Try a different search." : "Create a shared inbox to route email conversations to."}
            action={search ? <Button onClick={() => setSearch("")}>Clear search</Button> : <Button variant="primary" onClick={() => setCreating(true)}>New mailbox</Button>}
          />
        }
      />

      <Drawer open={Boolean(openMailbox)} onOpenChange={(open) => !open && setOpenId(null)}>
        {openMailbox ? (
          <DrawerContent title={openMailbox.name} description={openMailbox.emailAddress}>
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Status">{statusBadge(openMailbox)}</Detail>
              <Detail label="Slug">{openMailbox.slug || "—"}</Detail>
              <Detail label="Shared">{openMailbox.isShared ? "Yes" : "No"}</Detail>
              <Detail label="Email queue">{openMailbox.emailQueueId ? `${openMailbox.emailQueueId.name} (${openMailbox.emailQueueId.active ? "active" : "inactive"})` : "Not linked"}</Detail>
              <Detail label="Description">{openMailbox.description || "—"}</Detail>
            </dl>
          </DrawerContent>
        ) : null}
      </Drawer>

      <NewMailboxDialog open={creating} onOpenChange={setCreating} onCreated={() => query.refetch()} />
    </Page>
  );
}
