// Data layer + display helpers for the Threads workspace.
//
// Endpoints (all existing, unchanged):
//   GET  /v1/threads?status=&mailboxId=&includeMonitoring=   list rows: sourceCaseId, subject, lastMessage, lastMessageAt, unreadCount, mailboxId
//   GET  /v1/threads/:id/full                                thread + messages + workflow (also resets unreadCount)
//   POST /v1/messages                                        send a reply / internal message
//   POST /v1/threads                                         open (or create) a thread by sourceCaseId
//   GET  /v1/mailboxes                                       mailbox names (needs integration access; optional here)
//
// The list endpoint does not return status, so the list is loaded once per status (server-side `status` filter) and
// each row is tagged. That also gives real per-status counts without touching the API.
import { getThreads } from "../../services/communication.service";
import { getThreadTitle } from "../../utils/threadTitle";

export const THREADS_KEY = ["threadsWorkspace"];
export const MAILBOXES_KEY = ["threadMailboxes"];

/** Thread status enum from the Thread model, in inbox order. */
export const STATUSES = [
  { value: "open", label: "Open", tone: "brand" },
  { value: "active", label: "Active", tone: "success" },
  { value: "pending", label: "Pending", tone: "warning" },
  { value: "monitoring", label: "Monitoring", tone: "neutral" },
  { value: "closed", label: "Closed", tone: "neutral" },
  { value: "archived", label: "Archived", tone: "neutral" },
];
export const statusMeta = (value) => STATUSES.find((s) => s.value === value) || { value, label: value || "Unknown", tone: "neutral" };

export const CHANNEL_LABELS = { email: "Email", internal: "Internal", mixed: "Email & internal" };

export const SORTS = [
  { value: "recent", label: "Last activity", hint: "newest first" },
  { value: "oldest", label: "Last activity", hint: "oldest first" },
  { value: "unread", label: "Unread first", hint: "" },
  { value: "subject", label: "Subject", hint: "A to Z" },
];

const activityTime = (t) => new Date(t.lastMessageAt || t.updatedAt || 0).getTime() || 0;

export function sortThreads(threads, sort) {
  const list = [...threads];
  if (sort === "oldest") return list.sort((a, b) => activityTime(a) - activityTime(b));
  if (sort === "subject") return list.sort((a, b) => threadTitle(a).localeCompare(threadTitle(b), undefined, { sensitivity: "base" }));
  if (sort === "unread") return list.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || activityTime(b) - activityTime(a));
  return list.sort((a, b) => activityTime(b) - activityTime(a));
}

export const threadTitle = (thread) => getThreadTitle(thread);

/** Every status in parallel; tags each row with its status. `mailboxId` is applied server-side. */
export async function fetchAllThreads(fetchWithAuth, { mailboxId } = {}) {
  const results = await Promise.all(
    STATUSES.map((s) =>
      getThreads(fetchWithAuth, { status: s.value, mailboxId: mailboxId || undefined, includeMonitoring: true }).then((rows) => rows.map((row) => ({ ...row, status: s.value })))
    )
  );
  return results.flat();
}

export async function fetchMailboxes(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/mailboxes");
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.mailboxes) ? data.mailboxes : [];
}

/* ------------------------------ message helpers ------------------------------ */

export const senderName = (message) => message?.sender?.name || message?.sender?.email || "Unknown sender";

/** Who a reply goes to: the thread's applicant email, else the workflow's candidate email. */
export function replyRecipient(thread, workflow) {
  return thread?.applicantEmail || workflow?.candidateEmail || null;
}

/** Default internal recipient (a user id) from the workflow snapshot. */
export function defaultInternalUserId(thread) {
  const v = thread?.workflowSnapshot?.currentUserId || thread?.lastAssignedUserId;
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Realtime hook point. A future socket event (new message, status change, read) can call this with the thread id and a
 * patch such as { lastMessage, lastMessageAt, unreadCount, status }; every mounted list updates in place, no refetch.
 */
export function applyThreadUpdate(queryClient, threadId, patch) {
  queryClient.setQueriesData({ queryKey: THREADS_KEY }, (rows) =>
    Array.isArray(rows) ? rows.map((row) => (row._id === threadId ? { ...row, ...patch } : row)) : rows
  );
}
