// Needs a local MongoDB (see seq.integration.test.js). SMTP is stubbed; nothing is sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.TICKET_UNDO_SEND_SECONDS = '30';
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const OutboundEmailJob = require('../src/models/OutboundEmailJob');
const { MailService } = require('../src/lib/services/smtp.service');
const { OutboundEmailQueueService } = require('../src/lib/services/outboundEmailQueue.service');
const { sendTicketReply, cancelTicketReply, retryTicketReply } = require('../src/lib/ticketMail');

// Each test file gets its own database: node runs test files in parallel and each one drops its database when done.
const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_mail');
let connected = false;
const sent = [];

test.before(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    connected = true;
    await mongoose.connection.collection('emailqueues').insertOne({ name: 'Support', active: true, isDeleted: false, username: 'support@example.com', serviceType: 'gmail', createdAt: new Date() });
  } catch {
    connected = false;
  }
  MailService.sendEmail = async (mail) => {
    if (MailService.failNext) throw new Error('SMTP down');
    sent.push(mail);
    return { messageId: `<sent-${sent.length}@example.com>` };
  };
  MailService.persistSentEmail = async () => null;
});
test.after(async () => {
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function newReply(text = 'We are looking into it') {
  const ticket = await Ticket.create({ name: 'Priya', number: `TKT-${Date.now()}${Math.floor(Math.random() * 1000)}`, title: 'Help', detail: 'Please help', email: 'priya@example.com' });
  const comment = await Comment.create({ ticketId: ticket._id, text, public: true, userId: new mongoose.Types.ObjectId(), direction: 'outbound' });
  return { ticket, comment };
}

test('a public reply is queued behind an undo window, and undo cancels it', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const { ticket, comment } = await newReply();
  const result = await sendTicketReply({ ticket, comment, actor: { id: 'u1', name: 'Agent' } });
  assert.equal(result.queued, true);
  assert.ok(result.sendAfter > new Date());

  const fresh = await Comment.findById(comment._id).lean();
  assert.equal(fresh.delivery.status, 'queued');
  // Not claimable while the undo window is open.
  assert.equal(await OutboundEmailQueueService.claimNextJob('w1'), null);

  assert.equal(await cancelTicketReply(comment._id), true);
  assert.equal((await Comment.findById(comment._id).lean()).delivery.status, 'canceled');
  assert.equal(await cancelTicketReply(comment._id), false); // already canceled
  assert.equal(await OutboundEmailQueueService.claimNextJob('w1'), null);
});

test('queueing the same comment twice creates one job (idempotent)', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const { ticket, comment } = await newReply();
  await sendTicketReply({ ticket, comment, actor: {} });
  await sendTicketReply({ ticket, comment, actor: {} });
  assert.equal(await OutboundEmailJob.countDocuments({ idempotencyKey: `comment:${comment._id}` }), 1);
});

test('after the window the worker sends it, marks it sent, and undo is refused', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const { ticket, comment } = await newReply();
  await sendTicketReply({ ticket, comment, actor: {} });
  await OutboundEmailJob.updateOne({ idempotencyKey: `comment:${comment._id}` }, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });

  const job = await OutboundEmailQueueService.claimNextJob('w1');
  assert.ok(job);
  assert.equal(await cancelTicketReply(comment._id), false); // claimed: too late
  await OutboundEmailQueueService.processJob(job, 'w1');

  const done = await Comment.findById(comment._id).lean();
  assert.equal(done.delivery.status, 'sent');
  const mail = sent[sent.length - 1];
  assert.equal(mail.to, 'priya@example.com');
  assert.ok(mail.subject.includes(`[${ticket.number}]`));
});

test('a failing send ends as failed after the last attempt, and retry re-queues it', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const { ticket, comment } = await newReply();
  await sendTicketReply({ ticket, comment, actor: {} });
  await OutboundEmailJob.updateOne({ idempotencyKey: `comment:${comment._id}` }, { $set: { nextRetryAt: new Date(Date.now() - 1000), maxAttempts: 1 } });

  const job = await OutboundEmailQueueService.claimNextJob('w1');
  MailService.failNext = true;
  try {
    await OutboundEmailQueueService.processJob(job, 'w1');
    assert.fail('expected the send to throw');
  } catch (error) {
    await OutboundEmailQueueService.failJob(job, error, 'w1');
  } finally {
    MailService.failNext = false;
  }
  const failed = await Comment.findById(comment._id).lean();
  assert.equal(failed.delivery.status, 'failed');
  assert.match(failed.delivery.lastError, /SMTP down/);

  assert.equal(await retryTicketReply(comment._id), true);
  assert.equal((await Comment.findById(comment._id).lean()).delivery.status, 'queued');
});

test('activity events are stored in order and never throw', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const { logActivity, actorFrom } = require('../src/lib/activity');
  const Activity = require('../src/models/Activity');
  const ticket = await Ticket.create({ name: 'Priya', number: `TKT-A${Date.now()}`, title: 'Help', detail: 'Please help', email: 'priya@example.com' });
  const agent = { _id: new mongoose.Types.ObjectId(), name: 'Anita' };
  await logActivity(ticket._id, 'ticket_created', { type: 'contact', id: null, name: 'Priya' }, {});
  await logActivity(ticket._id, 'assigned', actorFrom(agent), { from: null, to: { id: String(agent._id), name: 'Anita' } });
  await logActivity(ticket._id, 'priority_changed', actorFrom(agent), { from: 'medium', to: 'high' });
  const list = await Activity.find({ ticketId: ticket._id }).sort({ at: 1 }).lean();
  assert.deepEqual(list.map((a) => a.type), ['ticket_created', 'assigned', 'priority_changed']);
  assert.equal(list[2].data.to, 'high');
  // Invalid input is swallowed, not thrown.
  assert.equal(await logActivity('not-an-id', 'assigned', null, {}), null);
  assert.equal(await logActivity(ticket._id, 'not_a_type', null, {}), null);
});
