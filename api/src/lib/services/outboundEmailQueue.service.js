const crypto = require('crypto');
const mongoose = require('mongoose');
const EmailQueue = require('../../models/EmailQueue');
const Message = require('../../models/Message');
const Comment = require('../../models/Comment');
const { logActivity } = require('../activity');
const OutboundEmailJob = require('../../models/OutboundEmailJob');
const { MailService } = require('./smtp.service');
const { emitAuditLog } = require('./auditLog.service');

const DEFAULT_POLL_MS = Math.max(Number(process.env.OUTBOUND_EMAIL_QUEUE_POLL_MS || 3000), 1000);
const DEFAULT_LOCK_MS = Math.max(Number(process.env.OUTBOUND_EMAIL_QUEUE_LOCK_MS || 60000), 10000);
const DEFAULT_MAX_ATTEMPTS = Math.max(Number(process.env.OUTBOUND_EMAIL_MAX_ATTEMPTS || 5), 1);

function computeBackoffMs(attempt) {
  const baseMs = 5000;
  const maxMs = 10 * 60 * 1000;
  const expMs = Math.min(baseMs * Math.pow(2, Math.max(attempt - 1, 0)), maxMs);
  const jitter = Math.floor(Math.random() * 1000);
  return expMs + jitter;
}

function formatFromAddress(name, email) {
  if (!email) return null;
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  return trimmedName ? `${trimmedName} <${email}>` : email;
}

class OutboundEmailQueueService {
  static buildIdempotencyKey(payload, explicitKey = null) {
    if (explicitKey && String(explicitKey).trim()) {
      return String(explicitKey).trim();
    }

    const fingerprint = JSON.stringify({
      threadId: String(payload.threadId || ''),
      subject: payload.subject || '',
      to: payload.to || [],
      cc: payload.cc || [],
      bcc: payload.bcc || [],
      text: payload.text || '',
      senderEmail: payload.senderEmail || '',
    });
    return `mail:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
  }

  static async enqueue(payload, options = {}) {
    const idempotencyKey = this.buildIdempotencyKey(payload, options.idempotencyKey);

    const existingJob = await OutboundEmailJob.findOne({ idempotencyKey });
    if (existingJob) {
      return existingJob;
    }

    const job = await OutboundEmailJob.create({
      idempotencyKey,
      status: 'pending',
      maxAttempts: Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS),
      nextRetryAt: options.sendAfter instanceof Date ? options.sendAfter : new Date(),
      payload,
    });

    await emitAuditLog({
      eventType: 'job_enqueued',
      actor: options.actor || { actorType: 'system' },
      entityType: 'outbound_email_job',
      entityId: job._id,
      requestId: options.requestId || null,
      metadata: {
        messageId: payload?.metadata?.messageId || null,
        threadId: payload?.threadId || null,
        toCount: Array.isArray(payload?.to) ? payload.to.length : 0,
        subject: payload?.subject || null,
      },
    });

    return job;
  }

  static async claimNextJob(workerId) {
    const now = new Date();
    const staleLockTime = new Date(now.getTime() - DEFAULT_LOCK_MS);

    return OutboundEmailJob.findOneAndUpdate(
      {
        status: { $in: ['pending', 'failed'] },
        nextRetryAt: { $lte: now },
        $or: [{ lockedAt: null }, { lockedAt: { $lte: staleLockTime } }],
      },
      {
        $set: {
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
        },
      },
      {
        sort: { nextRetryAt: 1, createdAt: 1 },
        new: true,
      }
    );
  }

  static async processJob(job, workerId) {
    const payload = job.payload || {};
    const queue = await EmailQueue.findOne({
      _id: payload.queueId,
      active: true,
      isDeleted: false,
    });

    if (!queue) {
      throw new Error('Active queue not found for outbound email job');
    }

    const smtpResult = await MailService.sendEmail({
      to: (payload.to || []).join(','),
      cc: payload.cc || [],
      bcc: payload.bcc || [],
      subject: payload.subject || '(No subject)',
      text: payload.text || '',
      html: payload.html || '',
      queue,
      from: formatFromAddress(payload.senderName, payload.senderEmail),
      headers: payload.headers || {},
    });

    const emailMessage = await MailService.persistSentEmail({
      queue,
      threadId: payload.threadId || null,
      sourceCaseId: payload.sourceCaseId || null,
      direction: 'outbound',
      to: payload.to || [],
      cc: payload.cc || [],
      bcc: payload.bcc || [],
      subject: payload.subject || '(No subject)',
      text: payload.text || '',
      html: payload.html || '',
      messageId: smtpResult.messageId,
      from: payload.senderEmail,
      inReplyTo: payload.inReplyTo || null,
      references: Array.isArray(payload.references) ? payload.references : [],
      sentByUserId: payload.sentByUserId || null,
      sentByRole: payload.sentByRole || null,
      recipientUserId: payload.recipientUserId || null,
      headers: payload.headers || {},
    });

    if (payload.metadata?.messageId) {
      await Message.findByIdAndUpdate(payload.metadata.messageId, {
        $set: {
          status: 'sent',
          externalMessageId: smtpResult.messageId || null,
          emailMessageId: emailMessage?._id || null,
        },
      });
    }
    if (payload.metadata?.commentId) {
      await Comment.updateOne(
        { _id: payload.metadata.commentId },
        { $set: { 'delivery.status': 'sent', 'delivery.sentAt': new Date(), 'delivery.lastError': null }, $inc: { 'delivery.attempts': 1 } }
      );
    }

    await OutboundEmailJob.findByIdAndUpdate(job._id, {
      $set: {
        status: 'sent',
        sentAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        result: {
          messageId: smtpResult.messageId || null,
          queueName: queue.name || null,
        },
      },
      $inc: { attempt: 1 },
    });

    await emitAuditLog({
      eventType: 'job_sent',
      actor: { actorType: 'worker', actorId: workerId },
      entityType: 'outbound_email_job',
      entityId: job._id,
      metadata: {
        messageId: payload?.metadata?.messageId || null,
        smtpMessageId: smtpResult.messageId || null,
        attempts: Number(job.attempt || 0) + 1,
      },
    });
  }

  static async failJob(job, error, workerId) {
    const nextAttempt = Number(job.attempt || 0) + 1;
    const shouldDeadLetter = nextAttempt >= Number(job.maxAttempts || DEFAULT_MAX_ATTEMPTS);
    const backoffMs = computeBackoffMs(nextAttempt);
    const update = {
      $set: {
        status: shouldDeadLetter ? 'dead' : 'failed',
        lastError: error?.message || String(error),
        nextRetryAt: new Date(Date.now() + backoffMs),
        lockedAt: null,
        lockedBy: null,
      },
      $inc: { attempt: 1 },
    };

    await OutboundEmailJob.findByIdAndUpdate(job._id, update);
    if (job.payload?.metadata?.messageId) {
      await Message.findByIdAndUpdate(job.payload.metadata.messageId, {
        $set: {
          status: shouldDeadLetter ? 'failed' : 'processing',
          metadata: {
            ...(job.payload?.metadata || {}),
            lastOutboundError: error?.message || String(error),
            lastOutboundAttemptBy: workerId,
          },
        },
      });
    }
    if (job.payload?.metadata?.commentId) {
      await Comment.updateOne(
        { _id: job.payload.metadata.commentId },
        { $set: { 'delivery.status': shouldDeadLetter ? 'failed' : 'processing', 'delivery.lastError': error?.message || String(error) }, $inc: { 'delivery.attempts': 1 } }
      );
    }

    if (shouldDeadLetter && job.payload?.ticketId) {
      await logActivity(job.payload.ticketId, 'delivery_failed', { type: 'system', id: null, name: 'System' }, {
        to: (job.payload.to || [])[0] || null,
        error: error?.message || String(error),
      });
    }

    if (shouldDeadLetter) {
      await emitAuditLog({
        eventType: 'job_dead',
        actor: { actorType: 'worker', actorId: workerId },
        entityType: 'outbound_email_job',
        entityId: job._id,
        metadata: {
          messageId: job.payload?.metadata?.messageId || null,
          attempts: nextAttempt,
          lastError: error?.message || String(error),
        },
      });
    }
  }

  static startWorker() {
    const enabled = String(process.env.OUTBOUND_EMAIL_WORKER_ENABLED || 'true').toLowerCase() === 'true';
    if (!enabled) {
      return null;
    }

    const workerId = process.env.OUTBOUND_EMAIL_WORKER_ID || `worker-${process.pid}`;
    const timer = setInterval(async () => {
      // Skip quietly while MongoDB is unreachable instead of buffering queries and logging errors every tick.
      if (mongoose.connection.readyState !== 1) return;
      try {
        const job = await this.claimNextJob(workerId);
        if (!job) return;

        try {
          await this.processJob(job, workerId);
        } catch (error) {
          console.error('Outbound email job failed:', error);
          await this.failJob(job, error, workerId);
        }
      } catch (error) {
        console.error('Outbound email worker loop error:', error);
      }
    }, DEFAULT_POLL_MS);

    return { timer, workerId };
  }
}

module.exports = { OutboundEmailQueueService };
