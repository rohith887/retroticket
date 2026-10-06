// Per-user unread state, built on a per-conversation message sequence (Thread/Ticket .lastSeq, Message/Comment .seq).
const mongoose = require('mongoose');
const ReadState = require('../models/ReadState');

/** Highest seq the user is considered to have read. */
function effectiveReadSeq(item, readState) {
  return Math.max(Number(readState?.lastReadSeq) || 0, Number(item?.readBaselineSeq) || 0);
}

/** Number of messages after the user's read position. */
function unreadFor(item, readState) {
  return Math.max(0, (Number(item?.lastSeq) || 0) - effectiveReadSeq(item, readState));
}

function asObjectId(value) {
  return value && mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null;
}

/** Copy of `items` (plain objects) with `unreadCount` computed for this user; one ReadState query for the whole list. */
async function withUserUnread(items, userId, refType = 'thread') {
  const uid = asObjectId(userId);
  if (!uid || items.length === 0) return items.map((item) => ({ ...item, unreadCount: 0 }));
  const states = await ReadState.find({ userId: uid, refType, refId: { $in: items.map((i) => i._id) } }).select('refId lastReadSeq').lean();
  const byId = new Map(states.map((s) => [String(s.refId), s]));
  return items.map((item) => ({ ...item, unreadCount: unreadFor(item, byId.get(String(item._id))) }));
}

/** Move the user's read position forward (never backward). `seq` defaults to the item's latest. */
async function markRead(userId, refType, item, seq) {
  const uid = asObjectId(userId);
  if (!uid || !item) return;
  const target = Math.min(Number(seq ?? item.lastSeq) || 0, Number(item.lastSeq) || 0);
  await ReadState.updateOne(
    { userId: uid, refType, refId: item._id },
    { $max: { lastReadSeq: target }, $set: { lastReadAt: new Date() } },
    { upsert: true }
  );
}

const markThreadRead = (userId, thread, seq) => markRead(userId, 'thread', thread, seq);
const markTicketRead = (userId, ticket, seq) => markRead(userId, 'ticket', ticket, seq);

module.exports = { effectiveReadSeq, unreadFor, withUserUnread, markRead, markThreadRead, markTicketRead };
