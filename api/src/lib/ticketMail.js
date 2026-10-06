// Outbound email for ticket replies. A public comment is queued as an OutboundEmailJob (the same durable queue thread
// messages use: retries with backoff, dead-letter, audit log, Mailer Ops), instead of being sent inline in the request.
//
//   sendTicketReply   queue the email after an undo window; sets comment.delivery
//   cancelTicketReply undo before the worker picks the job up (atomic; fails once sending has started)
//   retryTicketReply  put a dead / failed job back in the queue
const mongoose = require('mongoose');
const Mailbox = require('../models/Mailbox');
const EmailQueue = require('../models/EmailQueue');
const Comment = require('../models/Comment');
const OutboundEmailJob = require('../models/OutboundEmailJob');
const { OutboundEmailQueueService } = require('./services/outboundEmailQueue.service');

const UNDO_SECONDS = () => Math.min(30, Math.max(0, Number(process.env.TICKET_UNDO_SEND_SECONDS ?? 5)));

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jobKey = (commentId) => `comment:${commentId}`;

/** The mailbox's own queue when the ticket came in through one, else the first active queue. */
async function resolveTicketQueue(ticket) {
  let mailbox = null;
  if (ticket.mailboxId && mongoose.Types.ObjectId.isValid(String(ticket.mailboxId))) {
    mailbox = await Mailbox.findById(ticket.mailboxId).lean();
    if (mailbox?.emailQueueId) {
      const queue = await EmailQueue.findOne({ _id: mailbox.emailQueueId, active: true, isDeleted: false });
      if (queue) return { queue, mailbox };
    }
  }
  const queue = await EmailQueue.findOne({ active: true, isDeleted: false }).sort({ createdAt: 1 });
  return queue ? { queue, mailbox } : null;
}

async function sendTicketReply({ ticket, comment, actor }) {
  const to = String(ticket.email || '').trim().toLowerCase();
  if (!to) return { queued: false, reason: 'This ticket has no requester email.' };

  const resolved = await resolveTicketQueue(ticket);
  if (!resolved) return { queued: false, reason: 'No active email queue is configured.' };
  const { queue, mailbox } = resolved;
  const senderEmail = String(mailbox?.emailAddress || queue.username || '').trim().toLowerCase();
  if (!senderEmail) return { queued: false, reason: 'The outbound queue has no sender address.' };

  const sendAfter = new Date(Date.now() + UNDO_SECONDS() * 1000);
  const job = await OutboundEmailQueueService.enqueue(
    {
      ticketId: ticket._id,
      queueId: queue._id,
      mailboxId: mailbox?._id || null,
      senderName: actor?.name || mailbox?.name || null,
      senderEmail,
      to: [to],
      subject: `Re: ${ticket.title} [${ticket.number}]`,
      text: comment.text,
      html: `<p>${escapeHtml(comment.text).replace(/\r?\n/g, '<br>')}</p>`,
      headers: { 'X-Ticket-Id': String(ticket._id), 'X-Ticket-Number': ticket.number || '' },
      sentByUserId: actor?.id || null,
      metadata: { commentId: comment._id, ticketId: ticket._id },
    },
    { idempotencyKey: jobKey(comment._id), sendAfter, actor: { actorType: 'user', actorId: actor?.id || null, actorName: actor?.name || null } }
  );

  await Comment.updateOne(
    { _id: comment._id },
    { $set: { delivery: { status: 'queued', sendAfter, attempts: 0, jobId: job._id, to: [to], lastError: null } } }
  );
  return { queued: true, sendAfter, jobId: job._id };
}

/** True when the send was stopped in time. Once the worker has claimed the job it is on its way and cannot be undone. */
async function cancelTicketReply(commentId) {
  const job = await OutboundEmailJob.findOneAndUpdate(
    { idempotencyKey: jobKey(commentId), status: 'pending', nextRetryAt: { $gt: new Date() } },
    { $set: { status: 'canceled', lockedAt: null } },
    { new: true }
  );
  if (!job) return false;
  await Comment.updateOne({ _id: commentId }, { $set: { 'delivery.status': 'canceled' } });
  return true;
}

async function retryTicketReply(commentId) {
  const job = await OutboundEmailJob.findOneAndUpdate(
    { idempotencyKey: jobKey(commentId), status: { $in: ['dead', 'failed'] } },
    { $set: { status: 'pending', nextRetryAt: new Date(), attempt: 0, lockedAt: null, lockedBy: null, lastError: null } },
    { new: true }
  );
  if (!job) return false;
  await Comment.updateOne({ _id: commentId }, { $set: { 'delivery.status': 'queued', 'delivery.attempts': 0, 'delivery.lastError': null } });
  return true;
}

module.exports = { UNDO_SECONDS, resolveTicketQueue, sendTicketReply, cancelTicketReply, retryTicketReply };
