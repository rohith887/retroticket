// Needs a local MongoDB. Uses its own database (MONGODB_TEST_URI, default mongodb://localhost:27017/pp_test) and skips if unreachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Thread = require('../src/models/Thread');
const Message = require('../src/models/Message');
const ReadState = require('../src/models/ReadState');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const { withUserUnread, markThreadRead, markTicketRead } = require('../src/lib/unread');

// Each test file gets its own database: node runs test files in parallel and each one drops its database when done.
const uri = (process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/pp_test').replace(/\/pp_test$/, '/pp_test_seq');
let connected = false;

test.before(async () => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    await Promise.all([Thread.syncIndexes(), Message.syncIndexes(), ReadState.syncIndexes(), Ticket.syncIndexes(), Comment.syncIndexes()]);
    connected = true;
  } catch {
    connected = false;
  }
});
test.after(async () => {
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const msg = (threadId, extra = {}) => ({ threadId, direction: 'inbound', channel: 'email', sender: { name: 'Customer', email: 'c@example.com', type: 'external' }, body: 'hello', ...extra });

test('concurrent writers never get the same seq', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const thread = await Thread.create({ sourceCaseId: 'APP-SEQ-1' });
  const created = await Promise.all(Array.from({ length: 25 }, () => Message.create(msg(thread._id))));
  const seqs = created.map((m) => m.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
  const fresh = await Thread.findById(thread._id).lean();
  assert.equal(fresh.lastSeq, 25);
});

test('unread is per user and the author has read their own message', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const thread = await Thread.create({ sourceCaseId: 'APP-SEQ-2' });
  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  await Message.create(msg(thread._id));
  await Message.create(msg(thread._id));
  await Message.create(msg(thread._id, { direction: 'outbound', sender: { id: alice, name: 'Alice', type: 'user' } }));
  await new Promise((r) => setTimeout(r, 100)); // author read-state is written after save

  const rows = () => Thread.find({ _id: thread._id }).lean();
  assert.equal((await withUserUnread(await rows(), alice))[0].unreadCount, 0); // wrote the latest message
  assert.equal((await withUserUnread(await rows(), bob))[0].unreadCount, 3); // has read nothing

  await markThreadRead(bob, (await rows())[0]);
  assert.equal((await withUserUnread(await rows(), bob))[0].unreadCount, 0);
  // Bob reading does not change Alice's state.
  await Message.create(msg(thread._id));
  assert.equal((await withUserUnread(await rows(), alice))[0].unreadCount, 1);
  assert.equal((await withUserUnread(await rows(), bob))[0].unreadCount, 1);
});

const ticketDoc = (n) => ({ name: 'Priya', number: `T-${n}`, title: 'Help', detail: 'Please help', email: 'priya@example.com' });

test('ticket comments get unique seq numbers, update the preview and track unread per user', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const ticket = await Ticket.create(ticketDoc(Date.now()));
  const agent = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  const made = await Promise.all(Array.from({ length: 10 }, (_, i) => Comment.create({ ticketId: ticket._id, text: `customer reply ${i}`, public: true })));
  assert.deepEqual(made.map((c) => c.seq).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await Comment.create({ ticketId: ticket._id, text: 'We are on it', public: true, userId: agent });
  await new Promise((r) => setTimeout(r, 100));

  const fresh = () => Ticket.find({ _id: ticket._id }).lean();
  assert.equal((await fresh())[0].lastMessage, 'We are on it');
  assert.equal((await withUserUnread(await fresh(), agent, 'ticket'))[0].unreadCount, 0); // wrote the latest comment
  assert.equal((await withUserUnread(await fresh(), other, 'ticket'))[0].unreadCount, 11);
  await markTicketRead(other, (await fresh())[0]);
  assert.equal((await withUserUnread(await fresh(), other, 'ticket'))[0].unreadCount, 0);
});
