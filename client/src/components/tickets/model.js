// Data layer + display helpers for the agent Tickets inbox and workspace.
//
// Endpoints (existing, unchanged). Note the doubled "ticket/" in three of the write routes: the ticket router defines
// "/ticket/update" and "/ticket/comment" and is mounted at /api/v1/ticket.
//   GET   /v1/ticket/tickets/user/open      Mine      -> { tickets }   (populated: clientId, assignedTo, team)
//   GET   /v1/ticket/tickets/unassigned     Unassigned -> { tickets }  (NOT populated)
//   GET   /v1/ticket/tickets/open           All open  -> { tickets }   (populated, newest first)
//   GET   /v1/ticket/tickets/completed      Resolved  -> { tickets }   (populated)
//   (list rows also carry per-user `unreadCount`, `lastMessage` and `lastMessageAt`; GET /:id marks the ticket read for you)
//   GET   /v1/ticket/:id                    -> { ticket: { ...fields, comments: [{ text, public, userId: {name}, createdAt, seq }] } }
//   PUT   /v1/ticket/ticket/update          { id, priority?, status? }
//   PATCH /v1/ticket/assign/:id             { assignedTo: userId | null }
//   PUT   /v1/ticket/status/update          { id, status: boolean }  (sets isComplete)
//   POST  /v1/ticket/ticket/comment         { id, text, public }     (public also emails ticket.email)
//   GET   /v1/user/all                      assignee choices (needs user::read; optional here)
// There is no pagination and no server-side search/sort; the list is loaded per view and filtered client-side.

export const TICKET_LISTS_KEY = ["agentTicketLists"];
export const ticketKey = (id) => ["agentTicket", id];

export const VIEWS = [
  { value: "mine", label: "Mine", path: "/v1/ticket/tickets/user/open", empty: "Nothing assigned to you." },
  { value: "unassigned", label: "Unassigned", path: "/v1/ticket/tickets/unassigned", empty: "No unassigned tickets." },
  { value: "all", label: "All open", path: "/v1/ticket/tickets/open", empty: "No open tickets." },
  { value: "closed", label: "Resolved", path: "/v1/ticket/tickets/completed", empty: "No resolved tickets." },
];
export const viewMeta = (value) => VIEWS.find((v) => v.value === value) || VIEWS[0];

export const PRIORITIES = [
  { value: "critical", label: "Critical", tone: "danger" },
  { value: "high", label: "High", tone: "warning" },
  { value: "medium", label: "Medium", tone: "neutral" },
  { value: "low", label: "Low", tone: "neutral" },
];
export const priorityMeta = (value) => PRIORITIES.find((p) => p.value === value) || { value, label: value || "None", tone: "neutral" };
const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

/** Status strings used across the app (kanban views, portal, model default). `isComplete` is separate: Resolved. */
export const STATUSES = [
  { value: "open", label: "Open", tone: "brand" },
  { value: "needs_support", label: "Needs support", tone: "warning" },
  { value: "in_progress", label: "In progress", tone: "brand" },
  { value: "in_review", label: "In review", tone: "neutral" },
  { value: "done", label: "Done", tone: "success" },
];

/** What to show for a ticket's state: Resolved wins over the status string. */
export function ticketState(ticket) {
  if (ticket.isComplete) return { value: "resolved", label: "Resolved", tone: "success" };
  return STATUSES.find((s) => s.value === ticket.status) || { value: ticket.status || "open", label: humanize(ticket.status || "open"), tone: "neutral" };
}
export const humanize = (value) => String(value || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const SORTS = [
  { value: "recent", label: "Last activity", hint: "newest first" },
  { value: "oldest", label: "Last activity", hint: "oldest first" },
  { value: "priority", label: "Priority", hint: "highest first" },
  { value: "created", label: "Created", hint: "newest first" },
  { value: "unread", label: "Unread first", hint: "" },
];

const activity = (t) => new Date(t.lastMessageAt || t.updatedAt || t.createdAt || 0).getTime() || 0;
export function sortTickets(tickets, sort) {
  const list = [...tickets];
  if (sort === "oldest") return list.sort((a, b) => activity(a) - activity(b));
  if (sort === "priority") return list.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || activity(b) - activity(a));
  if (sort === "unread") return list.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || activity(b) - activity(a));
  if (sort === "created") return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return list.sort((a, b) => activity(b) - activity(a));
}

/* ------------------------------ field helpers ------------------------------ */

export const requesterOf = (t) => t.name || t.email || "Unknown requester";
export const clientNameOf = (t) => t.clientId?.name || t.client?.name || t.clientName || "";
export const assigneeOf = (t) => (t.assignedTo && typeof t.assignedTo === "object" ? t.assignedTo : null);
export const assigneeIdOf = (t) => (t.assignedTo ? String(t.assignedTo._id || t.assignedTo.id || t.assignedTo) : null);

/* ---------------------------------- API ---------------------------------- */

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchTickets(fetchWithAuth, view) {
  const res = await fetchWithAuth(viewMeta(view).path);
  if (!res.ok) throw new Error(await readError(res, `Could not load tickets (${res.status})`));
  const data = await res.json();
  if (data.success === false) throw new Error(data.message || "Could not load tickets");
  return Array.isArray(data.tickets) ? data.tickets : [];
}

export async function fetchTicket(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/ticket/${id}`);
  if (!res.ok) throw new Error(await readError(res, res.status === 404 ? "Ticket not found" : `Could not load ticket (${res.status})`));
  const data = await res.json();
  if (!data.ticket) throw new Error(data.message || "Ticket not found");
  return data.ticket;
}

export async function updateTicketFields(fetchWithAuth, id, fields) {
  const res = await fetchWithAuth("/v1/ticket/ticket/update", { method: "PUT", body: JSON.stringify({ id, ...fields }) });
  if (!res.ok) throw new Error(await readError(res, "Could not update the ticket"));
}

export async function assignTicket(fetchWithAuth, id, userId) {
  const res = await fetchWithAuth(`/v1/ticket/assign/${id}`, { method: "PATCH", body: JSON.stringify({ assignedTo: userId || null }) });
  if (!res.ok) throw new Error(await readError(res, "Could not change the assignee"));
  const data = await res.json();
  return data.ticket || null;
}

export async function setTicketComplete(fetchWithAuth, id, complete) {
  const res = await fetchWithAuth("/v1/ticket/status/update", { method: "PUT", body: JSON.stringify({ id, status: complete }) });
  if (!res.ok) throw new Error(await readError(res, "Could not change the ticket status"));
}

/** Returns { comment, emailed, emailNote, sendAfter }. `clientMessageId` makes a retried request safe. */
export async function postComment(fetchWithAuth, id, text, isPublic, clientMessageId) {
  const res = await fetchWithAuth("/v1/ticket/ticket/comment", { method: "POST", body: JSON.stringify({ id, text, public: isPublic, clientMessageId }) });
  if (!res.ok) throw new Error(await readError(res, "Could not send the message"));
  return res.json();
}

export async function undoComment(fetchWithAuth, commentId) {
  const res = await fetchWithAuth(`/v1/ticket/comment/${commentId}/undo`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Could not undo the message"));
}

export async function retryComment(fetchWithAuth, commentId) {
  const res = await fetchWithAuth(`/v1/ticket/comment/${commentId}/retry`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Could not retry the message"));
}

/** True while any reply is still waiting to be emailed (drives short-interval polling). */
export const hasPendingDelivery = (ticket) => (ticket?.comments || []).some((c) => c.delivery && (c.delivery.status === "queued" || c.delivery.status === "processing"));

/**
 * Realtime hook point. A future socket event can call this with a ticket id and a patch such as
 * { status, priority, assignedTo, isComplete, updatedAt }; the open inbox lists and the open workspace update in place.
 */
export function applyTicketUpdate(queryClient, id, patch) {
  queryClient.setQueriesData({ queryKey: TICKET_LISTS_KEY }, (rows) =>
    Array.isArray(rows) ? rows.map((row) => (row._id === id ? { ...row, ...patch } : row)) : rows
  );
  queryClient.setQueryData(ticketKey(id), (ticket) => (ticket ? { ...ticket, ...patch } : ticket));
}

const labelOf = (list, value) => list.find((x) => x.value === value)?.label || humanize(value);

/** One readable sentence for an activity ("Anita assigned this to Ravi"). */
export function describeActivity(activity, me) {
  const d = activity.data || {};
  const actorId = activity.actor?.id ? String(activity.actor.id) : null;
  const who = actorId && me?._id && actorId === String(me._id) ? "You" : activity.actor?.name || "Someone";
  switch (activity.type) {
    case "ticket_created":
      return d.via === "email" ? `Ticket created from an email by ${who}` : `${who} created this ticket`;
    case "assigned":
      if (d.to?.id && actorId && d.to.id === actorId) return `${who} took this ticket`;
      return `${who} assigned this to ${d.to?.name || "someone"}${d.from?.name ? ` (was ${d.from.name})` : ""}`;
    case "unassigned":
      return `${who} unassigned this${d.from?.name ? ` (was ${d.from.name})` : ""}`;
    case "status_changed":
      return `${who} changed the status from ${labelOf(STATUSES, d.from)} to ${labelOf(STATUSES, d.to)}`;
    case "priority_changed":
      return `${who} changed the priority from ${labelOf(PRIORITIES, d.from)} to ${labelOf(PRIORITIES, d.to)}`;
    case "subject_changed":
      return `${who} renamed this ticket`;
    case "resolved":
      return `${who} marked this as resolved`;
    case "reopened":
      return `${who} reopened this ticket`;
    case "client_changed":
      return `${who} moved this to ${d.to || "another client"}`;
    case "delivery_failed":
      return `The email${d.to ? ` to ${d.to}` : ""} could not be delivered`;
    default:
      return `${who} updated this ticket`;
  }
}

/**
 * Turn a ticket + its comments (+ activity events) into conversation items for ConversationTimeline.
 * Messages: { id, direction, senderName, body, createdAt, delivery?, failed? }.  Events: { id, kind: "event", text, createdAt, tone? }.
 */
export function buildMessages(ticket, me, { activity = true } = {}) {
  const items = [];
  const comments = (ticket.comments || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0) || new Date(a.createdAt) - new Date(b.createdAt));
  const first = comments[0];
  // Tickets opened by email also store the first message as a comment: show it once.
  const duplicateOfDetail = first && first.direction === "inbound" && String(first.text || "").trim() === String(ticket.detail || "").trim();
  if (ticket.detail && !duplicateOfDetail) {
    items.push({ id: `${ticket._id}-detail`, direction: "inbound", senderName: requesterOf(ticket), body: ticket.detail, createdAt: ticket.createdAt });
  }
  const creatorId = ticket.createdBy ? String(ticket.createdBy._id || ticket.createdBy) : null;
  const assigneeId = assigneeIdOf(ticket);
  comments.forEach((c) => {
    const authorId = c.userId ? String(c.userId._id || c.userId) : null;
    // Older comments have no recorded direction. A public comment by the person who raised the ticket (and who is
    // not staff on it) is the customer talking.
    const fromCustomer = c.public && authorId && authorId === creatorId && authorId !== assigneeId && authorId !== (me?._id ? String(me._id) : null);
    items.push({
      id: c._id,
      direction: c.direction || (!c.public ? "internal" : fromCustomer ? "inbound" : "outbound"),
      senderName: c.direction === "inbound" ? c.authorName || c.authorEmail || "Customer" : c.userId?.name || c.authorName || "System",
      body: c.text,
      createdAt: c.createdAt,
      delivery: c.delivery || null,
      failed: c.delivery?.status === "failed",
    });
  });
  if (activity) {
    (ticket.activities || []).forEach((a) =>
      items.push({ id: `act-${a._id}`, kind: "event", text: describeActivity(a, me), createdAt: a.at, tone: a.type === "delivery_failed" ? "danger" : "neutral" })
    );
  }
  // Time order; on a tie the ticket-created event comes first, then messages, then other events.
  const rank = (i) => (i.kind === "event" ? (i.text.includes("created") ? 0 : 2) : 1);
  return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || rank(a) - rank(b));
}
