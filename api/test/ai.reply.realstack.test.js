// Phase 3C real-stack test: the REAL Python engine (spawned uvicorn), the real Node routes and a real MongoDB.
// A thin pass-through proxy sits between Node and Python only to record what Node sends and, in two tests, to tamper with
// Python's answer or to add a message mid-request. Skips (does not fail) when MongoDB or Python is not reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');

const session = require('../src/lib/session');
const testUser = { _id: new mongoose.Types.ObjectId(), name: 'Anita Agent', email: 'anita@example.com', signature: 'Anita\nSupport Team' };
session.checkSession = async () => testUser; // must be patched before the controller is loaded

const ai = require('../src/lib/services/ai.service');
const AiInsight = require('../src/models/AiInsight');
const AuditLog = require('../src/models/AuditLog');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const OutboundEmailJob = require('../src/models/OutboundEmailJob');
require('../src/models/User');
const express = require('express');
const aiRoutes = require('../src/controllers/ai');

const TOKEN = 'real-stack-reply-token-0123456789';
const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_reply');
const PY_DIR = path.resolve(__dirname, '../../intelligence');
let connected = false;
let python = null;
let proxy = null; // { server, url, sent[], hook }
let api;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

async function startPython() {
  const port = await freePort();
  const child = spawn(process.env.PYTHON || 'python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
    cwd: PY_DIR,
    env: { ...process.env, INTERNAL_SERVICE_TOKEN: TOKEN, RATE_LIMIT_PER_MINUTE: '0' },
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => (exited = true));
  child.on('error', () => (exited = true));
  for (let i = 0; i < 60 && !exited; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return { child, url: `http://127.0.0.1:${port}` };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  return null;
}

async function startProxy(target) {
  const state = { sent: [], hook: null, tamper: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : null;
      if (body) state.sent.push({ path: req.url, body });
      if (state.hook && req.url === '/api/v1/reply-draft') await state.hook();
      const upstream = await fetch(`${target}${req.url}`, { method: req.method, headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: raw || undefined });
      let json = await upstream.json();
      if (state.tamper && req.url === '/api/v1/reply-draft') json = state.tamper(json);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

test.before(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    await AiInsight.syncIndexes();
    connected = true;
  } catch {
    connected = false;
  }
  const started = await startPython();
  if (started) {
    python = started.child;
    proxy = await startProxy(started.url);
    process.env.INTELLIGENCE_TOKEN = TOKEN;
    process.env.INTELLIGENCE_URL = proxy.url;
    process.env.AI_TIMEOUT_MS = '5000';
    delete process.env.AI_ENABLED;
    ai.resetCircuit();
  }
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
  if (python) python.kill();
  proxy?.server.closeAllConnections?.();
  proxy?.server.close();
  api.server.closeAllConnections?.();
  api.server.close();
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test.beforeEach(() => {
  if (!proxy) return;
  proxy.state.sent.length = 0;
  proxy.state.hook = null;
  proxy.state.tamper = null;
  process.env.INTELLIGENCE_URL = proxy.url;
  ai.resetCircuit();
});

const ready = (t) => {
  if (!connected) return t.skip('MongoDB not reachable') || false;
  if (!python) return t.skip('Python engine could not be started') || false;
  return true;
};
const makeTicket = () => Ticket.create({ name: 'Priya Sharma', number: `TKT-RPL${Date.now()}${Math.floor(Math.random() * 1000)}`, title: 'Documents', detail: 'Please verify my documents.', email: 'priya@example.com', priority: 'medium' });
const inbound = (ticket, text) => Comment.create({ ticketId: ticket._id, text, public: true, direction: 'inbound' });
const post = (p, body = {}) => fetch(`${api.url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(`${api.url}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const CLAIM = 'I submitted my passport three times and it was rejected. There is a document issue. Reach me at priya@example.com';

test('a customer message produces an editable draft with only supported claims, provenance and Node-added name and signature', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  const message = await inbound(ticket, CLAIM);
  const { status, body } = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(status, 200);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.status, 'ready');
  const draft = body.insight;
  assert.ok(draft.body.includes('You mentioned that you submitted your passport three times and that it was rejected.'));
  assert.ok(draft.text.startsWith('Hi Priya,\n\n'), draft.text);
  assert.ok(draft.text.endsWith('\n\nAnita\nSupport Team'));
  assert.ok(!/we (received|rejected)|will be|within|refund|approved/i.test(draft.body), draft.body);
  assert.ok(!draft.body.includes('priya@example.com'));
  const claim = draft.sentences.find((s) => s.source.type === 'claim' && s.source.messageId);
  assert.equal(claim.source.messageId, String(message._id));
  assert.ok(claim.source.factIds.length >= 1);
  assert.ok(draft.sentences.every((s) => s.source.patternId && ['claim', 'pattern', 'verified_fact'].includes(s.source.type)));
  assert.equal(draft.stale, false);
  assert.ok(draft.warnings.some((w) => /draft reply patterns/.test(w)));

  const stored = await AiInsight.findById(draft._id).lean();
  assert.equal(stored.type, 'reply_draft');
  assert.equal(stored.audience, 'customer');
  assert.equal(stored.usedInternalNotes, false);
  assert.equal(stored.confidence, undefined);
  assert.equal(stored.basedOnSeq, 1);
  assert.ok(stored.contextHash && stored.engineVersion);
  assert.match(stored.knowledgeVersion, /^verification-support@0\.1\.0\+5d4e92e70ad1$/);
  assert.match(stored.componentVersions['reply-patterns'], /^verification-support-replies@0\.1\.0\+/);
  assert.ok(stored.featureSnapshot.reply);
  assert.equal(stored.status, 'suggested');
  const serialised = JSON.stringify(stored);
  assert.ok(!serialised.includes('priya@example.com') && !serialised.includes('submitted my passport'), 'no raw customer text is stored');
});

test('internal notes never influence the draft and are never sent to Python', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, 'There is a problem with my document.');
  await Comment.create({ ticketId: ticket._id, text: 'Customer certificate was rejected twice, escalate to Ravi.', public: false, direction: 'internal', userId: testUser._id });
  const { body } = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(body.status, 'ready');
  assert.ok(!/certificate|Ravi|escalate/i.test(body.insight.text));
  const sent = JSON.stringify(proxy.state.sent);
  assert.ok(!/internal_note|certificate|Ravi/.test(sent), 'Python never received the internal note');
});

test('the same conversation reuses the open draft; a new customer message makes it stale and is never silently reused', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  const one = await post(`/tickets/${ticket._id}/reply-draft`);
  const two = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(one.body.insight.basedOnSeq, 1);
  assert.equal(two.body.reused, true);
  assert.equal(two.body.insight._id, one.body.insight._id);
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 1);

  await inbound(ticket, 'Any update on this?');
  const stale = await get(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(stale.body.insight._id, one.body.insight._id);
  assert.equal(stale.body.insight.stale, true, 'the old draft is marked out of date');

  const fresh = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(fresh.body.reused, false);
  assert.notEqual(fresh.body.insight._id, one.body.insight._id);
  assert.equal(fresh.body.insight.basedOnSeq, 2);
  assert.equal(fresh.body.insight.stale, false);
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 2);
});

test('a message arriving while the engine works makes the draft stale: nothing is stored', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  proxy.state.hook = async () => {
    await inbound(ticket, 'Actually, one more thing.');
  };
  const { body } = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(body.success, false);
  assert.equal(body.reason, 'stale_context');
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 0);
});

test('insufficient context is reported and no insight is created', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, 'The website is not working, error on login.');
  const { body } = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.deepEqual([body.success, body.status, body.reason], [true, 'insufficient_context', 'unsupported_request']);
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 0);

  const agentLast = await makeTicket();
  await inbound(agentLast, 'Any update on this?');
  await Comment.create({ ticketId: agentLast._id, text: 'Please upload the passport.', public: true, direction: 'outbound', userId: testUser._id });
  const second = await post(`/tickets/${agentLast._id}/reply-draft`);
  assert.equal(second.body.status, 'insufficient_context');
  assert.equal(await AiInsight.countDocuments({ ticketId: agentLast._id, type: 'reply_draft' }), 0);
});

test('unsafe or malformed content from the engine is rejected and stored nowhere', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  proxy.state.tamper = (json) => {
    const unsafe = 'We received your passport and it will be approved within 3 days.';
    json.replyDraft.sentences.push({ text: unsafe, source: { type: 'pattern', patternId: 'closing', factIds: [] } });
    json.replyDraft.body += ` ${unsafe}`;
    return json;
  };
  let result = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(result.body.success, false);
  assert.equal(result.body.reason, 'invalid_response');

  proxy.state.tamper = (json) => {
    delete json.replyDraft.sentences;
    return json;
  };
  result = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(result.body.reason, 'invalid_response');

  proxy.state.tamper = (json) => {
    json.replyDraft = { ...json.replyDraft, status: 'validation_failed', body: '', sentences: [], failures: [{ check: 'forbidden_phrase' }] };
    return json;
  };
  result = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(result.body.reason, 'validation_failed');
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 0);
});

test('when Python is down the route reports it, ticketing is untouched and no insight is created', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  const before = await Ticket.findById(ticket._id).lean();
  process.env.INTELLIGENCE_TOKEN = TOKEN;
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:1';
  ai.resetCircuit();
  const { status, body } = await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(status, 200);
  assert.deepEqual([body.success, body.available], [false, false]);
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'reply_draft' }), 0);
  const after = await Ticket.findById(ticket._id).lean();
  assert.deepEqual([after.status, after.priority, after.lastSeq], [before.status, before.priority, before.lastSeq]);
  assert.equal((await get(`/tickets/${ticket._id}/reply-draft`)).status, 200); // normal reads keep working
});

test('drafting never sends or stores a message', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  const jobs = await OutboundEmailJob.countDocuments({});
  await post(`/tickets/${ticket._id}/reply-draft`);
  await post(`/tickets/${ticket._id}/reply-draft`);
  assert.equal(await Comment.countDocuments({ ticketId: ticket._id }), 1);
  assert.equal(await OutboundEmailJob.countDocuments({}), jobs);
  assert.ok(proxy.state.sent.every((s) => s.path === '/api/v1/reply-draft'), 'Node only asks Python for a draft');
});

test('feedback is recorded for later review: used, used after editing, dismissed, and never twice', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await inbound(ticket, CLAIM);
  const { body } = await post(`/tickets/${ticket._id}/reply-draft`);
  const id = body.insight._id;

  assert.equal((await post(`/insights/${id}/feedback`, { event: 'ghost' })).status, 400);
  const used = await post(`/insights/${id}/feedback`, { event: 'used_edited' });
  assert.equal(used.status, 200);
  const stored = await AiInsight.findById(id).lean();
  assert.equal(stored.status, 'accepted');
  assert.deepEqual(stored.feedback.finalValue, { edited: true });
  assert.ok(stored.feedback.editedAt);
  assert.ok(await AuditLog.findOne({ eventType: 'ai_reply_draft_used', entityId: id }));
  assert.equal((await post(`/insights/${id}/feedback`, { event: 'dismissed' })).status, 409);
  assert.equal((await get(`/tickets/${ticket._id}/reply-draft`)).body.insight, null, 'a used draft is no longer offered');

  await inbound(ticket, 'Any update?');
  const next = (await post(`/tickets/${ticket._id}/reply-draft`)).body.insight;
  assert.equal((await post(`/insights/${next._id}/feedback`, { event: 'dismissed' })).status, 200);
  assert.equal((await AiInsight.findById(next._id).lean()).status, 'dismissed');
  assert.ok(await AuditLog.findOne({ eventType: 'ai_reply_draft_dismissed', entityId: next._id }));
  assert.equal((await AiInsight.findById(next._id).lean()).feedback.editedAt, null);
});

test('an unknown ticket is a 404 and an invalid id a 400', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  assert.equal((await post(`/tickets/${new mongoose.Types.ObjectId()}/reply-draft`)).status, 404);
  assert.equal((await post('/tickets/not-an-id/reply-draft')).status, 400);
});
