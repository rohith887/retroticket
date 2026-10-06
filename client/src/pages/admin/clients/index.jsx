// Admin > Clients. List-page pattern: PageHeader, search, DataTable, edit drawer, delete confirmation.
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useUser } from "../../../store/session";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  DrawerContent,
  EmptyState,
  EntityCell,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Page,
  PageHeader,
  SearchInput,
  Tooltip,
  toast,
} from "../../../ui";
import { CLIENTS_KEY, deleteClient, fetchClients, updateClient } from "./api";
import { ClientFields, isClientValid } from "./ClientFields";

function ClientDrawer({ client, open, onOpenChange, onSaved, onDelete }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && client) setForm({ name: client.name, email: client.email, contactName: client.contactName || "", number: client.number || "" });
  }, [open, client?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = client && form && (form.name !== client.name || form.email !== client.email || form.contactName !== (client.contactName || "") || String(form.number) !== String(client.number || ""));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateClient(fetchWithAuth, client._id, form);
      toast.success("Client updated");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {client && form ? (
        <DrawerContent
          title={client.name}
          description={client.email}
          footer={
            <>
              <Button variant="danger-ghost" size="sm" className="mr-auto" onClick={() => onDelete(client)} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
              <Button onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="client-edit-form" loading={busy} disabled={!dirty || !isClientValid(form)}>
                Save changes
              </Button>
            </>
          }
        >
          <form id="client-edit-form" onSubmit={save} className="p-4">
            <ClientFields value={form} onChange={setForm} disabled={busy} />
          </form>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

export default function Clients() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useQuery({ queryKey: CLIENTS_KEY, queryFn: () => fetchClients(fetchWithAuth), staleTime: 30_000 });
  const clients = query.data || [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) => [c.name, c.email, c.contactName, c.number].some((v) => String(v || "").toLowerCase().includes(term)));
  }, [clients, search]);

  const openClient = clients.find((c) => c._id === openId) || null;

  const columns = [
    { id: "name", header: "Client", sortValue: (c) => c.name, cell: (c) => <EntityCell title={c.name} subtitle={c.email} /> },
    { id: "contact", header: "Primary contact", sortValue: (c) => c.contactName, cell: (c) => c.contactName || "—" },
    { id: "number", header: "Contact number", hideBelow: "lg", className: "whitespace-nowrap text-ink-muted", cell: (c) => c.number || "—" },
  ];

  return (
    <Page>
      <PageHeader
        title="Clients"
        description="Client organisations and their primary contacts."
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button>
                  <ExternalLink className="h-3.5 w-3.5" /> Portal links
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => navigate("/submit")}>Guest ticket URL</MenuItem>
                <MenuItem onSelect={() => navigate("/portal/")}>Portal URL</MenuItem>
                <MenuItem onSelect={() => navigate("/auth/register")}>Portal register</MenuItem>
              </MenuContent>
            </Menu>
            <Button as={Link} to="/admin/clients/new" variant="primary">
              <Plus className="h-4 w-4" /> New client
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients" aria-label="Search clients" className="w-full sm:w-64" />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "client" : "clients"}` : ""}</span>
      </div>

      <DataTable
        label="Clients"
        columns={columns}
        rows={filtered}
        getRowId={(c) => c._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(c) => setOpenId(c._id)}
        initialSort={{ id: "name", dir: "asc" }}
        resetKey={search}
        rowActions={(c) => (
          <>
            <Tooltip content="Edit">
              <Button variant="ghost" size="sm" icon aria-label={`Edit ${c.name}`} onClick={() => setOpenId(c._id)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Delete">
              <Button variant="danger-ghost" size="sm" icon aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </>
        )}
        empty={
          <EmptyState
            icon={Building2}
            title={search ? "No clients match your search" : "No clients yet"}
            description={search ? "Try a different search." : "Register a client to link it to tickets."}
            action={search ? <Button onClick={() => setSearch("")}>Clear search</Button> : <Button as={Link} to="/admin/clients/new" variant="primary">New client</Button>}
          />
        }
      />

      <ClientDrawer client={openClient} open={Boolean(openClient)} onOpenChange={(open) => !open && setOpenId(null)} onSaved={() => query.refetch()} onDelete={setDeleting} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete client?"
        description={deleting ? `${deleting.name} will be removed. Tickets already linked to it keep their history. This cannot be undone.` : ""}
        confirmLabel="Delete client"
        onConfirm={async () => {
          await deleteClient(fetchWithAuth, deleting._id);
          toast.success("Client deleted");
          setOpenId(null);
          query.refetch();
        }}
      />
    </Page>
  );
}
