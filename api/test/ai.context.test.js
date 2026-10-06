// Context builder and sanitizer: pure functions, no database or network.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTicketContext, buildConversationRequest, cleanMessageText, replaceNames, roleOfComment, describeEvent, DEFAULT_LIMITS } = require('../src/lib/ai/contextBuilder');
const { sanitizeForAi } = require('../src/lib/ai/sanitize');

const ticket = (over = {}) => ({ _id: 't1', name: 'Priya Sharma', detail: 'Please verify my address documents.', status: 'open', priority: 'high', createdAt: '2026-09-26T09:00:00Z', lastSeq: 3, createdBy: 'cust1', assignedTo: { _id: 'a1', name: 'Anita Agent' }, ...over });
let n = 0;
const comment = (text, extra = {}) => ({ _id: `c${++n}`, text, public: true, createdAt: new Date(Date.UTC(2026, 8, 26, 10, n)).toISOString(), seq: n, ...extra });
const inbound = (text, extra) => comment(text, { direction: 'inbound', ...extra });
const outbound = (text, extra) => comment(text, { direction: 'outbound', userId: { _id: 'a1', name: 'Anita Agent' }, ...extra });
const note = (text, extra) => comment(text, { direction: 'internal', public: false, userId: { _id: 'a2', name: 'Ravi Menon' }, ...extra });

test.beforeEach(() => {
  n = 0;
});

/* ------------------------------ cleaning ------------------------------ */

test('quoted replies, reply headers, signatures and disclaimers are removed', () => {
  const raw = [
    'Thanks, I uploaded it again.',
    '',
    'Best regards',
    'Priya',
    '-- ',
    'Priya Sharma | Head of X',
    '',
    'On Mon, 1 Jan 2026 at 10:00, Support <support@example.com> wrote:',
    '> Please upload a clearer scan',
  ].join('\n');
  assert.equal(cleanMessageText(raw), 'Thanks, I uploaded it again.\n\nBest regards\nPriya');

  assert.equal(cleanMessageText('Hello\n\nThis email and any attachments is confidential and intended solely for the addressee.'), 'Hello');
  assert.equal(cleanMessageText('Hi there\n\n-----Original Message-----\nFrom: x\nSent: y\nold text'), 'Hi there');
  assert.equal(cleanMessageText('Quick question\nSent from my iPhone'), 'Quick question');
  assert.equal(cleanMessageText('> only a quote'), '');
});

test('known names are replaced whole-word and case-insensitively, longest first', () => {
  assert.equal(replaceNames('Hi Priya Sharma, this is priya. Priyanka is someone else.', ['Priya Sharma'], '{{customer_name}}'), 'Hi {{customer_name}}, this is {{customer_name}}. Priyanka is someone else.');
});

/* ------------------------------ sanitizer ------------------------------ */

test('the sanitizer masks the same canaries the Python side is tested against', () => {
  const canaries = ['priya.sharma@example.com', '+91 98765 43210', '20260606142029642', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'sk-proj-abcdefghijklmnop123456', 'AKIAIOSFODNN7EXAMPLE', '665f1c2ab3d4e5f6a7b8c9d0', 'https://portal.example.com/reset?token=abc123', '192.168.10.24', 'mongodb://admin:hunter2@db.internal:27017/pp'];
  const out = sanitizeForAi(`before ${canaries.join(' and ')} after`);
  for (const value of canaries) assert.ok(!out.includes(value), `${value} survived: ${out}`);
  assert.ok(sanitizeForAi('my password is hunter2 and Authorization: Bearer abcDEF123456').match(/^my \[secret\] and \[secret\]$/) || !/hunter2|abcDEF123456/.test(sanitizeForAi('my password is hunter2 and Authorization: Bearer abcDEF123456')));
  assert.equal(sanitizeForAi('The link expired and I forgot how to reset it.'), 'The link expired and I forgot how to reset it.');
});

/* ------------------------------ roles ------------------------------ */

test('roles: notes are private even when data is ambiguous; legacy comments are classified without a direction', () => {
  const t = ticket();
  assert.equal(roleOfComment(note('x'), t), 'internal_note');
  assert.equal(roleOfComment({ text: 'x', public: false }, t), 'internal_note', 'a comment with public:false is never treated as customer-visible');
  assert.equal(roleOfComment({ text: 'x', public: false, direction: 'outbound' }, t), 'internal_note', 'contradictory data fails safe');
  assert.equal(roleOfComment(inbound('x'), t), 'customer');
  assert.equal(roleOfComment(outbound('x'), t), 'agent');
  assert.equal(roleOfComment({ text: 'x', public: true, userId: { _id: 'cust1' } }, t), 'customer'); // legacy: the person who raised the ticket
  assert.equal(roleOfComment({ text: 'x', public: true, userId: { _id: 'a1' } }, t), 'agent');
});

test('events become short name-free lines and internal details are dropped', () => {
  assert.equal(describeEvent({ type: 'assigned', data: { to: { name: 'Ravi Menon' } } }), 'Ticket assigned to an agent.');
  assert.equal(describeEvent({ type: 'status_changed', data: { from: 'open', to: 'in_progress' } }), 'Status changed from open to in progress.');
  assert.equal(describeEvent({ type: 'delivery_failed', data: { to: 'x@y.com', error: 'SMTP down' } }), null);
  assert.equal(describeEvent({ type: 'client_changed', data: { to: 'Acme' } }), null);
});

/* ------------------------------ building ------------------------------ */

test('a short conversation is included in order, with roles, and reports nothing omitted', () => {
  const ctx = buildTicketContext({ ticket: ticket(), comments: [outbound('We are reviewing it.'), inbound('Thanks, any update?')] });
  assert.deepEqual(ctx.messages.map((m) => m.role), ['customer', 'agent', 'customer']); // description, reply, follow-up
  assert.equal(ctx.omitted.count, 0);
  assert.equal(ctx.omitted.note, undefined);
  assert.equal(ctx.ticketFacts.status, 'open');
  assert.equal(ctx.basedOnSeq, 3);
  assert.equal(ctx.usedInternalNotes, false);
});

test('names never appear in the context: customer becomes a placeholder, agent names are masked', () => {
  const ctx = buildTicketContext({
    ticket: ticket({ detail: 'Hello, this is Priya Sharma about my documents.' }),
    comments: [outbound('Hi Priya, Anita here. We are reviewing it.'), inbound('Thank you Anita, regards Priya')],
    options: { includeInternalNotes: true },
  });
  const all = JSON.stringify(ctx.messages);
  for (const name of ['Priya', 'Sharma', 'Anita']) assert.ok(!all.includes(name), `${name} leaked: ${all}`);
  assert.ok(all.includes('{{customer_name}}') && all.includes('[agent]'));
});

test('replacing names never nests placeholders', () => {
  assert.equal(replaceNames('Hi Anita, Anita Agent here', ['Anita Agent'], '[agent]'), 'Hi [agent], [agent] here');
  const ctx = buildTicketContext({ ticket: ticket(), comments: [outbound('Hi Priya, Anita here.')] });
  assert.ok(!JSON.stringify(ctx.messages).includes('[['), JSON.stringify(ctx.messages));
});

test('sensitive values are masked in every message', () => {
  const ctx = buildTicketContext({ ticket: ticket({ detail: 'Call +91 98765 43210 or mail priya@example.com, case 20260606142029642' }), comments: [inbound('my password is hunter2')] });
  const all = JSON.stringify(ctx.messages);
  for (const secret of ['98765', 'priya@example.com', '20260606142029642', 'hunter2']) assert.ok(!all.includes(secret), secret);
});

test('internal notes are excluded by default (before budgeting) and included only when explicitly requested', () => {
  const comments = [inbound('Where is my refund?'), note('Fraud check pending, do not tell the customer'), outbound('We are checking.')];
  const byDefault = buildTicketContext({ ticket: ticket(), comments });
  assert.ok(!JSON.stringify(byDefault.messages).includes('Fraud check'));
  assert.equal(byDefault.usedInternalNotes, false);
  assert.ok(byDefault.messages.every((m) => m.role !== 'internal_note'));

  const withNotes = buildTicketContext({ ticket: ticket(), comments, options: { includeInternalNotes: true } });
  assert.ok(withNotes.messages.some((m) => m.role === 'internal_note' && m.text.includes('Fraud check')));
  assert.equal(withNotes.usedInternalNotes, true);
});

test('a reply-draft style context (notes excluded, no events) contains no note text and no system lines', () => {
  const comments = [inbound('Hello'), note('SECRET-NOTE-MARKER')];
  const ctx = buildTicketContext({ ticket: ticket(), comments, options: { includeInternalNotes: false, includeActivities: false }, });
  assert.ok(!JSON.stringify(ctx).includes('SECRET-NOTE-MARKER'));
});

test('activities appear as system messages, capped at the newest ten, and never include names', () => {
  const activities = Array.from({ length: 15 }, (_, i) => ({ _id: `e${i}`, type: 'status_changed', at: new Date(Date.UTC(2026, 8, 26, 8, i)).toISOString(), data: { from: 'open', to: 'in_progress' } }));
  activities.push({ _id: 'x', type: 'assigned', at: '2026-09-26T08:30:00Z', data: { to: { name: 'Ravi Menon' } } });
  const ctx = buildTicketContext({ ticket: ticket(), comments: [inbound('hi')], activities });
  const events = ctx.messages.filter((m) => m.role === 'system');
  assert.ok(events.length <= 10);
  assert.ok(!JSON.stringify(events).includes('Ravi'));
});

test('a long individual message is trimmed to head and tail and marked truncated', () => {
  const text = `${'A'.repeat(900)}${'B'.repeat(900)}${'C'.repeat(900)}`;
  const ctx = buildTicketContext({ ticket: ticket({ detail: 'short' }), comments: [inbound(text)] });
  const long = ctx.messages.find((m) => m.truncated);
  assert.ok(long, 'the long message is marked truncated');
  assert.ok(long.text.length <= DEFAULT_LIMITS.headChars + DEFAULT_LIMITS.tailChars + 10);
  assert.ok(long.text.startsWith('AAAA') && long.text.endsWith('CCCC') && long.text.includes('[…]'));
});

test('a long conversation stays within the budget, keeps the first customer message and the newest, and reports what was omitted', () => {
  const comments = Array.from({ length: 80 }, (_, i) => (i % 2 ? outbound(`Agent reply number ${i} ${'x'.repeat(500)}`) : inbound(`Customer message number ${i} ${'y'.repeat(500)}`)));
  const ctx = buildTicketContext({ ticket: ticket({ detail: 'The very first request about my address proof' }), comments });
  assert.ok(ctx.stats.inputChars <= DEFAULT_LIMITS.maxChars, `${ctx.stats.inputChars} > budget`);
  assert.ok(ctx.messages.length <= DEFAULT_LIMITS.maxMessages);
  assert.ok(ctx.messages[0].text.includes('very first request'), 'first customer message kept');
  assert.ok(ctx.messages[ctx.messages.length - 1].text.includes('number 79'), 'newest message kept');
  assert.ok(ctx.omitted.count > 0 && /omitted/.test(ctx.omitted.note));
  assert.equal(ctx.omitted.count + ctx.messages.length, 81, 'every message is either included or counted as omitted');
});

test('the recent tail is contiguous: older messages are dropped, never scattered leftovers', () => {
  const comments = Array.from({ length: 30 }, (_, i) => inbound(`m${String(i).padStart(2, '0')} ${'z'.repeat(1000)}`));
  const ctx = buildTicketContext({ ticket: ticket({ detail: 'first' }), comments, options: { limits: { maxChars: 4500 } } });
  const indices = ctx.messages.map((m) => Number((m.text.match(/^m(\d\d)/) || [])[1])).filter((v) => !Number.isNaN(v));
  for (let i = 1; i < indices.length; i += 1) assert.equal(indices[i], indices[i - 1] + 1, `gap in ${indices}`);
});

test('a tiny budget still returns the newest message, shortened', () => {
  const ctx = buildTicketContext({ ticket: ticket(), comments: [inbound('z'.repeat(1000))], options: { limits: { maxChars: 100 } } });
  assert.equal(ctx.messages.length, 1);
  assert.ok(ctx.stats.inputChars <= 100);
});

test('the context is deterministic: same input, same output and hash; any change alters the hash', () => {
  const comments = [inbound('Hello'), outbound('Hi')];
  const a = buildTicketContext({ ticket: ticket(), comments });
  const b = buildTicketContext({ ticket: ticket(), comments: [...comments].reverse() });
  assert.equal(a.contextHash, b.contextHash);
  assert.deepEqual(a.messages, b.messages);
  assert.notEqual(a.contextHash, buildTicketContext({ ticket: ticket(), comments: [...comments, inbound('another')] }).contextHash);
  assert.notEqual(a.contextHash, buildTicketContext({ ticket: ticket({ status: 'in_progress' }), comments }).contextHash);
});

test('a resolved ticket is reported as resolved, and unusable statuses fall back safely', () => {
  assert.equal(buildTicketContext({ ticket: ticket({ isComplete: true }), comments: [] }).ticketFacts.status, 'resolved');
  assert.match(buildTicketContext({ ticket: ticket({ status: 'DROP TABLE;--' }), comments: [] }).ticketFacts.status, /^[a-z][a-z0-9_ -]*$/);
  assert.equal(buildTicketContext({ ticket: ticket({ status: '123' }), comments: [] }).ticketFacts.status, 'open');
  assert.equal(buildTicketContext({ ticket: ticket({ status: 'in_progress' }), comments: [] }).ticketFacts.status, 'in_progress');
});

test('the request body matches the analyze-conversation contract and carries no identifiers beyond the ticket id', () => {
  const built = buildConversationRequest({ ticket: ticket(), comments: [inbound('Hello there')], activities: [] });
  assert.deepEqual(Object.keys(built.request).sort(), ['events', 'locale', 'messages', 'ticket', 'ticketId']);
  assert.equal(built.request.locale, 'en');
  assert.deepEqual(built.request.ticket, { status: 'open', priority: 'high', isResolved: false });
  for (const m of built.request.messages) assert.deepEqual(Object.keys(m).filter((k) => !['at'].includes(k)).sort(), ['id', 'role', 'text']);
  const serialised = JSON.stringify(built.request);
  for (const forbidden of ['Priya', 'cust1', 'Anita', '@']) assert.ok(!serialised.includes(forbidden), forbidden);
});

test('a resolved ticket is sent as verified-resolved only when Node records it as such', () => {
  const done = buildConversationRequest({ ticket: ticket({ isComplete: true }), comments: [], activities: [] });
  assert.equal(done.request.ticket.isResolved, true);
  const open = buildConversationRequest({ ticket: ticket({ status: 'in_progress' }), comments: [], activities: [] });
  assert.equal(open.request.ticket.isResolved, false);
});
