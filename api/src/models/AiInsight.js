const mongoose = require('mongoose');

// One result from the intelligence service (Python). Stored separately from the customer message, never over it.
// One document per insight type per analysis, so each can be accepted or dismissed on its own.
//
// Node owns decisions: `status` moves from 'suggested' to 'accepted' or 'dismissed' only through an authenticated
// user action, and accepting a priority is what changes the ticket (the AI service never does).
// Analysis insights come three at a time from one analysis; summaries and reply drafts (Phase 3B/3C) are single documents.
const ANALYSIS_TYPES = ['sentiment', 'intent', 'priority'];
const GENERATED_TYPES = ['summary', 'reply_draft'];
const INSIGHT_TYPES = [...ANALYSIS_TYPES, ...GENERATED_TYPES];

const aiInsightSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    // Thread the message belongs to, when the analysed message came from a thread (null for ticket comments).
    conversationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    messageRef: { type: String, enum: ['comment', 'message', 'ticket'], default: 'comment' },
    // Groups the insights produced by one analysis call.
    analysisId: { type: String, required: true },
    type: { type: String, enum: INSIGHT_TYPES, required: true },
    // { label, confidence, reasons? , alternatives? } exactly as validated from the service.
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    // Analysis insights carry the engine's match strength (not a probability). Generated text (summary, reply draft) has none.
    confidence: { type: Number, min: 0, max: 1, required: function requiresConfidence() { return ANALYSIS_TYPES.includes(this.type); } },
    lowConfidence: { type: Boolean, default: false },
    provider: { type: String, required: true },
    model: { type: String, default: null },
    providerVersion: { type: String, default: null },
    requestId: { type: String, default: null },
    latencyMs: { type: Number, default: null },
    // What produced this insight, so a later review or training run knows exactly which rules and knowledge were in force.
    engineVersion: { type: String, default: null },
    knowledgeVersion: { type: String, default: null }, // knowledge pack fingerprint, e.g. verification-support@0.1.0+abc123
    componentVersions: { type: mongoose.Schema.Types.Mixed, default: null }, // { 'rules-sentiment': '1.0', ... }
    // Counts and knowledge ids the engine saw (no message text). Kept for later review; nothing trains on it automatically.
    featureSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['suggested', 'accepted', 'dismissed'], default: 'suggested' },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date, default: null },
    dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dismissedAt: { type: Date, default: null },
    // What Node did with an accepted insight, e.g. { priority: { from: 'medium', to: 'high' } }.
    applied: { type: mongoose.Schema.Types.Mixed, default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    trigger: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    // Feedback signals for later review. Accepted / dismissed are the `status` above; these record the rest.
    feedback: {
      finalValue: { type: mongoose.Schema.Types.Mixed, default: null }, // what the user ended up with when it differs from the suggestion
      editedAt: { type: Date, default: null },
      ignoredAt: { type: Date, default: null }, // the suggestion was shown and left untouched (set by a later review job)
    },

    // --- Generated text (summary, reply_draft): Phase 3B/3C ---
    // Hash of the exact context analysed (after sanitizing). Same hash = same input, so a stored summary can be reused.
    contextHash: { type: String, default: null },
    // The ticket's last comment number when it was generated. If the ticket has moved on, the UI says it is out of date.
    basedOnSeq: { type: Number, default: null, min: 0 },
    audience: { type: String, enum: ['agent', 'customer'], default: undefined }, // summary = agent, reply_draft = customer
    inputChars: { type: Number, default: null, min: 0 },
    warnings: { type: [String], default: undefined },
    usedInternalNotes: { type: Boolean, default: null },
  },
  { timestamps: true }
);

aiInsightSchema.index({ ticketId: 1, createdAt: -1 });
aiInsightSchema.index({ messageId: 1, type: 1 });
aiInsightSchema.index({ analysisId: 1 });

module.exports = mongoose.models.AiInsight || mongoose.model('AiInsight', aiInsightSchema);
module.exports.INSIGHT_TYPES = INSIGHT_TYPES;
module.exports.ANALYSIS_TYPES = ANALYSIS_TYPES;
module.exports.GENERATED_TYPES = GENERATED_TYPES;
