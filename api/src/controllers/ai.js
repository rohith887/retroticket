// AI insights API for the React client. The client talks to Node only; Node talks to the Python service (lib/services/ai.service.js).
// Node makes every decision here: an insight is only a suggestion until an authenticated user accepts or dismisses it.
const express = require('express');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const { checkSession } = require('../lib/session');
const { actorFrom, logActivity } = require('../lib/activity');
const { emitAuditLog } = require('../lib/services/auditLog.service');
const ai = require('../lib/services/ai.service');
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const Activity = require('../models/Activity');
const User = require('../models/User');
const AiInsight = require('../models/AiInsight');
const { ANALYSIS_TYPES } = AiInsight;

const router = express.Router();
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const reviewer = (value) => (value && typeof value === 'object' && value.name ? { id: String(value._id || value.id), name: value.name } : null);
const WHO = 'name';

const present = (insight) => ({
  _id: insight._id,
  ticketId: insight.ticketId,
  messageId: insight.messageId,
  analysisId: insight.analysisId,
  type: insight.type,
  label: insight.result?.label,
  confidence: insight.confidence,
  lowConfidence: insight.lowConfidence,
  reasons: insight.result?.reasons || [],
  alternatives: insight.result?.alternatives || [],
  provider: insight.provider,
  model: insight.model,
  status: insight.status,
  applied: insight.applied,
  acceptedAt: insight.acceptedAt,
  dismissedAt: insight.dismissedAt,
  // Who reviewed it (names only) and when; null until someone accepts or dismisses.
  reviewedBy: insight.status === 'accepted' ? reviewer(insight.acceptedBy) : insight.status === 'dismissed' ? reviewer(insight.dismissedBy) : null,
  reviewedAt: insight.status === 'accepted' ? insight.acceptedAt : insight.status === 'dismissed' ? insight.dismissedAt : null,
  createdAt: insight.createdAt,
});

// Is AI configured and reachable? The client uses this to show or hide AI actions. Never an error.
router.get('/status', requirePermission(['issue::read']), async (req, res) => {
  res.send({ success: true, ...(await ai.status()) });
});

// Analyse the latest customer message on a ticket (or a specific comment). AI failure is reported, not raised.
router.post('/tickets/:ticketId/analyze', requirePermission(['issue::read']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    const ticket = await Ticket.findById(ticketId).select('_id detail name createdAt').lean();
    if (!ticket) return res.status(404).send({ success: false, message: 'Ticket not found' });
    const user = await checkSession(req);

    let source = null;
    if (req.body?.messageId) {
      if (!isId(req.body.messageId)) return res.status(400).send({ success: false, message: 'Invalid message id' });
      source = await Comment.findOne({ _id: req.body.messageId, ticketId }).select('text').lean();
      if (!source) return res.status(404).send({ success: false, message: 'Message not found on this ticket' });
    } else {
      // The newest message from the customer; a ticket with none is analysed from its description.
      source = await Comment.findOne({ ticketId, direction: 'inbound' }).sort({ seq: -1, createdAt: -1 }).select('text').lean();
    }
    const messageId = source?._id || null;
    const text = source?.text || ticket.detail;

    const result = await ai.analyzeMessage({
      ticketId: ticket._id,
      messageId,
      messageRef: source ? 'comment' : 'ticket',
      text,
      requestedBy: user?._id || null,
      trigger: 'manual',
      requestId: req.headers['x-request-id'] || null,
    });

    if (!result.ok) {
      // Ticketing is fine; only the suggestion is unavailable.
      return res.send({ success: false, available: false, reason: result.reason });
    }
    res.send({ success: true, analysisId: result.analysisId, insights: result.insights.map(present) });
  } catch (error) {
    console.error('AI analyze route failed:', error.message);
    res.send({ success: false, available: false, reason: 'internal_error' });
  }
});

// --- Conversation summary (deterministic, built by the internal engine from facts; see AI_INTEGRATION.md) ---
const presentSummary = (insight, ticket) => ({
  _id: insight._id,
  ticketId: insight.ticketId,
  type: 'summary',
  summary: insight.result,
  warnings: insight.warnings || [],
  engineVersion: insight.engineVersion,
  knowledgeVersion: insight.knowledgeVersion,
  basedOnSeq: insight.basedOnSeq,
  // The ticket has newer messages than the summary was built from.
  stale: Boolean(ticket) && Number(ticket.lastSeq || 0) > Number(insight.basedOnSeq || 0),
  status: insight.status,
  createdAt: insight.createdAt,
});

// Generate (or reuse) the summary. AI failure is reported, not raised; ticketing is unaffected.
router.post('/tickets/:ticketId/summary', requirePermission(['issue::read']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    const ticket = await Ticket.findById(ticketId).populate('assignedTo', 'name').lean();
    if (!ticket) return res.status(404).send({ success: false, message: 'Ticket not found' });
    const user = await checkSession(req);
    const [comments, activities] = await Promise.all([
      Comment.find({ ticketId }).populate('userId', 'name').sort({ seq: 1, createdAt: 1 }).limit(500).lean(),
      Activity.find({ ticketId }).sort({ at: -1 }).limit(50).lean(),
    ]);
    const result = await ai.summarizeConversation({ ticket, comments, activities, requestedBy: user?._id || null, requestId: req.headers['x-request-id'] || null });
    if (!result.ok) return res.send({ success: false, available: false, reason: result.reason });
    res.send({ success: true, reused: result.reused, insight: presentSummary(result.insight, ticket) });
  } catch (error) {
    console.error('AI summary route failed:', error.message);
    res.send({ success: false, available: false, reason: 'internal_error' });
  }
});

// The newest stored summary for a ticket, or null.
router.get('/tickets/:ticketId/summary', requirePermission(['issue::read']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    const [ticket, latest] = await Promise.all([
      Ticket.findById(ticketId).select('lastSeq').lean(),
      AiInsight.findOne({ ticketId, type: 'summary' }).sort({ createdAt: -1 }).lean(),
    ]);
    if (!ticket) return res.status(404).send({ success: false, message: 'Ticket not found' });
    res.send({ success: true, insight: latest ? presentSummary(latest, ticket) : null });
  } catch (error) {
    console.error('AI summary read failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

// --- Reply draft (deterministic, editable; the AI never sends anything: the agent sends from the composer) ---
const firstNameOf = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[\p{L}][\p{L}'-]{1,29}$/u.test(first) ? first : '';
};

// Node, not Python, adds the greeting and the signed-in agent's own signature.
const composeText = ({ body, customerName, signature }) => {
  const first = firstNameOf(customerName);
  const parts = [first ? `Hi ${first},` : 'Hello,', body];
  const sig = String(signature || '').trim();
  if (sig) parts.push(sig);
  return parts.join('\n\n');
};

const presentReply = (insight, ticket, signature) => ({
  _id: insight._id,
  ticketId: insight.ticketId,
  type: 'reply_draft',
  body: insight.result?.body,
  text: composeText({ body: insight.result?.body, customerName: ticket?.name, signature }),
  sentences: insight.result?.sentences || [],
  warnings: insight.warnings || [],
  intent: insight.result?.intent,
  engineVersion: insight.engineVersion,
  knowledgeVersion: insight.knowledgeVersion,
  basedOnSeq: insight.basedOnSeq,
  stale: Boolean(ticket) && Number(ticket.lastSeq || 0) > Number(insight.basedOnSeq || 0),
  status: insight.status,
  createdAt: insight.createdAt,
});

const signatureOf = async (user) => {
  try {
    const found = user?._id ? await User.findById(user._id).select('signature').lean() : null;
    return found?.signature || user?.signature || '';
  } catch {
    return '';
  }
};

router.post('/tickets/:ticketId/reply-draft', requirePermission(['issue::comment']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    const ticket = await Ticket.findById(ticketId).populate('assignedTo', 'name').lean();
    if (!ticket) return res.status(404).send({ success: false, message: 'Ticket not found' });
    const user = await checkSession(req);
    const [comments, activities] = await Promise.all([
      Comment.find({ ticketId }).populate('userId', 'name').sort({ seq: 1, createdAt: 1 }).limit(500).lean(),
      Activity.find({ ticketId }).sort({ at: -1 }).limit(50).lean(),
    ]);
    const result = await ai.draftReply({ ticket, comments, activities, requestedBy: user?._id || null, requestId: req.headers['x-request-id'] || null });
    if (!result.ok) return res.send({ success: false, available: false, reason: result.reason });
    if (result.status === 'insufficient_context') return res.send({ success: true, status: 'insufficient_context', reason: result.reason });
    res.send({ success: true, status: 'ready', reused: result.reused, insight: presentReply(result.insight, ticket, await signatureOf(user)) });
  } catch (error) {
    console.error('AI reply draft route failed:', error.message);
    res.send({ success: false, available: false, reason: 'internal_error' });
  }
});

// The newest draft that is still open (not used or dismissed), with `stale` set when the ticket has newer messages.
router.get('/tickets/:ticketId/reply-draft', requirePermission(['issue::comment']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    const [ticket, latest] = await Promise.all([
      Ticket.findById(ticketId).select('lastSeq name').lean(),
      AiInsight.findOne({ ticketId, type: 'reply_draft' }).sort({ createdAt: -1 }).lean(),
    ]);
    if (!ticket) return res.status(404).send({ success: false, message: 'Ticket not found' });
    if (!latest || latest.status !== 'suggested') return res.send({ success: true, insight: null });
    const user = await checkSession(req);
    res.send({ success: true, insight: presentReply(latest, ticket, await signatureOf(user)) });
  } catch (error) {
    console.error('AI reply draft read failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

// Feedback on a draft. Recorded for later review only; nothing trains on it and it is never treated as ground truth.
//   used_unchanged -> accepted        used_edited -> accepted + feedback.editedAt        dismissed -> dismissed
const DRAFT_EVENTS = new Set(['used_unchanged', 'used_edited', 'dismissed']);
router.post('/insights/:id/feedback', requirePermission(['issue::comment']), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).send({ success: false, message: 'Invalid insight id' });
    const event = req.body?.event;
    if (!DRAFT_EVENTS.has(event)) return res.status(400).send({ success: false, message: 'Unknown feedback event' });
    const user = await checkSession(req);
    const now = new Date();
    const set =
      event === 'dismissed'
        ? { status: 'dismissed', dismissedBy: user._id, dismissedAt: now }
        : { status: 'accepted', acceptedBy: user._id, acceptedAt: now, ...(event === 'used_edited' ? { 'feedback.editedAt': now, 'feedback.finalValue': { edited: true } } : {}) };
    const updated = await AiInsight.findOneAndUpdate({ _id: req.params.id, type: 'reply_draft', status: 'suggested' }, { $set: set }, { new: true });
    if (!updated) return res.status(409).send({ success: false, message: 'This draft has already been handled.' });
    await emitAuditLog({
      eventType: event === 'dismissed' ? 'ai_reply_draft_dismissed' : 'ai_reply_draft_used',
      actor: { actorType: 'user', actorId: String(user._id), actorEmail: user.email || null, actorName: user.name || null },
      entityType: 'ai_insight',
      entityId: updated._id,
      requestId: req.headers['x-request-id'] || null,
      metadata: { ticketId: String(updated.ticketId), event, edited: event === 'used_edited' },
    }).catch(() => {});
    res.send({ success: true, status: updated.status });
  } catch (error) {
    console.error('AI draft feedback failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

// The most recent analysis for a ticket (or the recent history with ?history=1).
router.get('/tickets/:ticketId/insights', requirePermission(['issue::read']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!isId(ticketId)) return res.status(400).send({ success: false, message: 'Invalid ticket id' });
    if (req.query.history === '1') {
      const all = await AiInsight.find({ ticketId, type: { $in: ANALYSIS_TYPES } }).sort({ createdAt: -1 }).limit(60).populate('acceptedBy dismissedBy', WHO).lean();
      return res.send({ success: true, insights: all.map(present) });
    }
    // Only rule-based analyses: a newer summary or reply draft must never be mistaken for the "latest analysis".
    const latest = await AiInsight.findOne({ ticketId, type: { $in: ANALYSIS_TYPES } }).sort({ createdAt: -1 }).select('analysisId').lean();
    const insights = latest ? await AiInsight.find({ analysisId: latest.analysisId, type: { $in: ANALYSIS_TYPES } }).populate('acceptedBy dismissedBy', WHO).lean() : [];
    res.send({ success: true, insights: insights.map(present) });
  } catch (error) {
    console.error('AI insights route failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

// Accept an insight. Node decides what acceptance means: a priority insight updates the ticket priority (and is logged as
// the user's action on the activity timeline); sentiment and intent are recorded as reviewed and change nothing.
router.post('/insights/:id/accept', requirePermission(['issue::update']), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).send({ success: false, message: 'Invalid insight id' });
    const user = await checkSession(req);
    const claimed = await AiInsight.findOneAndUpdate(
      { _id: req.params.id, status: 'suggested' },
      { $set: { status: 'accepted', acceptedBy: user._id, acceptedAt: new Date() } },
      { new: true }
    ).populate('acceptedBy dismissedBy', WHO);
    if (!claimed) return res.status(409).send({ success: false, message: 'This suggestion has already been handled.' });

    let applied = null;
    if (claimed.type === 'priority') {
      const ticket = await Ticket.findById(claimed.ticketId).select('priority');
      const next = claimed.result?.label;
      if (ticket && next && ticket.priority !== next) {
        const from = ticket.priority;
        await Ticket.updateOne({ _id: ticket._id }, { $set: { priority: next } });
        await logActivity(ticket._id, 'priority_changed', actorFrom(user), { from, to: next, via: 'ai_suggestion', insightId: String(claimed._id) });
        applied = { priority: { from, to: next } };
      } else {
        applied = { priority: { from: ticket?.priority || null, to: next || null, unchanged: true } };
      }
      await AiInsight.updateOne({ _id: claimed._id }, { $set: { applied } });
    }

    await emitAuditLog({
      eventType: 'ai_insight_accepted',
      actor: { actorType: 'user', actorId: String(user._id), actorEmail: user.email || null, actorName: user.name || null },
      entityType: 'ai_insight',
      entityId: claimed._id,
      requestId: req.headers['x-request-id'] || null,
      metadata: { ticketId: String(claimed.ticketId), type: claimed.type, label: claimed.result?.label, confidence: claimed.confidence, applied },
    }).catch(() => {});

    res.send({ success: true, insight: present({ ...claimed.toObject(), applied }) });
  } catch (error) {
    console.error('AI accept route failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

router.post('/insights/:id/dismiss', requirePermission(['issue::update']), async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).send({ success: false, message: 'Invalid insight id' });
    const user = await checkSession(req);
    const dismissed = await AiInsight.findOneAndUpdate(
      { _id: req.params.id, status: 'suggested' },
      { $set: { status: 'dismissed', dismissedBy: user._id, dismissedAt: new Date() } },
      { new: true }
    ).populate('acceptedBy dismissedBy', WHO);
    if (!dismissed) return res.status(409).send({ success: false, message: 'This suggestion has already been handled.' });
    await emitAuditLog({
      eventType: 'ai_insight_dismissed',
      actor: { actorType: 'user', actorId: String(user._id), actorEmail: user.email || null, actorName: user.name || null },
      entityType: 'ai_insight',
      entityId: dismissed._id,
      requestId: req.headers['x-request-id'] || null,
      metadata: { ticketId: String(dismissed.ticketId), type: dismissed.type },
    }).catch(() => {});
    res.send({ success: true, insight: present(dismissed) });
  } catch (error) {
    console.error('AI dismiss route failed:', error.message);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
