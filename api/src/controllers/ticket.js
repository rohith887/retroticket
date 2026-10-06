require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { checkToken } = require('../lib/jwt');
const { track } = require('../lib/hog');
const { sendAssignedEmail } = require('../lib/nodemailer/ticket/assigned');
// const { sendComment } = require('../lib/services/emailService');
const { sendTicketCreate } = require('../lib/nodemailer/ticket/create');
const { sendTicketStatus } = require('../lib/nodemailer/ticket/status');
const { assignedNotification } = require('../lib/services/notifications/issue/assigned');
const { commentNotification } = require('../lib/services/notifications/issue/comment');
const { priorityNotification } = require('../lib/services/notifications/issue/priority');
const { activeStatusNotification, statusUpdateNotification } = require('../lib/services/notifications/issue/status');
const { sendWebhookNotification } = require('../lib/services/notifications/webhook');
const { requirePermission } = require('../lib/roles');
const { withUserUnread, markTicketRead } = require('../lib/unread');
const { sendTicketReply, cancelTicketReply, retryTicketReply } = require('../lib/ticketMail');
const { actorFrom, logActivity, personRef } = require('../lib/activity');
const Activity = require('../models/Activity');
const { checkSession } = require('../lib/session'); 
const Ticket = require('../models/Ticket');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const TimeTracking = require('../models/TimeTracking');
const EmailTemplate = require('../models/EmailTemplate');
const Webhook = require('../models/Webhook');
const User = require('../models/User');
const Client = require('../models/Client');

const router = express.Router();

const ticketPopulate = [
  { path: 'clientId', select: 'id name number notes' },
  { path: 'assignedTo', select: 'id name' },
  { path: 'team', select: 'id name' }
];

const normalizeTicket = (ticketDoc) => {
  const ticket = typeof ticketDoc?.toObject === 'function' ? ticketDoc.toObject() : ticketDoc;
  if (!ticket) return ticket;

  return {
    ...ticket,
    client: ticket.client || ticket.clientId || null,
  };
};

const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

// Create ticket
router.post(
  "/create",
  requirePermission(["issue::create"]),
  async (req, res) => {
    try {
      const {
        name,
        company,
        detail,
        title,
        priority,
        email,
        engineer,
        type,
        createdBy,
      } = req.body;

      const user = await checkSession(req);

      // const ticketData = {
      //   name,
      //   title,
      //   detail: JSON.stringify(detail),
      //   priority: priority ? priority : "low",
      //   email,
      //   type: type ? type.toLowerCase() : "support",
      //   // createdBy: createdBy ? {
      //   //   id: createdBy.id,
      //   //   name: createdBy.name,
      //   //   role: createdBy.role,
      //   //   email: createdBy.email,
      //   // } : undefined,
      //   fromImap: false,
      //   isComplete: false,
      // };

      // if (company) {
      //   ticketData.client = company.id || company;
      // }

      // if (engineer && engineer.name !== "Unassigned") {
      //   ticketData.assignedTo = engineer.id;
      // }

const ticketData = {
  name,
  title,
  detail: typeof detail === "object" ? JSON.stringify(detail) : detail,
  priority: priority || "low",
  email,
  type: type ? type.toLowerCase() : "support",
  createdBy: createdBy || user?._id, // session user or provided ID
  fromImap: false,
  isComplete: false,
  number: req.body.number
   };

if (company) {
  ticketData.client = company.id || company;
}

if (engineer && engineer !== "Unassigned") {
  ticketData.assignedTo = engineer.id || engineer;
}


      const ticket = await Ticket.create(ticketData);
      await logActivity(ticket._id, 'ticket_created', actorFrom(user), {});

      if (email && validateEmail(email)) {
        await sendTicketCreate(ticket);
      }

      if (engineer && engineer.name !== "Unassigned") {
        const assignedUser = await User.findById(ticket.assignedTo);
        if (assignedUser) {
          await sendAssignedEmail(assignedUser.email);
          await assignedNotification(engineer, ticket, user);
        }
      }

      const webhooks = await Webhook.find({ type: "ticket_created", active: true });
      for (const webhook of webhooks) {
        const message = {
          event: "ticket_created",
          id: ticket._id,
          title: ticket.title,
          priority: ticket.priority,
          email: ticket.email,
          name: ticket.name,
          type: ticket.type,
          createdBy: ticket.createdBy,
          assignedTo: ticket.assignedTo,
          client: ticket.client,
        };
        await sendWebhookNotification(webhook, message);
      }

      const hog = track();
      hog.capture({
        event: "ticket_created",
        distinctId: ticket._id.toString(),
      });

      res.status(200).send({
        message: "Ticket created correctly",
        success: true,
        id: ticket._id,
      });
    } catch (error) {
      console.error("Error creating ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Public ticket creation
router.post(
  "/public/create",
  async (req, res) => {
    try {
      const {
        name,
        company,
        detail,
        title,
        priority,
        email,
        engineer,
        type,
        createdBy,
        number
      } = req.body;

       let creatorId = createdBy || null;

        // ✅ If no createdBy provided, create/find a Guest user
    if (!creatorId) {
      let guest = await User.findOne({ email: "guest@system.local" });
      if (!guest) {
        guest = await User.create({
          name: "Guest",
          email: "guest@system.local",
          password: "guest123", // hashed automatically if you have middleware
          role: "guest"
        });
      }
      creatorId = guest._id;
    }

  const ticketData = {
  name,
  title,
  detail: JSON.stringify(detail),
  priority: priority || "low",
  email,
  type: type ? type.toLowerCase() : "support",
  createdBy: createdBy || user?._id,
  fromImap: false,
  isComplete: false
    };

    if (company) {
      ticketData.client = company.id || company;
    }

   if (engineer && engineer !== "Unassigned") {
     ticketData.assignedTo = engineer.id || engineer;
    }


      const ticket = await Ticket.create(ticketData);
      await logActivity(ticket._id, 'ticket_created', { type: 'contact', id: null, name: ticket.name }, {});

      if (email && validateEmail(email)) {
        await sendTicketCreate(ticket);
      }

      if (engineer && engineer.name !== "Unassigned") {
        const assignedUser = await User.findById(ticket.assignedTo);
        if (assignedUser) {
          await sendAssignedEmail(assignedUser.email);
          const user = await checkSession(req);
          await assignedNotification(engineer, ticket, user);
        }
      }

      const webhooks = await Webhook.find({ type: "ticket_created", active: true });
      for (const webhook of webhooks) {
        const message = {
          event: "ticket_created",
          id: ticket._id,
          title: ticket.title,
          priority: ticket.priority,
          email: ticket.email,
          name: ticket.name,
          type: ticket.type,
          createdBy: ticket.createdBy,
          assignedTo: ticket.assignedTo,
          client: ticket.client,
        };
        await sendWebhookNotification(webhook, message);
      }

      const hog = track();
      hog.capture({
        event: "ticket_created",
        distinctId: ticket._id.toString(),
      });

      res.status(200).send({
        message: "Ticket created correctly",   
        success: true,
        id: ticket._id,
      });
    } catch (error) {
      console.error("Error creating public ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get ticket by IDx
router.get(
  "/:id",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const ticket = await Ticket.findById(id)
        .populate(ticketPopulate);

      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const timeTracking = await TimeTracking.find({ ticketId: id })
        .populate('userId', 'name');

      const comments = await Comment.find({ ticketId: id })
        .sort({ seq: 1, createdAt: 1 })
        .populate('userId', 'name');

      // Opening a ticket marks it read for this user only.
      await markTicketRead(req.user?._id, ticket);

      const files = []; // Assuming you have a TicketFile model

      const activities = await Activity.find({ ticketId: id }).sort({ at: 1 }).limit(300).lean();

      const result = {
        ...normalizeTicket(ticket),
        activities,
        comments,
        TimeTracking: timeTracking,
        files
      };

      res.send({
        ticket: result,
        success: true,
      });
    } catch (error) {
      console.error("Error fetching ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all open tickets
router.get(
  "/tickets/open",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const tickets = await Ticket.find({ isComplete: false, hidden: false })
        .sort({ createdAt: -1 })
        .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching open tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Search tickets--------------------------->
router.post(
  "/tickets/search",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const { query } = req.body;

      const tickets = await Ticket.find({
        title: { $regex: query, $options: 'i' }
      });

      res.send({
        tickets: tickets,
        success: true,
      });
    } catch (error) {
      console.error("Error searching tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all tickets (admin)
router.get(
  "/tickets/all",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      // const bearer = req.headers.authorization?.split(" ")[1];
      // const token = checkToken(bearer);

      const tickets = await Ticket.find({ hidden: false })
        .sort({ createdAt: -1 })
        .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching all tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get user's open tickets
router.get(
  "/tickets/user/open",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user) {
        return res.status(401).send({ success: false, message: "Unauthorized" });
      }

      const tickets = await Ticket.find({
        isComplete: false,
        assignedTo: user._id,
        hidden: false
      })
      .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching user open tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get completed tickets
router.get(
  "/tickets/completed",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const tickets = await Ticket.find({ isComplete: true, hidden: false })
        .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching completed tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get unassigned tickets
router.get(
  "/tickets/unassigned",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const tickets = await Ticket.find({
        isComplete: false,
        assignedTo: null,
        hidden: false
      });

      res.send({
        success: true,
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
      });
    } catch (error) {
      console.error("Error fetching unassigned tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Assign or unassign ticket
router.patch(
  "/assign/:id",
  requirePermission(["issue::update"]),
  async (req, res) => {
    try {
      const actingUser = await checkSession(req);
      if (!actingUser) {
        return res.status(401).send({ success: false, message: "Unauthorized" });
      }

      const { id } = req.params;
      const { assignedTo } = req.body;

      const ticket = await Ticket.findById(id);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const previousAssignee = ticket.assignedTo ? String(ticket.assignedTo) : null;
      ticket.assignedTo = assignedTo || null;
      await ticket.save();

      if (previousAssignee !== (assignedTo ? String(assignedTo) : null)) {
        await logActivity(ticket._id, assignedTo ? 'assigned' : 'unassigned', actorFrom(actingUser), {
          from: await personRef(previousAssignee),
          to: await personRef(assignedTo),
        });
      }

      const populatedTicket = await Ticket.findById(ticket._id).populate(ticketPopulate);

      res.send({
        success: true,
        ticket: normalizeTicket(populatedTicket),
      });
    } catch (error) {
      console.error("Error assigning ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Update ticket
router.put(
  "/ticket/update",
  requirePermission(["issue::update"]),
  async (req, res) => {
    try {
      const { id, note, detail, title, priority, status, client } = req.body;
      const user = await checkSession(req);

      const issue = await Ticket.findById(id);
      if (!issue) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const updateData = {
        detail,
        note,
        title,
        priority,
        status
      };

      if (client) {
        updateData.client = client;
      }

      await Ticket.findByIdAndUpdate(id, updateData);

      const actor = actorFrom(user);
      if (priority && issue.priority !== priority) await logActivity(id, 'priority_changed', actor, { from: issue.priority, to: priority });
      if (status && issue.status !== status) await logActivity(id, 'status_changed', actor, { from: issue.status || 'open', to: status });
      if (title && issue.title !== title) await logActivity(id, 'subject_changed', actor, { from: issue.title, to: title });

      if (priority && issue.priority !== priority) {
        await priorityNotification(issue, user, issue.priority, priority);
      }

      if (status && issue.status !== status) {
        await statusUpdateNotification(issue, user, status);
      }

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error updating ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Transfer ticket to another user
// Transfer ticket
router.post(
  "/ticket/transfer",
  requirePermission(["issue::transfer"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user || !user._id) {
        return res.status(401).send({
          success: false,
          message: "Unauthorized: user not found in session",
        });
      }

      const { ticketId, newAssigneeId } = req.body;

      if (!ticketId || !newAssigneeId) {
        return res.status(400).send({
          success: false,
          message: "ticketId and newAssigneeId are required",
        });
      }

      // Find the ticket
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found",
        });
      }

      // Update ticket assignee
      const previousAssignee = ticket.assignedTo ? String(ticket.assignedTo) : null;
      ticket.assignedTo = newAssigneeId;
      await ticket.save();
      await logActivity(ticket._id, 'assigned', actorFrom(user), { from: await personRef(previousAssignee), to: await personRef(newAssigneeId), via: 'transfer' });

      // Create notification for the new assignee
      await Notification.create({
        userId: newAssigneeId,
        ticketId: ticket._id,
        title: "Ticket Transferred",
        message: `Ticket "${ticket.title}" has been transferred to you.`,
        text: `You are now assigned to ticket: ${ticket.title}`,
        type: "info",
        relatedEntity: "ticket",
        relatedEntityId: ticket._id,
      });

      // Optionally: Send email notification
      try {
        await sendAssignedEmail("newassignee@email.com"); // replace with actual email lookup
      } catch (err) {
        console.error("Error sending assigned email:", err.message);
      }

      res.send({
        success: true,
        message: "Ticket transferred successfully",
      });
    } catch (error) {
      console.error("Error transferring ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);


// Transfer ticket to another client
// Transfer ticket to another client
// Transfer ticket to another client
router.post(
  "/transfer/client",
  requirePermission(["issue::transfer"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user || !user._id) {
        return res.status(401).send({
          success: false,
          message: "Unauthorized: user not found in session",
        });
      }

      const { clientId, ticketId } = req.body;

      if (!clientId || !ticketId) {
        return res.status(400).send({
          success: false,
          message: "clientId and ticketId are required",
        });
      }

      // Find ticket
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found",
        });
      }

      // Find client
      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).send({
          success: false,
          message: "Client not found",
        });
      }

      // Update ticket with both clientId and clientName
      const previousClient = ticket.clientName || null;
      ticket.clientId = client._id;
      ticket.clientName = client.name;
      await ticket.save();
      await logActivity(ticket._id, 'client_changed', actorFrom(user), { from: previousClient, to: client.name });

      // Create notification
      await Notification.create({
        userId: user._id,
        ticketId: ticket._id,
        title: "Ticket Client Transfer",
        message: `Ticket "${ticket.title}" has been transferred to client "${client.name}".`,
        text: `The ticket "${ticket.title}" is now assigned to client "${client.name}".`,
        type: "info",
        relatedEntity: "client",
        relatedEntityId: client._id,
      });

      res.send({
        success: true,
        message: `Ticket transferred to client "${client.name}" successfully`,
      });
    } catch (error) {
      console.error("Error transferring ticket to client:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }
);


// Add comment to ticket
router.post(
  "/ticket/comment",
  requirePermission(["issue::comment"]),
  async (req, res) => {
    try {
      const { text, id, public: public_comment, clientMessageId } = req.body;
      const user = await checkSession(req);

      if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        return res.status(400).send({ success: false, message: "A valid ticket id is required" });
      }
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).send({ success: false, message: "Message text is required" });
      }

      const ticket = await Ticket.findById(id);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const isPublic = public_comment === true || public_comment === "true";
      const cid = typeof clientMessageId === "string" && clientMessageId.trim() ? clientMessageId.trim().slice(0, 64) : undefined;

      // A retried request with the same clientMessageId returns the message it already created.
      if (cid) {
        const existing = await Comment.findOne({ ticketId: ticket._id, clientMessageId: cid });
        if (existing) {
          return res.send({ success: true, created: false, comment: existing, emailed: existing.delivery?.status === "queued" || existing.delivery?.status === "sent" });
        }
      }

      let comment;
      try {
        comment = await Comment.create({
          text: text.trim(),
          public: isPublic,
          direction: isPublic ? "outbound" : "internal",
          ticketId: ticket._id,
          userId: user._id,
          authorName: user.name || null,
          authorEmail: user.email || null,
          clientMessageId: cid,
        });
      } catch (error) {
        // Two identical requests raced: the unique index let one through.
        if (error?.code === 11000 && cid) {
          const existing = await Comment.findOne({ ticketId: ticket._id, clientMessageId: cid });
          if (existing) return res.send({ success: true, created: false, comment: existing });
        }
        throw error;
      }

      // Public replies go to the requester through the durable outbound queue (after a short undo window).
      let email = { queued: false, reason: null };
      if (isPublic) {
        try {
          email = await sendTicketReply({ ticket, comment, actor: { id: String(user._id), name: user.name } });
        } catch (error) {
          console.error("Could not queue the reply email:", error);
          email = { queued: false, reason: "The reply was saved but could not be queued for email." };
        }
      }

      await commentNotification(ticket, user);

      const hog = track();
      hog.capture({
        event: "ticket_comment",
        distinctId: ticket._id.toString(),
      });

      const saved = await Comment.findById(comment._id).populate("userId", "name");
      res.send({
        success: true,
        created: true,
        comment: saved,
        emailed: email.queued,
        emailNote: email.queued ? null : email.reason,
        sendAfter: email.sendAfter || null,
      });
    } catch (error) {
      console.error("Error adding comment:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Undo a reply before it is sent
router.post(
  "/comment/:id/undo",
  requirePermission(["issue::comment"]),
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send({ success: false, message: "Invalid comment id" });
      const canceled = await cancelTicketReply(req.params.id);
      if (!canceled) return res.status(409).send({ success: false, message: "This message has already been sent." });
      res.send({ success: true });
    } catch (error) {
      console.error("Error undoing reply:", error);
      res.status(500).send({ success: false, message: "Internal server error" });
    }
  }
);

// Retry a reply whose email could not be delivered
router.post(
  "/comment/:id/retry",
  requirePermission(["issue::comment"]),
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send({ success: false, message: "Invalid comment id" });
      const retried = await retryTicketReply(req.params.id);
      if (!retried) return res.status(409).send({ success: false, message: "Nothing to retry for this message." });
      res.send({ success: true });
    } catch (error) {
      console.error("Error retrying reply:", error);
      res.status(500).send({ success: false, message: "Internal server error" });
    }
  }
);

// Delete comment
router.post(
  "/comment/delete",
  requirePermission(["issue::comment"]),
  async (req, res) => {
    try {
      const { id } = req.body;

      await Comment.findByIdAndDelete(id);

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Update ticket status
router.put(
  "/status/update",
  requirePermission(["issue::update"]),
  async (req, res) => {
    try {
      const { status, id } = req.body;
      const user = await checkSession(req);

      const before = await Ticket.findById(id).select('isComplete').lean();
      const ticket = await Ticket.findByIdAndUpdate(
        id,
        { isComplete: status },
        { new: true }
      );
      if (ticket && Boolean(before?.isComplete) !== Boolean(status)) {
        await logActivity(ticket._id, status ? 'resolved' : 'reopened', actorFrom(user), {});
      }

      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      await activeStatusNotification(ticket, user, status);
      await sendTicketStatus(ticket);

      const webhooks = await Webhook.find({ type: "ticket_status_changed", active: true });
      for (const webhook of webhooks) {
        const s = status ? "Completed" : "Outstanding";
        if (webhook.url.includes("discord.com")) {
          const message = {
            content: `Ticket ${ticket._id} created by ${ticket.email}, has had its status changed to ${s}`,
            avatar_url: "https://avatars.githubusercontent.com/u/76014454?s=200&v=4",
            username: "Peppermint.sh",
          };
          await axios.post(webhook.url, message);
        } else {
          await axios.post(webhook.url, {
            data: `Ticket ${ticket._id} created by ${ticket.email}, has had its status changed to ${s}`,
          });
        }
      }

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error updating ticket status:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Hide ticket
router.put(
  "/status/hide",
  requirePermission(["issue::update"]),
  async (req, res) => {
    try {
      const { hidden, id } = req.body;

      await Ticket.findByIdAndUpdate(id, { hidden });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error hiding ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Lock ticket
router.put(
  "/status/lock",
  requirePermission(["issue::update"]),
  async (req, res) => {
    try {
      const { locked, id } = req.body;

      await Ticket.findByIdAndUpdate(id, { locked });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error locking ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Delete ticket
router.post(
  "/delete",
  requirePermission(["issue::delete"]),
  async (req, res) => {
    try {
      const { id } = req.body;

      await Ticket.findByIdAndDelete(id);

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get email templates
router.get(
  "/tickets/templates",
  requirePermission(["email_template::manage"]),
  async (req, res) => {
    try {
      const templates = await EmailTemplate.find({})
        .select('createdAt updatedAt type id');

      res.send({
        success: true,
        templates: templates,
      });
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get template by ID
router.get(
  "/template/:id",
  requirePermission(["email_template::manage"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const template = await EmailTemplate.findById(id);

      res.send({
        success: true,
        template: template,
      });
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Update template
router.put(
  "/template/:id",
  requirePermission(["email_template::manage"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { html } = req.body;

      await EmailTemplate.findByIdAndUpdate(id, { html });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get external user's open tickets
router.get(
  "/user/open/external",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user) {
        return res.status(401).send({ success: false, message: "Unauthorized" });
      }

      const tickets = await Ticket.find({
        isComplete: false,
        email: user.email,
        hidden: false
      })
      .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching external user tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get external user's closed tickets
router.get(
  "/user/closed/external",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user) {
        return res.status(401).send({ success: false, message: "Unauthorized" });
      }

      const tickets = await Ticket.find({
        isComplete: true,
        email: user.email,
        hidden: false
      })
      .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching external user closed tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all external user tickets
router.get(
  "/user/external",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      if (!user) {
        return res.status(401).send({ success: false, message: "Unauthorized" });
      }

      const tickets = await Ticket.find({
        email: user.email,
        hidden: false
      })
      .populate(ticketPopulate);

      res.send({
        tickets: await withUserUnread(tickets.map(normalizeTicket), req.user?._id, 'ticket'),
        success: true,
      });
    } catch (error) {
      console.error("Error fetching all external user tickets:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Subscribe to ticket
router.get(
  "/subscribe/:id",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await checkSession(req);

      if (!user || !user._id) {
        return res.status(401).send({
          success: false,
          message: "Unauthorized: user not found in session"
        });
      }

      const ticket = await Ticket.findById(id);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const following = ticket.following || [];

      // Ensure values are strings before comparing
      const userId = user._id.toString();
      if (following.includes(userId)) {
        return res.send({
          success: false,
          message: "You are already following this issue"
        });
      }

      following.push(userId);
      await Ticket.findByIdAndUpdate(id, { following });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error subscribing to ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Unsubscribe from ticket
router.get(
  "/unsubscribe/:id",
  requirePermission(["issue::read"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await checkSession(req);

      const ticket = await Ticket.findById(id);
      if (!ticket) {
        return res.status(404).send({
          success: false,
          message: "Ticket not found"
        });
      }

      const following = ticket.following || [];
      if (!following.includes(user._id.toString())) {
        return res.send({
          success: false,
          message: "You are not following this issue"
        });
      }

      const updatedFollowing = following.filter(userId => userId !== user._id.toString());
      await Ticket.findByIdAndUpdate(id, { following: updatedFollowing });

      res.send({
        success: true,
      });
    } catch (error) {
      console.error("Error unsubscribing from ticket:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

module.exports = router;
