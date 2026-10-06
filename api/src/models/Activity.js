const mongoose = require('mongoose');

// System events on a ticket (spec: activities). Messages are never duplicated here.
const ACTIVITY_TYPES = [
  'ticket_created',
  'assigned',
  'unassigned',
  'status_changed',
  'priority_changed',
  'subject_changed',
  'resolved',
  'reopened',
  'client_changed',
  'delivery_failed',
];

const activitySchema = new mongoose.Schema({
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  type: { type: String, enum: ACTIVITY_TYPES, required: true },
  actor: {
    type: { type: String, enum: ['user', 'contact', 'system'], default: 'system' },
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, default: null },
  },
  // Typed by `type`: { from, to } pairs, { to: { id, name } } for assignments, and so on. Kept small.
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now },
});

activitySchema.index({ ticketId: 1, at: 1 });
activitySchema.index({ type: 1, at: -1 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
