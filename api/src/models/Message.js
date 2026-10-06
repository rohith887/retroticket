const mongoose = require('mongoose');
require('./Thread');
require('./ReadState');

const participantSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    type: {
      type: String,
      enum: ['user', 'system', 'external'],
      default: 'external',
    },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    threadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Thread',
      required: true,
      index: true,
    },
    // Position in the thread, allocated atomically on create (see the pre-validate hook). Gaps are possible, reuse never is.
    seq: { type: Number, min: 1, default: undefined },
    sourceCaseId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      default: null,
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound', 'internal'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['email', 'internal'],
      default: 'email',
    },
    sender: {
      type: participantSchema,
      required: true,
    },
    sentByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    sentByRole: {
      type: String,
      trim: true,
      default: null,
    },
    recipientUserId: {
      type: String,
      trim: true,
      default: null,
    },
    recipients: {
      to: [{ type: String, trim: true, lowercase: true }],
      cc: [{ type: String, trim: true, lowercase: true }],
      bcc: [{ type: String, trim: true, lowercase: true }],
    },
    subject: {
      type: String,
      trim: true,
      default: null,
    },
    body: {
      type: String,
      required: true,
    },
    bodyHtml: {
      type: String,
      default: null,
    },
    externalMessageId: {
      type: String,
      trim: true,
      default: null,
    },
    emailMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailMessage',
      default: null,
    },
    status: {
      type: String,
      enum: ['draft', 'queued', 'processing', 'sent', 'delivered', 'received', 'failed'],
      default: 'sent',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

messageSchema.index({ threadId: 1, createdAt: 1 });
messageSchema.index({ threadId: 1, seq: 1 }, { unique: true, partialFilterExpression: { seq: { $type: 'number' } } });

// Allocate seq atomically: one findOneAndUpdate on the thread, so concurrent writers can never get the same number.
messageSchema.pre('validate', async function allocateSeq(next) {
  try {
    if (!this.isNew || this.seq || !this.threadId) return next();
    const thread = await mongoose
      .model('Thread')
      .findOneAndUpdate({ _id: this.threadId }, { $inc: { nextSeq: 1, lastSeq: 1 } }, { new: true, projection: { lastSeq: 1 } })
      .lean();
    // lastSeq after the increment is the number just allocated (a legacy thread without the field goes 0 -> 1).
    if (thread) this.seq = Number(thread.lastSeq);
    return next();
  } catch (error) {
    return next(error);
  }
});

// The author has, by definition, read up to their own message.
messageSchema.post('save', async function markAuthorRead(doc) {
  try {
    if (!doc.seq || doc.sender?.type !== 'user' || !doc.sender?.id) return;
    await mongoose.model('ReadState').updateOne(
      { userId: doc.sender.id, refType: 'thread', refId: doc.threadId },
      { $max: { lastReadSeq: doc.seq }, $set: { lastReadAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('Failed to update the author read state:', error.message);
  }
});
messageSchema.index(
  { threadId: 1, externalMessageId: 1 },
  { unique: true, partialFilterExpression: { externalMessageId: { $type: 'string' } } }
);
messageSchema.index({ mailboxId: 1, createdAt: -1 });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);
