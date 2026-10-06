// Threads as a communication workspace: view rail | inbox list | conversation.
// Shared by /admin/threads and /agents/threads (basePath). Selection lives in the URL (?threadId=), the mailbox filter
// in ?mailboxId= (the agent sidebar links to it), so links and the browser back button behave.
import React, { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, ListFilter, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { createOrOpenThread } from "../../services/communication.service";
import { useUser } from "../../store/session";
import {
  Button, Dialog, DialogContent, Drawer, DrawerContent, EmptyState, Field, FilterChip, Input, Menu, MenuContent, MenuRadioGroup, MenuRadioItem,
  MenuTrigger, Alert, SearchInput, Select, Skeleton, ToggleChip, cn, focusRing, toast,
} from "../../ui";
import { ThreadPanel } from "./ThreadPanel";
import { ThreadRow } from "./ThreadRow";
import { MAILBOXES_KEY, SORTS, STATUSES, THREADS_KEY, fetchAllThreads, fetchMailboxes, sortThreads, statusMeta, threadTitle } from "./model";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/* --------------------------- horizontal view nav --------------------------- */

/** One item in the horizontal view nav: compact, no card, active = the design system's brand-soft pill. */
function NavPill({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds px-2.5 text-body-sm font-medium transition-colors",
        active ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:bg-subtle hover:text-ink",
        focusRing
      )}
    >
      {label}
      {count !== undefined ? <span className={cn("text-caption tabular-nums", active ? "text-brand-ink" : "text-ink-faint")}>{count}</span> : null}
    </button>
  );
}

const NavSeparator = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />;

/**
 * Compact horizontal application navigation (views, statuses, mailboxes), one row tall. Replaces what used to be a
 * ~300px vertical sidebar, so the thread list gets the full width. Scrolls horizontally instead of wrapping when narrow.
 */
function ViewNav({ view, onView, counts, mailboxes, mailboxId, onMailbox }) {
  return (
    <nav aria-label="Thread views" className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-canvas px-3">
      <NavPill active={view === "all"} label="All threads" count={counts?.all} onClick={() => onView("all")} />
      <NavPill active={view === "unread"} label="Unread" count={counts?.unread} onClick={() => onView("unread")} />
      <NavSeparator />
      {STATUSES.map((s) => (
        <NavPill key={s.value} active={view === s.value} label={s.label} count={counts?.[s.value]} onClick={() => onView(s.value)} />
      ))}
      {mailboxes.length > 0 ? (
        <>
          <NavSeparator />
          {mailboxes.map((m) => (
            <NavPill key={m._id} active={mailboxId === m._id} label={m.name} onClick={() => onMailbox(mailboxId === m._id ? null : m._id)} />
          ))}
        </>
      ) : null}
    </nav>
  );
}

/* ------------------------------ new thread ------------------------------- */

function NewThreadDialog({ open, onOpenChange, mailboxes, onCreated }) {
  const { fetchWithAuth } = useUser();
  const [caseId, setCaseId] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const create = useMutation({
    mutationFn: () => createOrOpenThread(fetchWithAuth, { sourceCaseId: caseId.trim(), mailboxId: mailboxId || undefined }),
    onSuccess: ({ thread, created }) => {
      toast.success(created ? "Thread created" : "Thread already existed. Opened it.");
      setCaseId("");
      setMailboxId("");
      onOpenChange(false);
      if (thread?._id) onCreated(thread._id);
    },
    onError: (error) => toast.error(error.message || "Could not open the thread"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New thread"
        description="Opens the thread for a case, or creates it if it does not exist yet."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
            <Button variant="primary" type="submit" form="new-thread-form" loading={create.isPending} disabled={!caseId.trim()}>Open thread</Button>
          </>
        }
      >
        <form id="new-thread-form" onSubmit={(e) => { e.preventDefault(); if (caseId.trim()) create.mutate(); }} className="space-y-4">
          <Field label="Case ID" required hint="For example APP-20260606142029642. Stored in upper case.">
            {(f) => <Input {...f} value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="APP-…" disabled={create.isPending} />}
          </Field>
          {mailboxes.length > 0 ? (
            <Field label="Mailbox" hint="Optional.">
              {(f) => (
                <Select {...f} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={create.isPending}>
                  <option value="">No mailbox</option>
                  {mailboxes.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function ThreadsWorkspace({ basePath }) {
  const { fetchWithAuth } = useUser();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const threadId = params.get("threadId") || null;
  const mailboxId = params.get("mailboxId") || null;

  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const listRef = useRef(null);
  const wide = useMediaQuery("(min-width: 1280px)");

  const setParam = (key, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: key !== "threadId" });

  const threadsQuery = useQuery({
    queryKey: [...THREADS_KEY, mailboxId || "all"],
    queryFn: () => fetchAllThreads(fetchWithAuth, { mailboxId }),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
  const mailboxesQuery = useQuery({ queryKey: MAILBOXES_KEY, queryFn: () => fetchMailboxes(fetchWithAuth), staleTime: 5 * 60_000, retry: false });
  const mailboxes = mailboxesQuery.data || [];
  const mailboxNames = useMemo(() => Object.fromEntries(mailboxes.map((m) => [m._id, m.name])), [mailboxes]);
  const nameFor = (thread) => (thread.mailboxId && (thread.mailboxId.name || mailboxNames[String(thread.mailboxId._id || thread.mailboxId)])) || null;

  const all = threadsQuery.data || [];
  const counts = useMemo(() => {
    if (!threadsQuery.data) return undefined;
    const c = { all: all.length, unread: all.filter((t) => t.unreadCount > 0).length };
    STATUSES.forEach((s) => (c[s.value] = all.filter((t) => t.status === s.value).length));
    return c;
  }, [threadsQuery.data, all]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = all.filter((t) => {
      if (view === "unread" ? !(t.unreadCount > 0) : view !== "all" && t.status !== view) return false;
      if (unreadOnly && !(t.unreadCount > 0)) return false;
      if (!term) return true;
      return [threadTitle(t), t.sourceCaseId, t.lastMessage, nameFor(t), statusMeta(t.status).label].some((v) => String(v || "").toLowerCase().includes(term));
    });
    return sortThreads(filtered, sort);
  }, [all, view, unreadOnly, search, sort, mailboxNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive = Boolean(search) || unreadOnly || Boolean(mailboxId) || view !== "all";
  const clearFilters = () => {
    setSearch("");
    setUnreadOnly(false);
    setView("all");
    if (mailboxId) setParam("mailboxId", null);
  };

  const open = (id) => setParam("threadId", id);
  const close = () => setParam("threadId", null);
  const selectedRow = all.find((t) => t._id === threadId);

  // Arrow keys move between rows; Enter (native button click) opens.
  function onListKeyDown(e) {
    const keys = { ArrowDown: 1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== "Home" && e.key !== "End") return;
    const items = [...listRef.current.querySelectorAll("[data-thread-row]")];
    if (!items.length) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, index + keys[e.key]));
    items[next].focus();
  }

  const activeSort = SORTS.find((s) => s.value === sort);
  const showPanel = Boolean(threadId);
  const panel = threadId ? <ThreadPanel key={threadId} threadId={threadId} basePath={basePath} onBack={close} mailboxName={selectedRow ? nameFor(selectedRow) : null} /> : null;

  const statusChip = (
    <FilterChip label="Status" value={STATUSES.some((s) => s.value === view) ? view : null} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} onChange={(v) => setView(v || "all")} />
  );
  const mailboxChip = mailboxes.length > 0 ? (
    <FilterChip label="Mailbox" value={mailboxId} options={mailboxes.map((m) => ({ value: m._id, label: m.name }))} onChange={(v) => setParam("mailboxId", v)} />
  ) : null;
  const sortMenu = (
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ViewNav view={view} onView={setView} counts={counts} mailboxes={mailboxes} mailboxId={mailboxId} onMailbox={(id) => setParam("mailboxId", id)} />

      <div className="flex min-h-0 flex-1">
      {/* Inbox list */}
      <section className={cn("flex min-w-0 flex-1 flex-col", wide && showPanel && "max-w-[27rem] flex-none border-r border-line xl:w-[27rem]")} aria-label="Threads">
        <div className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-heading font-semibold text-ink">Threads</h1>
              <p className={cn("text-body-sm text-ink-muted", wide && showPanel && "hidden")}>Review and respond to shared communication.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" onClick={() => threadsQuery.refetch()} loading={threadsQuery.isFetching && !threadsQuery.isPending} aria-label="Refresh threads">
                <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New thread</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} onClear={() => setSearch("")} placeholder="Search threads" aria-label="Search threads" className="min-w-0 flex-1" />
            <Button size="sm" className="sm:hidden" onClick={() => setFiltersOpen(true)} aria-label="Filters"><ListFilter className="h-4 w-4" /></Button>
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {statusChip}
            {mailboxChip}
            <ToggleChip pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread</ToggleChip>
            {filtersActive ? <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}
            <span className="ml-auto">{sortMenu}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threadsQuery.isPending ? (
            <ul aria-busy="true" aria-label="Loading threads">
              {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="flex gap-3 border-b border-line px-4 py-3">
                  <Skeleton className="mt-1 h-2 w-2 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : threadsQuery.isError ? (
            <div className="p-4">
              <Alert tone="danger" title="Couldn't load threads" action={<Button size="sm" onClick={() => threadsQuery.refetch()}>Retry</Button>}>
                {threadsQuery.error?.message}
              </Alert>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No threads found"
              description="Try changing your filters or search."
              action={filtersActive ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
            />
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown}>
              {rows.map((thread) => (
                <ThreadRow key={thread._id} thread={thread} mailboxName={nameFor(thread)} selected={thread._id === threadId} onOpen={open} />
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 border-t border-line px-4 py-1.5 text-caption text-ink-faint" aria-live="polite">
          {threadsQuery.isSuccess ? `${rows.length} of ${all.length} ${all.length === 1 ? "thread" : "threads"}` : ""}
        </div>
      </section>

      {/* Conversation: inline on wide screens, full-screen sheet otherwise */}
      {wide && showPanel ? <section className="min-w-0 flex-1 bg-surface" aria-label="Conversation">{panel}</section> : null}
      </div>

      {!wide ? (
        <Drawer open={showPanel} onOpenChange={(o) => !o && close()}>
          <DrawerContent title="Conversation" description="Thread messages and reply" className="sm:max-w-2xl [&>div:first-child]:hidden">
            {panel}
          </DrawerContent>
        </Drawer>
      ) : null}

      {/* Mobile: the status/mailbox/sort filter drawer. Views live in the horizontal nav above, visible at every width. */}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent title="Filters" footer={<><Button onClick={clearFilters}>Clear filters</Button><Button variant="primary" onClick={() => setFiltersOpen(false)}>Show {rows.length} threads</Button></>}>
          <div className="space-y-4 p-4">
            <Field label="Status">
              {(f) => (
                <Select {...f} value={STATUSES.some((s) => s.value === view) ? view : ""} onChange={(e) => setView(e.target.value || "all")}>
                  <option value="">Any status</option>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              )}
            </Field>
            {mailboxes.length > 0 ? (
              <Field label="Mailbox">
                {(f) => (
                  <Select {...f} value={mailboxId || ""} onChange={(e) => setParam("mailboxId", e.target.value || null)}>
                    <option value="">Any mailbox</option>
                    {mailboxes.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label="Sort">
              {(f) => (
                <Select {...f} value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}{s.hint ? ` (${s.hint})` : ""}</option>)}
                </Select>
              )}
            </Field>
            <ToggleChip pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread only</ToggleChip>
          </div>
        </DrawerContent>
      </Drawer>

      <NewThreadDialog open={newOpen} onOpenChange={setNewOpen} mailboxes={mailboxes} onCreated={(id) => { queryClient.invalidateQueries({ queryKey: THREADS_KEY }); open(id); }} />
    </div>
  );
}
