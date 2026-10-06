const express = require('express');
const { requirePermission } = require('../lib/roles');
const Ticket = require('../models/Ticket');
const fs = require('fs/promises');
const { LOG_FILE } = require('../lib/logger');
const NL = String.fromCharCode(10);

const router = express.Router();

// Lightweight counters and a short recent-tickets list for the admin header and home page
router.get('/summary', requirePermission(['issue::read']), async (req, res) => {
  try {
    const openFilter = { isComplete: false, hidden: false };
    const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [open, unassigned, mine, noUpdate24h, recent] = await Promise.all([
      Ticket.countDocuments(openFilter),
      Ticket.countDocuments({ ...openFilter, assignedTo: null }),
      // Open tickets assigned to the requesting user (agent sidebar "My tickets").
      req.user?._id ? Ticket.countDocuments({ ...openFilter, assignedTo: req.user._id }) : 0,
      // TEMPORARY PLACEHOLDER, not an SLA metric: open tickets with no update for 24 hours.
      // Replace with the real SLA overdue calculation when SLA is implemented.
      Ticket.countDocuments({ ...openFilter, updatedAt: { $lt: staleBefore } }),
      Ticket.find({ hidden: false })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('number title priority isComplete createdAt assignedTo')
        .populate('assignedTo', 'name')
        .lean(),
    ]);
    res.json({
      success: true,
      open,
      unassigned,
      mine,
      noUpdate24h, // placeholder, see above
      recent: recent.map((t) => ({
        id: String(t._id),
        number: t.number,
        title: t.title,
        priority: t.priority,
        isComplete: t.isComplete,
        createdAt: t.createdAt,
        assignee: t.assignedTo?.name || null,
      })),
    });
  } catch (error) {
    console.error('Error fetching ticket summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch summary' });
  }
});

// Get total count of all tickets
router.get('/tickets/all', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ hidden: false });
  res.json({ count });
});

// Get total count of all completed tickets
router.get('/tickets/completed', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ isComplete: true, hidden: false });
  res.json({ count });
});

// Get total count of all open tickets
router.get('/tickets/open', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ isComplete: false, hidden: false });
  res.json({ count });
});

// Get total of all unassigned tickets
router.get('/tickets/unassigned', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ assignedTo: null, hidden: false, isComplete: false });
  res.json({ count });
});

// Get all logs
router.get('/logs', requirePermission(['settings::view', 'settings::manage'], false), async (req, res) => {
  try {
    // Only the tail is needed; a missing file just means nothing has been logged yet.
    const raw = await fs.readFile(LOG_FILE, 'utf-8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const logs = raw.split(NL).filter(Boolean).slice(-2000).join(NL);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ message: 'Could not read log file', error: error.message });
  }
});

module.exports = router;
