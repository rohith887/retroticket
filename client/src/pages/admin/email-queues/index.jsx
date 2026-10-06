// Admin > Email queues. List page with a read-only detail drawer and delete confirmation.
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Plus, Trash2 } from "lucide-react";
import { useUser } from "../../../store/session";
import { Badge, Button, ConfirmDialog, DataTable, Detail, Drawer, DrawerContent, EmptyState, EntityCell, Page, PageHeader, SearchInput, Tooltip, toast } from "../../../ui";
import { deleteQueue, fetchQueues, QUEUES_KEY } from "./api";

const typeLabel = (queue) => (queue.serviceType === "gmail" ? "Google (OAuth)" : "IMAP / SMTP");

export default function EmailQueuesList() {
  const { fetchWithAuth } = useUser();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useQuery({ queryKey: QUEUES_KEY, queryFn: () => fetchQueues(fetchWithAuth), staleTime: 30_000 });
  const queues = query.data || [];
  const openQueue = queues.find((q) => q._id === openId) || null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? queues.filter((q) => [q.name, q.username, q.hostname].some((v) => String(v || "").toLowerCase().includes(term))) : queues;
  }, [queues, search]);

  const columns = [
    { id: "name", header: "Queue", sortValue: (q) => q.name, cell: (q) => <EntityCell title={q.name} subtitle={q.username} /> },
    { id: "host", header: "Server", hideBelow: "lg", sortValue: (q) => q.hostname, className: "text-ink-muted", cell: (q) => q.hostname || "—" },
    { id: "type", header: "Type", className: "whitespace-nowrap text-ink-muted", cell: (q) => typeLabel(q) },
    { id: "tls", header: "Security", cell: (q) => <Badge tone={q.tls ? "success" : "warning"}>{q.tls ? "TLS" : "No TLS"}</Badge> },
    { id: "status", header: "Status", sortValue: (q) => (q.active ? 0 : 1), cell: (q) => <Badge tone={q.active ? "success" : "neutral"} dot>{q.active ? "Active" : "Inactive"}</Badge> },
  ];

  const remove = async () => {
    await deleteQueue(fetchWithAuth, deleting._id);
    toast.success("Email queue deleted");
    setOpenId(null);
    query.refetch();
  };

  return (
    <Page>
      <PageHeader
        title="Email queues"
        description="Mail accounts the system reads from and sends through."
        actions={
          <Button as={Link} to="/admin/email-queues/new" variant="primary">
            <Plus className="h-4 w-4" /> New queue
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search queues" aria-label="Search email queues" className="w-full sm:w-64" />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "queue" : "queues"}` : ""}</span>
      </div>

      <DataTable
        label="Email queues"
        columns={columns}
        rows={filtered}
        getRowId={(q) => q._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(q) => setOpenId(q._id)}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={search}
        rowActions={(q) => (
          <Tooltip content="Delete">
            <Button variant="danger-ghost" size="sm" icon aria-label={`Delete ${q.name}`} onClick={() => setDeleting(q)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
        empty={
          <EmptyState
            icon={Inbox}
            title={search ? "No queues match your search" : "No email queues yet"}
            description={search ? "Try a different search." : "Connect a mail account to start receiving email as tickets."}
            action={search ? <Button onClick={() => setSearch("")}>Clear search</Button> : <Button as={Link} to="/admin/email-queues/new" variant="primary">New queue</Button>}
          />
        }
      />

      <Drawer open={Boolean(openQueue)} onOpenChange={(open) => !open && setOpenId(null)}>
        {openQueue ? (
          <DrawerContent
            title={openQueue.name}
            description={openQueue.username}
            footer={
              <Button variant="danger-ghost" size="sm" onClick={() => setDeleting(openQueue)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete queue
              </Button>
            }
          >
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Status">
                <Badge tone={openQueue.active ? "success" : "neutral"} dot>{openQueue.active ? "Active" : "Inactive"}</Badge>
              </Detail>
              <Detail label="Type">{typeLabel(openQueue)}</Detail>
              <Detail label="Account">{openQueue.username}</Detail>
              <Detail label="Hostname">{openQueue.hostname || "—"}</Detail>
              <Detail label="IMAP port">{openQueue.imapPort ?? "—"}</Detail>
              <Detail label="SMTP port">{openQueue.smtpPort ?? "—"}</Detail>
              <Detail label="Security">{openQueue.tls ? "TLS" : "None"}</Detail>
            </dl>
          </DrawerContent>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete email queue?"
        description={deleting ? `${deleting.name} will stop receiving and sending mail. Existing tickets and messages are kept. This cannot be undone.` : ""}
        confirmLabel="Delete queue"
        onConfirm={remove}
      />
    </Page>
  );
}
