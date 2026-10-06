// Ticket activity log. logActivity never throws: a side record must not fail the request that caused it.
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

/** { type: 'user', id, name } from a session user; anything else is a system actor. */
function actorFrom(user) {
  if (!user) return { type: 'system', id: null, name: 'System' };
  return { type: 'user', id: user._id || user.id || null, name: user.name || user.email || 'User' };
}

async function logActivity(ticketId, type, actor, data = {}) {
  try {
    if (!ticketId || !mongoose.Types.ObjectId.isValid(String(ticketId))) return null;
    return await Activity.create({ ticketId, type, actor: actor || actorFrom(null), data });
  } catch (error) {
    console.error(`Could not record activity "${type}":`, error.message);
    return null;
  }
}

/** { id, name } for a user id (null when unassigned or unknown). */
async function personRef(userId) {
  if (!userId) return null;
  const User = mongoose.model('User');
  const user = await User.findById(userId).select('name').lean().catch(() => null);
  return { id: String(userId), name: user?.name || 'Unknown user' };
}

module.exports = { actorFrom, logActivity, personRef };
