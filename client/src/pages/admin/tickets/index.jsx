// Admin > Tickets. List-page pattern: PageHeader, search + filters, DataTable, read-only detail drawer.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ticket as TicketIcon } from "lucide-react";
import { useUser } from "../../../store/session";
import {
  Alert, Badge, Button, DataTable, Detail, Drawer, DrawerContent, EmptyState, EntityCell, Page, PageHeader, SearchInput, Select, Skeleton, ToggleChip,
} from "../../../ui";
import { formatDateTime, timeAgo } from "../../../ui/time";

const PRIORITY_TONE = { critical: "danger", high: "warning", medium: "brand", low: "neutral" };
const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const TICKETS_KEY = ["adminTickets"];

async function fetchTickets(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/ticket/tickets/all");
  if (!res.ok) throw new Error(`Could not load tickets (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Could not load tickets");
  return data.tickets || [];
}

async function fetchTicket(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/ticket/${id}`);
  if (!res.ok) throw new Error(`Could not load ticket (${res.status})`);
  return res.json();
}

const isOpen = (t) => !t.isComplete;
const statusOf = (t) => (t.isComplete ? "Closed" : t.status ? t.status.replace(/_/g, " ") : "open");
const clientName = (t) => t.clientId?.name || t.client?.name || t.clientName || "";

function PriorityBadge({ value }) {
  return <Badge tone={PRIORITY_TONE[value] || "neutral"}>{value ? value[0].toUpperCase() + value.slice(1) : "—"}</Badge>;
}

function TicketDrawer({ ticket, open, onOpenChange }) {
  const { fetchWithAuth } = useUser();
  const query = useQuery({ queryKey: ["adminTicket", ticket?._id], queryFn: () => fetchTicket(fetchWithAuth, ticket._id), enabled: open && Boolean(ticket) });
  const comments = query.data?.comments || [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {ticket ? (
        <DrawerContent title={ticket.title} description={`#${ticket.number}`} footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}>
          <div className="space-y-5 p-4">
            <dl className="divide-y divide-line">
              <Detail label="Status">
                <Badge tone={ticket.isComplete ? "success" : "brand"} dot>{statusOf(ticket)}</Badge>
              </Detail>
              <Detail label="Priority"><PriorityBadge value={ticket.priority} /></Detail>
              <Detail label="Assignee">{ticket.assignedTo?.name || "Unassigned"}</Detail>
              <Detail label="Requester">{ticket.name} {ticket.email ? `· ${ticket.email}` : ""}</Detail>
              {clientName(ticket) ? <Detail label="Client">{clientName(ticket)}</Detail> : null}
              <Detail label="Created">{formatDateTime(ticket.createdAt)}</Detail>
              <Detail label="Updated">{timeAgo(ticket.updatedAt)}</Detail>
            </dl>

            <section>
              <h3 className="mb-2 text-body-sm font-semibold text-ink">Description</h3>
              <p className="whitespace-pre-wrap text-body-sm text-ink-muted">{ticket.detail || "No description."}</p>
            </section>

            <section>
              <h3 className="mb-2 text-body-sm font-semibold text-ink">Comments</h3>
              {query.isError ? (
                <Alert tone="danger">{query.error.message}</Alert>
              ) : query.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : comments.length === 0 ? (
                <p className="text-body-sm text-ink-faint">No comments yet.</p>
              ) : (
                <ul className="space-y-3">
                  {comments.map((c) => (
                    <li key={c._id} className="rounded-ds border border-line p-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-caption text-ink-muted">
                        <span>{c.user?.name || c.userId?.name || "System"}</span>
                        <span className="flex items-center gap-2">
                          {c.public ? null : <Badge>Internal</Badge>}
                          {timeAgo(c.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-body-sm text-ink">{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

export default function AdminTickets() {
  const { fetchWithAuth } = useUser();
  const [search, setSearch] = useState("");
  const [view, setView] = useState("open");
  const [priority, setPriority] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [openId, setOpenId] = useState(null);

  const query = useQuery({ queryKey: TICKETS_KEY, queryFn: () => fetchTickets(fetchWithAuth), staleTime: 30_000, refetchInterval: 60_000 });
  const tickets = query.data || [];

  const assignees = useMemo(() => {
    const map = new Map();
    tickets.forEach((t) => t.assignedTo?._id && map.set(t.assignedTo._id, t.assignedTo.name));
    return [...map].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [tickets]);

  const counts = useMemo(
    () => ({ open: tickets.filter(isOpen).length, closed: tickets.filter((t) => t.isComplete).length, unassigned: tickets.filter((t) => isOpen(t) && !t.assignedTo).length }),
    [tickets]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (view === "open" && !isOpen(t)) return false;
      if (view === "closed" && !t.isComplete) return false;
      if (view === "unassigned" && (!isOpen(t) || t.assignedTo)) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (assignee === "none" ? Boolean(t.assignedTo) : assignee !== "all" && t.assignedTo?._id !== assignee) return false;
      if (!term) return true;
      return [t.title, t.number, t.name, t.email, clientName(t)].some((v) => String(v || "").toLowerCase().includes(term));
    });
  }, [tickets, search, view, priority, assignee]);

  const openTicket = tickets.find((t) => t._id === openId) || null;

  const columns = [
    { id: "title", header: "Ticket", sortValue: (t) => t.title, cell: (t) => <EntityCell title={t.title} subtitle={`#${t.number} · ${t.name || t.email || ""}`} /> },
    { id: "priority", header: "Priority", sortValue: (t) => PRIORITY_RANK[t.priority] || 0, cell: (t) => <PriorityBadge value={t.priority} /> },
    { id: "status", header: "Status", hideBelow: "md", sortValue: statusOf, cell: (t) => <Badge tone={t.isComplete ? "success" : "brand"} dot>{statusOf(t)}</Badge> },
    { id: "assignee", header: "Assignee", hideBelow: "lg", sortValue: (t) => t.assignedTo?.name, cell: (t) => t.assignedTo?.name || <span className="text-ink-faint">Unassigned</span> },
    { id: "client", header: "Client", hideBelow: "xl", sortValue: clientName, cell: (t) => clientName(t) || "—" },
    { id: "updated", header: "Updated", hideBelow: "md", className: "whitespace-nowrap text-ink-muted", sortValue: (t) => new Date(t.updatedAt || t.createdAt).getTime(), cell: (t) => timeAgo(t.updatedAt || t.createdAt) },
  ];

  const filtersActive = Boolean(search) || priority !== "all" || assignee !== "all";

  return (
    <Page>
      <PageHeader
        title="Tickets"
        description="Every ticket across all mailboxes and clients."
        actions={<Button onClick={() => query.refetch()} loading={query.isFetching && !query.isPending}>Refresh</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search title, number or requester" aria-label="Search tickets" className="w-full sm:w-72" />
        <ToggleChip pressed={view === "open"} onClick={() => setView("open")}>Open {counts.open}</ToggleChip>
        <ToggleChip pressed={view === "unassigned"} onClick={() => setView("unassigned")}>Unassigned {counts.unassigned}</ToggleChip>
        <ToggleChip pressed={view === "closed"} onClick={() => setView("closed")}>Closed {counts.closed}</ToggleChip>
        <ToggleChip pressed={view === "all"} onClick={() => setView("all")}>All</ToggleChip>
        <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-36">
          <option value="all">Any priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-44">
          <option value="all">Any assignee</option>
          <option value="none">Unassigned</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </Select>
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} ${filtered.length === 1 ? "ticket" : "tickets"}` : ""}</span>
      </div>

      <DataTable
        label="Tickets"
        columns={columns}
        rows={filtered}
        getRowId={(t) => t._id}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={(t) => setOpenId(t._id)}
        initialSort={{ id: "updated", dir: "desc" }}
        resetKey={`${search}|${view}|${priority}|${assignee}`}
        empty={
          <EmptyState
            icon={TicketIcon}
            title={filtersActive || view !== "all" ? "No tickets match these filters" : "No tickets yet"}
            description={filtersActive || view !== "all" ? "Try a different filter or search." : "Tickets from email and the portal will appear here."}
            action={
              filtersActive ? (
                <Button onClick={() => { setSearch(""); setPriority("all"); setAssignee("all"); }}>Clear filters</Button>
              ) : undefined
            }
          />
        }
      />

      <TicketDrawer ticket={openTicket} open={Boolean(openTicket)} onOpenChange={(o) => !o && setOpenId(null)} />
    </Page>
  );
}
