// One-time (repeatable) backfill for the per-conversation message sequence and read baseline (threads and tickets).
//   node scripts/backfill-thread-seq.js            apply
//   node scripts/backfill-thread-seq.js --dry-run  report only
// For every thread: messages without a seq are numbered after the existing ones in (createdAt, _id) order, the thread's
// nextSeq / lastSeq are set, and readBaselineSeq is set so that threads which had unread messages keep that many unread
// for everyone, while everything older counts as read. Safe to run again: numbered messages are never renumbered.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Thread = require('../src/models/Thread');
const Message = require('../src/models/Message');
const Ticket = require('../src/models/Ticket');
const Comment = require('../src/models/Comment');
const Activity = require('../src/models/Activity');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const cursor = Thread.find({}).select('_id sourceCaseId unreadCount lastSeq readBaselineSeq').lean().cursor();
  let threads = 0;
  let numbered = 0;
  for await (const thread of cursor) {
    threads += 1;
    const top = await Message.findOne({ threadId: thread._id, seq: { $type: 'number' } }).sort({ seq: -1 }).select('seq').lean();
    let seq = Math.max(top?.seq || 0, thread.lastSeq || 0);
    const pending = await Message.find({ threadId: thread._id, seq: { $exists: false } }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
    if (!dryRun && pending.length) {
      const ops = pending.map((m) => ({ updateOne: { filter: { _id: m._id }, update: { $set: { seq: ++seq } } } }));
      await Message.bulkWrite(ops, { ordered: true });
    } else {
      seq += pending.length;
    }
    numbered += pending.length;
    if (!dryRun) {
      const baseline = Math.max(0, seq - (thread.unreadCount || 0));
      await Thread.updateOne(
        { _id: thread._id },
        { $set: { lastSeq: seq, nextSeq: seq + 1 }, $max: { readBaselineSeq: baseline } }
      );
    }
  }
  console.log(`${dryRun ? '[dry run] ' : ''}threads: ${threads}, messages numbered: ${numbered}`);

  // Tickets: number comments per ticket, set the inbox preview, and treat everything existing as read.
  let tickets = 0;
  let comments = 0;
  let created = 0;
  const ticketCursor = Ticket.find({}).select('_id name createdAt lastSeq lastMessageAt').lean().cursor();
  for await (const ticket of ticketCursor) {
    tickets += 1;
    const top = await Comment.findOne({ ticketId: ticket._id, seq: { $type: 'number' } }).sort({ seq: -1 }).select('seq').lean();
    let seq = Math.max(top?.seq || 0, ticket.lastSeq || 0);
    const pending = await Comment.find({ ticketId: ticket._id, seq: { $exists: false } }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
    if (!dryRun && pending.length) {
      await Comment.bulkWrite(pending.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { seq: ++seq } } } })), { ordered: true });
    } else {
      seq += pending.length;
    }
    comments += pending.length;
    // Every ticket gets a "created" event at its creation time so the activity timeline starts at the beginning.
    if (!(await Activity.exists({ ticketId: ticket._id, type: 'ticket_created' }))) {
      created += 1;
      if (!dryRun) {
        await Activity.create({ ticketId: ticket._id, type: 'ticket_created', actor: { type: 'contact', name: ticket.name || null }, data: { backfilled: true }, at: ticket.createdAt });
      }
    }
    if (!dryRun) {
      const last = await Comment.findOne({ ticketId: ticket._id }).sort({ seq: -1, createdAt: -1 }).select('text createdAt').lean();
      const set = { lastSeq: seq, nextSeq: seq + 1, readBaselineSeq: seq };
      if (last) {
        set.lastMessage = String(last.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        set.lastMessageAt = last.createdAt;
      }
      await Ticket.updateOne({ _id: ticket._id }, { $set: set });
    }
  }
  console.log(`${dryRun ? '[dry run] ' : ''}tickets: ${tickets}, comments numbered: ${comments}, created events added: ${created}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
