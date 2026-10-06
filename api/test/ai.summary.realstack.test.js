// Phase 3B real-stack test: the REAL Python engine (spawned uvicorn), the real Node routes and a real MongoDB. No fake service.
// Skips (does not fail) when MongoDB or Python is not reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');

const session = require('../src/lib/session');
const testUser = { _id: new mongoose.Types.ObjectId(), name: 'Anita Agent', email: 'anita@example.com' };
session.checkSession = async () => testUser; // must be patched before the controller is loaded

const ai = require('../src/lib/services/ai.service');
const AiInsight = require('../src/models/AiInsight');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
require('../src/models/User');
const express = require('express');
const aiRoutes = require('../src/controllers/ai');

const TOKEN = 'real-stack-test-token-0123456789';
const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_summary');
const PY_DIR = path.resolve(__dirname, '../../intelligence');
let connected = false;
let python = null;
let pythonUrl = null;
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
      const r = await fetch(`http://127.0.0.1:${port}/ready`);
      if (r.ok) return { child, url: `http://127.0.0.1:${port}` };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  return null;
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
    pythonUrl = started.url;
    process.env.INTELLIGENCE_TOKEN = TOKEN;
    process.env.INTELLIGENCE_URL = pythonUrl;
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
  api.server.closeAllConnections?.();
  api.server.close();
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const ready = (t) => {
  if (!connected) return t.skip('MongoDB not reachable') || false;
  if (!python) return t.skip('Python engine could not be started') || false;
  return true;
};
const makeTicket = () => Ticket.create({ name: 'Priya Sharma', number: `TKT-SUM${Date.now()}${Math.floor(Math.random() * 1000)}`, title: 'Documents', detail: 'Please verify my documents.', email: 'priya@example.com', priority: 'medium' });
const post = (p) => fetch(`${api.url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(`${api.url}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the real engine builds a stored, provenance-carrying summary; claims stay claims; internal notes never appear', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  const first = await Comment.create({ ticketId: ticket._id, text: 'I submitted my passport three times and it was rejected. Mail me at priya@example.com', public: true, direction: 'inbound' });
  await Comment.create({ ticketId: ticket._id, text: 'Customer certificate was rejected twice, escalate to Ravi.', public: false, direction: 'internal', userId: testUser._id });
  await Comment.create({ ticketId: ticket._id, text: 'Please upload a clearer copy of the passport.', public: true, direction: 'outbound', userId: testUser._id });

  const { status, body } = await post(`/tickets/${ticket._id}/summary`);
  assert.equal(status, 200);
  assert.equal(body.success, true, JSON.stringify(body));
  const { insight } = body;
  const texts = insight.summary.lines.map((l) => l.text);
  assert.ok(texts.includes('The customer says they submitted the passport three times and it was rejected.'), texts.join(' | '));
  assert.ok(texts.some((x) => x.startsWith('The ticket status is')));
  assert.ok(!texts.join(' ').includes('certificate'), 'internal notes never reach the summary');
  const claim = insight.summary.lines.find((l) => l.section === 'claim');
  assert.equal(claim.sources[0].messageId, String(first._id));
  assert.equal(claim.review, 'needs_review');
  assert.ok(insight.warnings.some((w) => /draft knowledge pack/.test(w)));
  assert.equal(insight.summary.state.state, 'awaiting_customer');
  assert.match(insight.knowledgeVersion, /^verification-support@0\.1\.0\+/);
  assert.equal(insight.stale, false);

  const stored = await AiInsight.findById(insight._id).lean();
  assert.equal(stored.type, 'summary');
  assert.equal(stored.audience, 'agent');
  assert.equal(stored.usedInternalNotes, false);
  assert.equal(stored.confidence, undefined);
  assert.ok(stored.contextHash && stored.engineVersion && stored.componentVersions['rules-state']);
  const serialised = JSON.stringify(stored);
  assert.ok(!serialised.includes('priya@example.com') && !serialised.includes('submitted my passport'), 'no raw customer text is stored');
});

test('the same conversation reuses the stored summary; a new message creates a new one and the old one is marked stale', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await Comment.create({ ticketId: ticket._id, text: 'Any update on this?', public: true, direction: 'inbound' });
  const one = await post(`/tickets/${ticket._id}/summary`);
  const two = await post(`/tickets/${ticket._id}/summary`);
  assert.equal(one.body.reused, false);
  assert.equal(two.body.reused, true);
  assert.equal(two.body.insight._id, one.body.insight._id);
  assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'summary' }), 1);

  await Comment.create({ ticketId: ticket._id, text: 'The passport was rejected again.', public: true, direction: 'inbound' });
  const stale = await get(`/tickets/${ticket._id}/summary`);
  assert.equal(stale.body.insight.stale, true);
  const three = await post(`/tickets/${ticket._id}/summary`);
  assert.equal(three.body.reused, false);
  assert.equal(three.body.insight.stale, false);
  assert.notEqual(three.body.insight._id, one.body.insight._id);
});

test('a resolved ticket is summarised as resolved from Node data, and the summary route changes nothing on the ticket', async (t) => {
  if (!ready(t)) return;
  const ticket = await makeTicket();
  await Comment.create({ ticketId: ticket._id, text: 'Thank you for your assistance.', public: true, direction: 'inbound' });
  await Ticket.updateOne({ _id: ticket._id }, { $set: { isComplete: true, status: 'resolved' } });
  const before = await Ticket.findById(ticket._id).lean();
  const { body } = await post(`/tickets/${ticket._id}/summary`);
  assert.equal(body.insight.summary.state.state, 'resolved');
  assert.equal(body.insight.summary.state.ruleId, 'R1');
  const after = await Ticket.findById(ticket._id).lean();
  assert.equal(after.status, before.status);
  assert.equal(after.priority, before.priority);
  assert.equal(await Comment.countDocuments({ ticketId: ticket._id }), 1); // AI never sends or writes messages
});

test('when the engine is down the route reports it and ticketing data is untouched', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await makeTicket();
  await Comment.create({ ticketId: ticket._id, text: 'Any update on this?', public: true, direction: 'inbound' });
  const saved = process.env.INTELLIGENCE_URL;
  process.env.INTELLIGENCE_TOKEN = TOKEN;
  process.env.INTELLIGENCE_URL = 'http://127.0.0.1:1';
  ai.resetCircuit();
  try {
    const { status, body } = await post(`/tickets/${ticket._id}/summary`);
    assert.equal(status, 200);
    assert.equal(body.success, false);
    assert.equal(body.available, false);
    assert.equal(await AiInsight.countDocuments({ ticketId: ticket._id, type: 'summary' }), 0);
  } finally {
    if (saved) process.env.INTELLIGENCE_URL = saved;
    ai.resetCircuit();
  }
});

test('an unknown ticket is a 404 and an invalid id a 400', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  assert.equal((await post(`/tickets/${new mongoose.Types.ObjectId()}/summary`)).status, 404);
  assert.equal((await post('/tickets/not-an-id/summary')).status, 400);
});
