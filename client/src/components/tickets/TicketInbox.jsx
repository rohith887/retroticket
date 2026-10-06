// Agent inbox: the views (Mine, Unassigned, All open, Resolved) live in the portal sidebar; small screens get view tabs.
// A row opens the ticket workspace at /agents/tickets/:id.
// The view lives in the URL (?status=mine|unassigned|all|closed), so links, refresh and the back button keep it.
// Search and filters run client-side over the loaded view (the ticket API has no search/sort parameters).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, Plus, RefreshCw, Ticket as TicketIcon } from "lucide-react";
import { useUser } from "../../store/session";
import { usePermissions } from "../../store/permissions";
import { useAdminSummary } from "../../ui/shell/AppShell";
import { Alert, Button, EmptyState, FilterChip, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger, SearchInput, Skeleton, ToggleChip, cn, focusRing } from "../../ui";
import { TicketRow } from "./TicketRow";
import { useBase } from "./useTicketBase";
import { PRIORITIES, SORTS, STATUSES, TICKET_LISTS_KEY, VIEWS, assigneeOf, clientNameOf, fetchTickets, requesterOf, sortTickets, viewMeta } from "./model";

const VIEW_TITLES = { mine: "My tickets", unassigned: "Unassigned", all: "All open tickets", closed: "Resolved tickets" };

export default function TicketInbox() {
  const { fetchWithAuth } = useUser();
  const { can } = usePermissions();
  const base = useBase();
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") || "mine";
  const view = viewMeta(raw === "open" ? "mine" : raw).value; // legacy ?status=open links land on Mine
  const summary = useAdminSummary();

  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState(null);
  const [status, setStatus] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [client, setClient] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState("recent");
  const listRef = useRef(null);

  // Remember the view so the workspace's "Inbox" link returns to it.
  useEffect(() => {
    try {
      sessionStorage.setItem("agentInboxView", view);
    } catch {
      /* not critical */
    }
  }, [view]);

  const query = useQuery({
    queryKey: [...TICKET_LISTS_KEY, view],
    queryFn: () => fetchTickets(fetchWithAuth, view),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
  const all = query.data || [];

  const counts = {
    mine: summary.data?.mine,
    unassigned: summary.data?.unassigned,
    all: summary.data?.open,
    closed: view === "closed" && query.isSuccess ? all.length : undefined,
  };

  const assignees = useMemo(() => {
    const map = new Map();
    all.forEach((t) => {
      const a = assigneeOf(t);
      if (a) map.set(String(a._id || a.id), a.name);
    });
    return [...map].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [all]);
  const clients = useMemo(() => [...new Set(all.map(clientNameOf).filter(Boolean))].sort(), [all]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = all.filter((t) => {
      if (priority && t.priority !== priority) return false;
      if (status && t.status !== status) return false;
      if (assignee === "none" ? Boolean(t.assignedTo) : assignee && String(t.assignedTo?._id || t.assignedTo?.id) !== assignee) return false;
      if (client && clientNameOf(t) !== client) return false;
      if (unreadOnly && !(t.unreadCount > 0)) return false;
      if (!term) return true;
      return [t.title, t.number, requesterOf(t), t.email, clientNameOf(t), t.sourceCaseId, t.detail, assigneeOf(t)?.name].some((v) => String(v || "").toLowerCase().includes(term));
    });
    return sortTickets(filtered, sort);
  }, [all, search, priority, status, assignee, client, unreadOnly, sort]);

  const filtersActive = Boolean(search || priority || status || assignee || client || unreadOnly);
  const clearFilters = () => {
    setSearch("");
    setPriority(null);
    setStatus(null);
    setAssignee(null);
    setClient(null);
    setUnreadOnly(false);
  };
  const setView = (next) => setParams({ status: next });

  // j / k move between rows (Enter opens the focused row: it is a link).
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.closest?.("[role=dialog]")) return;
      const step = e.key === "j" ? 1 : e.key === "k" ? -1 : 0;
      if (!step || !listRef.current) return;
      const items = [...listRef.current.querySelectorAll("[data-ticket-row]")];
      if (!items.length) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement);
      items[Math.min(items.length - 1, Math.max(0, index + step))].focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function onListKeyDown(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...listRef.current.querySelectorAll("[data-ticket-row]")];
    const index = items.indexOf(document.activeElement);
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }

  const activeSort = SORTS.find((s) => s.value === sort);
  const meta = viewMeta(view);

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <section className="flex min-w-0 flex-1 flex-col" aria-label={VIEW_TITLES[view]}>
        <div className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-heading font-semibold text-ink">{VIEW_TITLES[view]}</h1>
              <p className="text-body-sm text-ink-muted">{view === "mine" ? "Open tickets assigned to you." : view === "unassigned" ? "Open tickets nobody owns yet." : view === "all" ? "Every open ticket." : "Tickets that have been resolved."}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" onClick={() => query.refetch()} loading={query.isFetching && !query.isPending} aria-label="Refresh tickets">
                <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Refresh</span>
              </Button>
              {can("issue::create") ? (
                <Button as={Link} to={`${base}/tickets/new`} size="sm" variant="primary">
                  <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New ticket</span>
                </Button>
              ) : null}
            </div>
          </div>

          {/* Views on small screens (the rail is hidden below lg) */}
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:hidden" role="tablist" aria-label="Ticket views">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn("h-7 shrink-0 rounded-full border px-3 text-caption font-medium", view === v.value ? "border-brand-softline bg-brand-soft text-brand-ink" : "border-line text-ink-muted", focusRing)}
              >
                {v.label}
                {counts[v.value] !== undefined ? <span className="ml-1.5 text-ink-faint">{counts[v.value]}</span> : null}
              </button>
            ))}
          </div>

          <SearchInput value={search} onChange={setSearch} onClear={() => setSearch("")} placeholder="Search tickets" aria-label="Search tickets" className="w-full" />

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip label="Priority" value={priority} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} onChange={setPriority} />
            {view !== "closed" ? <FilterChip label="Status" value={status} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} onChange={setStatus} /> : null}
            {view === "all" && assignees.length > 0 ? (
              <FilterChip label="Assignee" value={assignee} options={[{ value: "none", label: "Unassigned" }, ...assignees.map(([id, name]) => ({ value: id, label: name }))]} onChange={setAssignee} />
            ) : null}
            {clients.length > 0 ? <FilterChip label="Client" value={client} options={clients.map((c) => ({ value: c, label: c }))} onChange={setClient} /> : null}
            <ToggleChip pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread</ToggleChip>
            {filtersActive ? <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}
            <span className="ml-auto">
              <Menu>
                <MenuTrigger asChild>
                  <button type="button" className={cn("inline-flex h-7 items-center gap-1.5 rounded-ds border border-line-strong bg-surface px-2.5 text-caption font-medium text-ink-muted hover:bg-subtle hover:text-ink", focusRing)}>
                    <ArrowDownUp className="h-3 w-3" aria-hidden="true" />
                    Sort: {activeSort.label}{activeSort.hint ? ` (${activeSort.hint})` : ""}
                  </button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuRadioGroup value={sort} onValueChange={setSort}>
                    {SORTS.map((s) => <MenuRadioItem key={s.value} value={s.value}>{s.label}{s.hint ? ` (${s.hint})` : ""}</MenuRadioItem>)}
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.isPending ? (
            <ul aria-busy="true" aria-label="Loading tickets">
              {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="flex gap-3 border-b border-line px-4 py-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : query.isError ? (
            <div className="p-4">
              <Alert tone="danger" title="Couldn't load tickets" action={<Button size="sm" onClick={() => query.refetch()}>Retry</Button>}>{query.error?.message}</Alert>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={TicketIcon}
              title={filtersActive ? "No tickets match" : meta.empty}
              description={filtersActive ? "Try changing your filters or search." : view === "mine" ? "New assignments will appear here." : undefined}
              action={filtersActive ? <Button onClick={clearFilters}>Clear filters</Button> : view === "mine" ? <Button onClick={() => setView("unassigned")}>See unassigned tickets</Button> : undefined}
            />
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown}>
              {rows.map((ticket) => (
                <TicketRow key={ticket._id} ticket={ticket} to={`${base}/tickets/${ticket._id}`} />
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 border-t border-line px-4 py-1.5 text-caption text-ink-faint" aria-live="polite">
          {query.isSuccess ? `${rows.length} of ${all.length} ${all.length === 1 ? "ticket" : "tickets"} · j / k to move, Enter to open` : ""}
        </div>
      </section>
    </div>
  );
}
