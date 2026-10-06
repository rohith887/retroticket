const mongoose = require('mongoose');
require('./Ticket');
require('./ReadState');

const commentSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true
  },
  public: {
    type: Boolean,
    default: false
  },
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  // Position in the ticket's conversation, allocated atomically on create (see the pre-validate hook).
  seq: { type: Number, min: 1, default: undefined },
  // inbound = the customer (email reply), outbound = staff reply to the customer, internal = private note.
  // Comments written before this field existed are derived from `public` when read.
  direction: { type: String, enum: ['inbound', 'outbound', 'internal'], default: undefined },
  authorName: { type: String, default: null },
  authorEmail: { type: String, default: null },
  // Client-generated id so a retried request cannot create the same message twice.
  clientMessageId: { type: String, default: undefined },
  // Outbound email state for public replies (null for notes and replies with nobody to email).
  delivery: {
    type: new mongoose.Schema(
      {
        status: { type: String, enum: ['queued', 'processing', 'sent', 'failed', 'canceled'], required: true },
        sendAfter: { type: Date, default: null },
        attempts: { type: Number, default: 0 },
        sentAt: { type: Date, default: null },
        jobId: { type: mongoose.Schema.Types.ObjectId, default: null },
        to: [{ type: String }],
        lastError: { type: String, default: null },
      },
      { _id: false }
    ),
    default: undefined,
  },
}, {
  timestamps: true
});

commentSchema.index({ ticketId: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } });
commentSchema.index({ ticketId: 1, seq: 1 }, { unique: true, partialFilterExpression: { seq: { $type: 'number' } } });

// One atomic update on the ticket hands out the next number, so concurrent writers can never share one.
commentSchema.pre('validate', async function allocateSeq(next) {
  try {
    if (!this.isNew || this.seq || !this.ticketId) return next();
    const ticket = await mongoose
      .model('Ticket')
      .findOneAndUpdate({ _id: this.ticketId }, { $inc: { nextSeq: 1, lastSeq: 1 } }, { new: true, projection: { lastSeq: 1 } })
      .lean();
    if (ticket) this.seq = Number(ticket.lastSeq);
    return next();
  } catch (error) {
    return next(error);
  }
});

// Keep the ticket's inbox preview current, and mark the author's own comment as read for them.
commentSchema.post('save', async function afterSave(doc) {
  try {
    await mongoose.model('Ticket').updateOne(
      { _id: doc.ticketId },
      { $set: { lastMessage: String(doc.text || '').replace(/\s+/g, ' ').trim().slice(0, 200), lastMessageAt: doc.createdAt || new Date() } }
    );
    // Optional background analysis of incoming customer messages. Fire-and-forget: the message is already stored, and a
    // missing or failing AI service changes nothing here (see lib/services/ai.service.js).
    if (doc.direction === 'inbound') {
      const ai = require('../lib/services/ai.service');
      const cfg = ai.config();
      if (cfg.enabled && cfg.autoAnalyze) {
        ai.analyzeInBackground({ ticketId: doc.ticketId, messageId: doc._id, messageRef: 'comment', text: doc.text });
      }
    }
    if (doc.seq && doc.userId) {
      await mongoose.model('ReadState').updateOne(
        { userId: doc.userId, refType: 'ticket', refId: doc.ticketId },
        { $max: { lastReadSeq: doc.seq }, $set: { lastReadAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (error) {
    console.error('Failed to update ticket preview / read state:', error.message);
  }
});

module.exports = mongoose.model('Comment', commentSchema);
