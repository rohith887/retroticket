// Node <-> Python intelligence integration. The Python service is replaced by a small fake HTTP server, so these tests need
// only MongoDB (MONGODB_TEST_URI, default mongodb://localhost:27017/pp_test) and skip if it is unreachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

const session = require('../src/lib/session');
const testUser = { _id: new mongoose.Types.ObjectId(), name: 'Anita Agent', email: 'anita@example.com' };
session.checkSession = async () => testUser; // must be patched before the controller is loaded

const ai = require('../src/lib/services/ai.service');
const AiInsight = require('../src/models/AiInsight');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const Activity = require('../src/models/Activity');
require('../src/models/User'); // registered so reviewer names can be populated
const express = require('express');
const aiRoutes = require('../src/controllers/ai');

const TOKEN = 'node-to-python-test-token-123456';
// Each test file gets its own database: node runs test files in parallel and each one drops its database when done.
const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_ai');
let connected = false;
let fake; // { server, url, hits, mode }
let api; // { server, url }

const goodBody = (over = {}) => ({
  sentiment: { label: 'frustrated', confidence: 0.92 },
  intent: { label: 'document_issue', confidence: 0.71, alternatives: [] },
  priority: { label: 'high', confidence: 0.78, reasons: ['Repeated failed attempts or no response so far'] },
  meta: { provider: 'local_rules', model: 'rules-lexicon', version: '1.0', latencyMs: 2.5, requestId: 'req-test-0001' },
  ...over,
});

function startFake() {
  const state = { hits: [], mode: 'ok', body: goodBody(), delayMs: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      state.hits.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      if (req.url === '/ready') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ready"}');
      const reply = () => {
        if (state.mode === 'forbidden') return res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":{"code":"forbidden"}}');
        if (state.mode === 'limited') return res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"error":{"code":"rate_limited"}}');
        if (state.mode === 'error') return res.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":{"code":"provider_error"}}');
        if (state.mode === 'garbage') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('not json at all');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state.body));
      };
      state.delayMs ? setTimeout(reply, state.delayMs) : reply();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, state })));
}

test.before(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    await Promise.all([AiInsight.syncIndexes(), Ticket.syncIndexes(), Comment.syncIndexes()]);
    // The signed-in test user exists in the database, so reviewer names resolve like they do in production.
    await mongoose.connection.collection('users').insertOne({ _id: testUser._id, name: testUser.name, email: testUser.email });
    connected = true;
  } catch {
    connected = false;
  }
  fake = await startFake();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { _id: testUser._id, isAdmin: true };
    next();
  });
  app.use('/api/v1/ai', aiRoutes);
  await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      api = { server, url: `http://127.0.0.1:${server.address().port}/api/v1/ai` };
      resolve();
    });
  });
});

test.after(async () => {
  fake.server.closeAllConnections?.();
  fake.server.close();
  api.server.closeAllConnections?.();
  api.server.close();
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test.beforeEach(() => {
  process.env.INTELLIGENCE_TOKEN = TOKEN;
  process.env.INTELLIGENCE_URL = fake.url;
  process.env.AI_TIMEOUT_MS = '1500';
  process.env.AI_FAILURE_THRESHOLD = '3';
  process.env.AI_CIRCUIT_COOLDOWN_MS = '60000';
  delete process.env.AI_ENABLED;
  delete process.env.AI_AUTO_ANALYZE;
  fake.state.mode = 'ok';
  fake.state.body = goodBody();
  fake.state.delayMs = 0;
  fake.state.hits.length = 0;
  ai.resetCircuit();
});

const newTicket = (extra = {}) =>
  Ticket.create({ name: 'Priya Sharma', number: `TKT-AI${Date.now()}${Math.floor(Math.random() * 1000)}`, title: 'Documents', detail: 'I have already submitted this document three times and nobody has fixed the problem. Reach me at priya@example.com or +91 98765 43210.', email: 'priya@example.com', priority: 'medium', ...extra });

const call = (path, body) => fetch(`${api.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));

/* ------------------------------ data minimisation ------------------------------ */

test('sanitizeForAi masks emails, phone numbers, ids, links, tokens and passwords, and drops quoted text', () => {
  const out = ai.sanitizeForAi(
    'Hi, mail me at priya@example.com or call +91 98765 43210. My case is 20260606142029642, see https://portal.example.com/x?token=abc. ' +
      'password: hunter2 and Bearer eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMe\n> earlier quoted message\nOn Mon, 1 Jan Someone wrote:\n> more'
  );
  for (const secret of ['priya@example.com', '98765', '20260606142029642', 'portal.example.com', 'hunter2', 'eyJhbGciOi', 'earlier quoted']) {
    assert.ok(!out.includes(secret), `still contains ${secret}: ${out}`);
  }
  assert.match(out, /\[email\]/);
  assert.match(out, /\[secret\]/);
});

test('sanitizeForAi truncates long text', () => {
  assert.ok(ai.sanitizeForAi('word '.repeat(5000)).length <= 6000);
});

/* ------------------------------ the call itself ------------------------------ */

test('a successful analysis stores one insight per type with provider details, and sends only sanitised text', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  const result = await ai.analyzeMessage({ ticketId: ticket._id, text: ticket.detail, requestedBy: testUser._id });
  assert.equal(result.ok, true);
  assert.deepEqual(result.insights.map((i) => i.type).sort(), ['intent', 'priority', 'sentiment']);

  const stored = await AiInsight.find({ ticketId: ticket._id }).lean();
  assert.equal(stored.length, 3);
  const priority = stored.find((i) => i.type === 'priority');
  assert.equal(priority.result.label, 'high');
  assert.equal(priority.confidence, 0.78);
  assert.equal(priority.provider, 'local_rules');
  assert.equal(priority.model, 'rules-lexicon');
  assert.equal(priority.requestId, 'req-test-0001');
  assert.equal(priority.status, 'suggested');
  assert.equal(new Set(stored.map((i) => i.analysisId)).size, 1);

  // What Python received: bearer token, only the analyze endpoint, masked personal data, opaque ids.
  const hit = fake.state.hits.find((h) => h.path === '/api/v1/analyze-message');
  assert.equal(hit.method, 'POST');
  assert.equal(hit.auth, `Bearer ${TOKEN}`);
  assert.ok(!/priya@example|98765/.test(hit.body.text), hit.body.text);
  assert.deepEqual(Object.keys(hit.body).sort(), ['text', 'ticketId']);
});

test('the original ticket is untouched by an analysis', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  await ai.analyzeMessage({ ticketId: ticket._id, text: ticket.detail });
  const after = await Ticket.findById(ticket._id).lean();
  assert.equal(after.priority, 'medium');
  assert.equal(after.detail, ticket.detail);
});

test('low confidence results are stored and flagged', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.body = goodBody({ priority: { label: 'medium', confidence: 0.3, reasons: ['Weak signal'] } });
  const ticket = await newTicket();
  const result = await ai.analyzeMessage({ ticketId: ticket._id, text: 'maybe an issue' });
  assert.equal(result.insights.find((i) => i.type === 'priority').lowConfidence, true);
  assert.equal(result.insights.find((i) => i.type === 'sentiment').lowConfidence, false);
});

/* ------------------------------ failure handling ------------------------------ */

const expectFailure = async (reason) => {
  const ticket = await newTicket();
  const result = await ai.analyzeMessage({ ticketId: ticket._id, text: 'Please check my documents' });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason });
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id }), 0);
};

test('not configured: no request is made', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  delete process.env.INTELLIGENCE_TOKEN;
  await expectFailure('disabled');
  assert.equal(fake.state.hits.length, 0);
});

test('explicitly disabled: no request is made', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.AI_ENABLED = 'false';
  await expectFailure('disabled');
  assert.equal(fake.state.hits.length, 0);
});

test('service down (connection refused) is a soft failure', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:9';
  await expectFailure('unavailable');
});

test('slow service times out', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.AI_TIMEOUT_MS = '250';
  fake.state.delayMs = 900;
  await expectFailure('timeout');
});

test('invalid model output is rejected, not stored', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.body = goodBody({ priority: { label: 'apocalyptic', confidence: 0.9, reasons: [] } });
  await expectFailure('invalid_response');
  fake.state.body = goodBody({ sentiment: { label: 'positive', confidence: 7 } });
  ai.resetCircuit();
  await expectFailure('invalid_response');
});

test('non-JSON output is rejected', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.mode = 'garbage';
  await expectFailure('invalid_response');
});

test('wrong service credential is reported as unauthorized and does not trip the circuit breaker', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.mode = 'forbidden';
  for (let i = 0; i < 4; i += 1) await expectFailure('unauthorized');
  assert.equal(fake.state.hits.length, 4, 'a configuration error must keep reporting itself, not go quiet');
});

test('rate limited and provider errors are soft failures', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.mode = 'limited';
  await expectFailure('rate_limited');
  ai.resetCircuit();
  fake.state.mode = 'error';
  await expectFailure('provider_error');
});

test('after repeated failures the circuit opens and calls stop reaching the service until it recovers', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  fake.state.mode = 'error';
  for (let i = 0; i < 3; i += 1) await expectFailure('provider_error');
  const before = fake.state.hits.length;
  await expectFailure('circuit_open');
  assert.equal(fake.state.hits.length, before, 'no request while the circuit is open');
  ai.resetCircuit();
  fake.state.mode = 'ok';
  const ticket = await newTicket();
  assert.equal((await ai.analyzeMessage({ ticketId: ticket._id, text: 'hello there' })).ok, true);
});

/* ------------------------------ ticketing never depends on AI ------------------------------ */

test('an incoming customer message is stored even when the AI service is down (auto-analysis on)', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.AI_AUTO_ANALYZE = 'true';
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:9';
  const rejections = [];
  const onRejection = (e) => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    const ticket = await newTicket();
    const comment = await Comment.create({ ticketId: ticket._id, text: 'Still not fixed!', public: true, direction: 'inbound', authorEmail: 'priya@example.com' });
    assert.ok(comment._id, 'the message exists');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await Comment.findById(comment._id).lean()).text, 'Still not fixed!');
    assert.equal((await Ticket.findById(ticket._id).lean()).lastMessage, 'Still not fixed!');
    assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id }), 0);
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('with the service up, auto-analysis stores insights in the background', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.AI_AUTO_ANALYZE = 'true';
  const ticket = await newTicket();
  await Comment.create({ ticketId: ticket._id, text: 'Nobody has replied yet', public: true, direction: 'inbound' });
  for (let i = 0; i < 20 && (await AiInsight.countDocuments({ ticketId: ticket._id })) < 3; i += 1) await new Promise((r) => setTimeout(r, 100));
  const stored = await AiInsight.find({ ticketId: ticket._id }).lean();
  assert.equal(stored.length, 3);
  assert.ok(stored.every((i) => i.trigger === 'auto'));
});

test('outgoing agent messages are never sent for analysis', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.AI_AUTO_ANALYZE = 'true';
  const ticket = await newTicket();
  await Comment.create({ ticketId: ticket._id, text: 'We are looking into it', public: true, direction: 'outbound', userId: testUser._id });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fake.state.hits.filter((h) => h.path === '/api/v1/analyze-message').length, 0);
});

test('the analyze route answers 200 with success:false when AI is unavailable, and the ticket is fine', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:9';
  const ticket = await newTicket();
  const { status, body } = await call(`/tickets/${ticket._id}/analyze`);
  assert.equal(status, 200);
  assert.deepEqual({ success: body.success, available: body.available, reason: body.reason }, { success: false, available: false, reason: 'unavailable' });
  assert.equal((await Ticket.findById(ticket._id).lean()).priority, 'medium');
});

test('status endpoint reports configured and available', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ok = await fetch(`${api.url}/status`).then((r) => r.json());
  assert.deepEqual({ enabled: ok.enabled, available: ok.available }, { enabled: true, available: true });
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:9';
  const down = await fetch(`${api.url}/status`).then((r) => r.json());
  assert.deepEqual({ enabled: down.enabled, available: down.available }, { enabled: true, available: false });
});

/* ------------------------------ Node owns the decision ------------------------------ */

test('analysing through the API stores insights, and nothing changes until a user accepts', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  const analysed = await call(`/tickets/${ticket._id}/analyze`);
  assert.equal(analysed.body.success, true);
  assert.equal(analysed.body.insights.length, 3);
  assert.equal((await Ticket.findById(ticket._id).lean()).priority, 'medium');
});

test('accepting a priority suggestion updates the ticket, logs the user on the timeline and records who accepted', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  const analysed = await call(`/tickets/${ticket._id}/analyze`);
  const priority = analysed.body.insights.find((i) => i.type === 'priority');

  const accepted = await call(`/insights/${priority._id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.insight.status, 'accepted');
  assert.deepEqual(accepted.body.insight.applied, { priority: { from: 'medium', to: 'high' } });
  assert.equal(accepted.body.insight.reviewedBy.name, 'Anita Agent');
  assert.ok(accepted.body.insight.reviewedAt);
  const reread = await fetch(`${api.url}/tickets/${ticket._id}/insights`).then((r) => r.json());
  assert.equal(reread.insights.find((i) => i.type === 'priority').reviewedBy.name, 'Anita Agent');
  assert.equal(reread.insights.find((i) => i.type === 'sentiment').reviewedBy, null);

  assert.equal((await Ticket.findById(ticket._id).lean()).priority, 'high');
  const stored = await AiInsight.findById(priority._id).lean();
  assert.equal(String(stored.acceptedBy), String(testUser._id));
  assert.ok(stored.acceptedAt);
  const events = await Activity.find({ ticketId: ticket._id, type: 'priority_changed' }).lean();
  assert.equal(events.length, 1);
  assert.equal(events[0].actor.name, 'Anita Agent');
  assert.equal(events[0].data.via, 'ai_suggestion');

  assert.equal((await call(`/insights/${priority._id}/accept`)).status, 409, 'cannot be accepted twice');
});

test('accepting sentiment or intent records the review and changes nothing on the ticket', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  const analysed = await call(`/tickets/${ticket._id}/analyze`);
  const sentiment = analysed.body.insights.find((i) => i.type === 'sentiment');
  const before = await Ticket.findById(ticket._id).lean();
  assert.equal((await call(`/insights/${sentiment._id}/accept`)).status, 200);
  const after = await Ticket.findById(ticket._id).lean();
  assert.equal(after.priority, before.priority);
  assert.equal(await Activity.countDocuments({ ticketId: ticket._id, type: 'priority_changed' }), 0);
});

test('dismissing leaves the ticket alone and cannot be undone by accepting', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  const analysed = await call(`/tickets/${ticket._id}/analyze`);
  const priority = analysed.body.insights.find((i) => i.type === 'priority');
  assert.equal((await call(`/insights/${priority._id}/dismiss`)).body.insight.status, 'dismissed');
  assert.equal((await call(`/insights/${priority._id}/accept`)).status, 409);
  assert.equal((await Ticket.findById(ticket._id).lean()).priority, 'medium');
});

test('the latest insights and the history can be read back', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  await call(`/tickets/${ticket._id}/analyze`);
  await call(`/tickets/${ticket._id}/analyze`);
  const latest = await fetch(`${api.url}/tickets/${ticket._id}/insights`).then((r) => r.json());
  assert.equal(latest.insights.length, 3);
  const history = await fetch(`${api.url}/tickets/${ticket._id}/insights?history=1`).then((r) => r.json());
  assert.equal(history.insights.length, 6);
});

test('Node only ever calls the analyze and ready endpoints on the service (it is never asked to change anything)', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await newTicket();
  await call(`/tickets/${ticket._id}/analyze`);
  await fetch(`${api.url}/status`);
  const paths = new Set(fake.state.hits.map((h) => `${h.method} ${h.path}`));
  assert.deepEqual([...paths].sort(), ['GET /ready', 'POST /api/v1/analyze-message']);
});
