const mongoose = require('mongoose');

// Per-user read position in a conversation (spec: read_states). refType says what refId points at:
//   'thread'  Thread._id  (position in Message.seq)
//   'ticket'  Ticket._id  (position in Comment.seq)
// A message is unread for a user when its seq is greater than max(lastReadSeq, item.readBaselineSeq).
const readStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    refType: { type: String, enum: ['thread', 'ticket'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    lastReadSeq: { type: Number, default: 0, min: 0 },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

readStateSchema.index({ userId: 1, refType: 1, refId: 1 }, { unique: true });
readStateSchema.index({ refType: 1, refId: 1 });

module.exports = mongoose.models.ReadState || mongoose.model('ReadState', readStateSchema);
