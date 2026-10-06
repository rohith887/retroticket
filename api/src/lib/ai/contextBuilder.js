// Deterministic, bounded conversation context for the internal intelligence engine. Node owns this step: Node knows the data, the permissions
// and the internal-note rules, so Node decides exactly what may leave. The intelligence service receives only what this
// module produces, and re-checks it independently.
//
// Strategy (defaults; the same input always produces the same output and the same hash):
//   1. Every comment becomes a message with a role: customer | agent | internal_note. Recorded ticket events become short
//      `system` lines with no names in them.
//   2. Each message is cleaned (quoted replies, "On ... wrote:" tails, signatures, disclaimers removed), sanitized (emails,
//      phones, links, ids, secrets masked), has known person names replaced with placeholders, and is trimmed to
//      MAX_MESSAGE_CHARS (head + tail, marked truncated).
//   3. Internal notes are dropped BEFORE budgeting unless the caller passes includeInternalNotes. Reply drafts never do.
//   4. The first customer message and the newest message are always kept. The rest fill backwards from the newest until the
//      character budget is used; older messages that do not fit are omitted and counted.
//   5. The result reports what was omitted, so the agent knows the context is partial.
const crypto = require('crypto');
const { sanitizeForAi } = require('./sanitize');

const CUSTOMER_PLACEHOLDER = '{{customer_name}}';
const AGENT_PLACEHOLDER = '[agent]';
const DEFAULT_LIMITS = { maxChars: 12000, maxMessageChars: 1200, headChars: 800, tailChars: 300, maxActivities: 10, maxMessages: 60 };

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------ cleaning ------------------------------ */

const DISCLAIMER = /(confidential(ity)?|intended (solely )?for the (use of the )?(individual|addressee|recipient)|if you are not the intended recipient|please consider the environment|this (e-?mail|message) (and any attachments )?(is|are) (for|intended))/i;

/** The customer's or agent's own words: no quoted replies, reply headers, signatures or legal footers. */
function cleanMessageText(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n');
  text = text.split(/\n\s*on .{5,200} wrote:\s*(?:\n|$)/i)[0];
  text = text.split(/\n\s*-{2,}\s*original message\s*-{2,}/i)[0];
  text = text.split(/\n\s*from:\s.+\n\s*(?:sent|date):\s/i)[0];
  text = text.split(/\n-- ?\n/)[0]; // signature delimiter
  text = text.replace(/^\s*>.*$/gm, '');
  text = text.replace(/^\s*sent from my [\w\s]+$/gim, '');
  const paragraphs = text.split(/\n{2,}/).filter((p) => !DISCLAIMER.test(p));
  return paragraphs.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Replace known names (whole words, case-insensitive) so they never reach the model. Longest names first. */
function replaceNames(text, names, placeholder) {
  const variants = new Set();
  for (const name of names.filter(Boolean)) {
    const full = String(name).trim();
    if (full.length >= 2) variants.add(full);
    for (const part of full.split(/\s+/)) if (part.length >= 3) variants.add(part);
  }
  if (!variants.size) return text;
  // One pass with all variants (longest first): replacement text is never scanned again, so placeholders cannot nest.
  const pattern = [...variants].sort((x, y) => y.length - x.length).map(escapeRegExp).join('|');
  return text.replace(new RegExp('(?<![\\w])(?:' + pattern + ')(?![\\w])', 'gi'), placeholder);
}

function trimMessage(text, limits) {
  if (text.length <= limits.maxMessageChars) return { text, truncated: false };
  return { text: `${text.slice(0, limits.headChars).trimEnd()} […] ${text.slice(-limits.tailChars).trimStart()}`, truncated: true };
}

/* ------------------------------ roles and events ------------------------------ */

const idOf = (value) => (value ? String(value._id || value.id || value) : null);

/** customer | agent | internal_note. Anything ambiguous about privacy is treated as an internal note (never leaks outward). */
function roleOfComment(comment, ticket) {
  if (comment.direction === 'internal' || comment.public === false) return 'internal_note';
  if (comment.direction === 'inbound') return 'customer';
  if (!comment.direction) {
    const author = idOf(comment.userId);
    const creator = idOf(ticket.createdBy);
    const assignee = idOf(ticket.assignedTo);
    if (comment.public && author && creator && author === creator && author !== assignee) return 'customer';
  }
  return 'agent';
}

const STATUS_LABEL = (value) => String(value || 'open').replace(/_/g, ' ');

/** Ticket events as short, name-free lines. Events that would expose internal system details are not included. */
function describeEvent(activity) {
  const d = activity.data || {};
  switch (activity.type) {
    case 'ticket_created':
      return 'Ticket created.';
    case 'assigned':
      return 'Ticket assigned to an agent.';
    case 'unassigned':
      return 'Ticket unassigned.';
    case 'status_changed':
      return `Status changed from ${STATUS_LABEL(d.from)} to ${STATUS_LABEL(d.to)}.`;
    case 'priority_changed':
      return `Priority changed from ${d.from || 'unknown'} to ${d.to || 'unknown'}.`;
    case 'resolved':
      return 'Ticket marked as resolved.';
    case 'reopened':
      return 'Ticket reopened.';
    default:
      return null; // delivery errors, client moves, renames: not relevant to a summary and not for the model
  }
}

/* ------------------------------ builder ------------------------------ */

/**
 * @param ticket    { _id, status, isComplete, priority, name, createdAt, lastSeq, createdBy, assignedTo }
 * @param comments  ticket comments (any order)
 * @param activities ticket activities (any order)
 * @param options   { includeInternalNotes: boolean (default false), includeActivities: boolean (default true), limits }
 */
function buildTicketContext({ ticket, comments = [], activities = [], options = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const includeNotes = options.includeInternalNotes === true;
  const includeActivities = options.includeActivities !== false;

  const customerNames = [ticket.name];
  const staff = comments.filter((c) => roleOfComment(c, ticket) !== 'customer');
  const agentNames = staff.map((c) => c.userId && c.userId.name).concat(staff.map((c) => c.authorName), ticket.assignedTo && ticket.assignedTo.name);
  const customerLower = new Set(customerNames.filter(Boolean).map((n) => n.toLowerCase()));

  const items = [];
  for (const comment of comments) {
    const role = roleOfComment(comment, ticket);
    if (role === 'internal_note' && !includeNotes) continue; // dropped before budgeting: notes never even reach the budget
    let text = cleanMessageText(comment.text);
    text = sanitizeForAi(text, { maxChars: 20000 });
    text = replaceNames(text, customerNames, CUSTOMER_PLACEHOLDER);
    text = replaceNames(text, agentNames.filter((n) => n && !customerLower.has(String(n).toLowerCase())), AGENT_PLACEHOLDER);
    if (!text) continue;
    const trimmed = trimMessage(text, limits);
    items.push({ id: String(comment._id), role, at: comment.createdAt ? new Date(comment.createdAt).toISOString() : null, seq: comment.seq || 0, ...trimmed });
  }
  // The original request is the ticket description; it is the first customer message when no comment repeats it.
  const description = sanitizeForAi(cleanMessageText(ticket.detail), { maxChars: 20000 });
  const firstComment = items.find((i) => i.role === 'customer');
  if (description && !(firstComment && replaceNames(description, customerNames, CUSTOMER_PLACEHOLDER).trim() === firstComment.text.trim())) {
    const text = replaceNames(description, customerNames, CUSTOMER_PLACEHOLDER);
    items.push({ id: `${ticket._id}-description`, role: 'customer', at: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : null, seq: 0, ...trimMessage(text, limits) });
  }

  if (includeActivities) {
    const events = activities
      .map((a) => ({ a, text: describeEvent(a) }))
      .filter((e) => e.text)
      .sort((x, y) => new Date(y.a.at) - new Date(x.a.at))
      .slice(0, limits.maxActivities)
      .reverse();
    for (const { a, text } of events) items.push({ id: `event-${String(a._id)}`, role: 'system', at: a.at ? new Date(a.at).toISOString() : null, seq: 0, text, truncated: false });
  }

  items.sort((x, y) => new Date(x.at || 0) - new Date(y.at || 0) || x.seq - y.seq || x.id.localeCompare(y.id));

  // --- budget: keep the first customer message and the newest item, then fill backwards from the newest ---
  const chosen = new Set();
  const firstCustomer = items.findIndex((i) => i.role === 'customer');
  const newest = items.length - 1;
  let used = 0;
  const take = (index) => {
    if (index < 0 || chosen.has(index)) return;
    chosen.add(index);
    used += items[index].text.length;
  };
  take(firstCustomer);
  take(newest);
  if (used > limits.maxChars) {
    // Only possible with a tiny budget: keep just the newest, shortened to fit.
    chosen.clear();
    chosen.add(newest);
    items[newest] = { ...items[newest], text: items[newest].text.slice(0, limits.maxChars), truncated: true };
    used = items[newest].text.length;
  }
  for (let i = newest - 1; i >= 0 && chosen.size < limits.maxMessages; i -= 1) {
    if (chosen.has(i)) continue;
    if (used + items[i].text.length > limits.maxChars) break; // a contiguous recent tail, never scattered leftovers
    take(i);
  }
  const included = items.filter((_, index) => chosen.has(index));
  const omittedCount = items.length - included.length;

  const usedInternalNotes = included.some((i) => i.role === 'internal_note');
  const rawStatus = ticket.isComplete ? 'resolved' : String(ticket.status || 'open').toLowerCase().replace(/[^a-z0-9_ -]/g, '').slice(0, 32);
  const status = /^[a-z][a-z0-9_ -]*$/.test(rawStatus) ? rawStatus : 'open'; // must satisfy the Python contract
  const priority = ['low', 'medium', 'high', 'critical'].includes(ticket.priority) ? ticket.priority : undefined;
  const messages = included.map(({ id, role, at, text, truncated }) => ({ id, role, ...(at ? { at } : {}), text, truncated }));
  const omitted = { count: omittedCount, ...(omittedCount ? { note: `${omittedCount} earlier message(s) omitted` } : {}) };

  const contextHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ status, priority: priority || null, messages: messages.map((m) => [m.id, m.role, m.text]), omitted: omitted.count }))
    .digest('hex');

  return {
    ticketFacts: { status, ...(priority ? { priority } : {}), ...(ticket.createdAt ? { createdAt: new Date(ticket.createdAt).toISOString() } : {}) },
    messages,
    omitted,
    contextHash,
    basedOnSeq: Number(ticket.lastSeq) || 0,
    usedInternalNotes,
    stats: { inputChars: used, included: included.length, omitted: omittedCount, truncated: included.filter((i) => i.truncated).length },
  };
}

const RESOLVED_STATUSES = new Set(['done', 'resolved', 'closed', 'archived']);

/** The Node -> Python request body for POST /api/v1/analyze-conversation. Only Node-recorded ticket data is sent as ticket state. */
function buildConversationRequest({ ticket, comments, activities, includeInternalNotes = false, limits }) {
  const context = buildTicketContext({ ticket, comments, activities, options: { includeInternalNotes, limits } });
  const { status, priority } = context.ticketFacts;
  return {
    ...context,
    request: {
      ticketId: String(ticket._id),
      locale: 'en',
      ticket: { status, ...(priority ? { priority } : {}), isResolved: RESOLVED_STATUSES.has(String(status)) || ticket.isComplete === true },
      messages: context.messages.map(({ id, role, at, text }) => ({ id, role, ...(at ? { at } : {}), text })),
      events: [],
    },
  };
}

module.exports = { buildTicketContext, buildConversationRequest, cleanMessageText, replaceNames, roleOfComment, describeEvent, CUSTOMER_PLACEHOLDER, DEFAULT_LIMITS };
