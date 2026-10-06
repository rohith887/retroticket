const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const Role = require('../models/Role');
const Session = require('../models/Session');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const { checkSession } = require('../lib/session');

function canManageUsers(session) {
  return Boolean(
    session &&
      (session.isAdmin || session.permissions.includes('*') || session.permissions.includes('user::manage'))
  );
}

// All users
router.get(
  '/all',
  requirePermission(['user::read']),
  async (req, res) => {
    try {
      const [users, sessionCounts] = await Promise.all([
        User.find({ external_user: false })
          .select('name email isAdmin roles createdAt lastLoginAt')
          .populate('roles', 'name')
          .sort({ name: 1 })
          .lean(),
        Session.aggregate([
          { $match: { expires: { $gt: new Date() } } },
          { $group: { _id: '$userId', count: { $sum: 1 } } },
        ]),
      ]);
      const sessionsByUser = new Map(sessionCounts.map((row) => [String(row._id), row.count]));

      res.send({
        users: users.map((user) => ({
          id: String(user._id),
          name: user.name,
          email: user.email,
          isAdmin: Boolean(user.isAdmin),
          roles: (user.roles || []).filter(Boolean).map((role) => ({ id: String(role._id), name: role.name })),
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt || null,
          activeSessions: sessionsByUser.get(String(user._id)) || 0,
        })),
        success: true
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to fetch users'
      });
    }
  }
);

// Update a user's name, admin flag and roles
router.patch(
  '/:id',
  requirePermission(['user::update', 'user::manage'], false),
  async (req, res) => {
    try {
      const session = await checkSession(req);
      if (!canManageUsers(session)) {
        return res.status(403).send({ success: false, message: 'Unauthorized' });
      }

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: 'Invalid user id' });
      }
      const target = await User.findById(id);
      if (!target) {
        return res.status(404).send({ success: false, message: 'User not found' });
      }

      const { name, admin, roleIds } = req.body || {};
      const updates = {};

      if (name !== undefined) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed || trimmed.length > 120) {
          return res.status(422).send({ success: false, message: 'Name must be 1-120 characters' });
        }
        updates.name = trimmed;
      }

      if (admin !== undefined) {
        if (typeof admin !== 'boolean') {
          return res.status(422).send({ success: false, message: 'admin must be true or false' });
        }
        if (target.isAdmin && !admin) {
          if (String(session.id) === String(id)) {
            return res.status(400).send({ success: false, message: 'You cannot remove your own admin access' });
          }
          const adminCount = await User.countDocuments({ isAdmin: true });
          if (adminCount <= 1) {
            return res.status(400).send({ success: false, message: 'At least one admin is required' });
          }
        }
        updates.isAdmin = admin;
      }

      if (roleIds !== undefined) {
        if (!Array.isArray(roleIds) || roleIds.length > 10 || !roleIds.every((rid) => mongoose.Types.ObjectId.isValid(rid))) {
          return res.status(422).send({ success: false, message: 'roleIds must be a list of valid role ids' });
        }
        const found = await Role.countDocuments({ _id: { $in: roleIds } });
        if (found !== new Set(roleIds.map(String)).size) {
          return res.status(422).send({ success: false, message: 'One or more roles do not exist' });
        }
        updates.roles = roleIds;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(422).send({ success: false, message: 'Nothing to update' });
      }

      await User.updateOne({ _id: id }, { $set: updates });

      // Keep the Role.users back-references consistent with the user's roles.
      if (updates.roles) {
        await Role.updateMany({ users: id }, { $pull: { users: id } });
        await Role.updateMany({ _id: { $in: updates.roles } }, { $addToSet: { users: id } });
      }

      res.send({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).send({ success: false, message: 'Failed to update user' });
    }
  }
);

// New user
router.post(
  '/new',
  requirePermission(['user::create', 'user::manage'], false),
  async (req, res) => {
    try {
      const session = await checkSession(req);
      
      if (session && (session.isAdmin || session.permissions.includes('*') || session.permissions.includes('user::manage'))) {
        const { email, password, name, admin } = req.body;

        const e = email.toLowerCase();
        const hash = await bcrypt.hash(password, 10);

        const newUser = new User({
          name,
          email: e,
          password: hash,
          isAdmin: admin
        });

        await newUser.save();

        // Track event (uncomment if you implement tracking)
        // const client = track();
        // client.capture({
        //   event: 'user_created',
        //   distinctId: 'uuid',
        // });
        // client.shutdownAsync();

        res.send({
          success: true
        });
      } else {
        res.status(403).send({ message: 'Unauthorized', failed: true });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to create user'
      });
    }
  }
);

// (ADMIN) Reset password
router.put(
  '/reset-password',
  requirePermission(['user::update', 'user::manage'], false),
  async (req, res) => {
    try {
      const { password, id } = req.body || {};
      const session = await checkSession(req);

      if (canManageUsers(session)) {
        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
          return res.status(422).send({ message: 'Password must be 8-128 characters', failed: true });
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid user id', failed: true });
        }
        const hashedPass = await bcrypt.hash(password, 10);

        const result = await User.updateOne({ _id: id }, {
          password: hashedPass,
          updatedAt: Date.now()
        });
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'User not found', failed: true });
        }

        // A password reset must end the user's existing sessions (unless an admin is resetting their own).
        if (String(session.id) !== String(id)) {
          await Session.deleteMany({ userId: id });
        }

        res.status(201).send({ message: 'password updated success', failed: false });
      } else {
        res.status(403).send({ message: 'Unauthorized', failed: true });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to reset password'
      });
    }
  }
);

// Mark Notification as read
router.get(
  '/notification/:id',
  requirePermission(['user::read', 'issue::read'], false),
  async (req, res) => {
    try {
      const { id } = req.params;
      const session = await checkSession(req);
      
      if (!session) {
        return res.status(401).send({
          message: 'Unauthorized',
          success: false
        });
      }

      // Get the notification and verify it belongs to the user
      const notification = await Notification.findById(id);
      
      if (!notification) {
        return res.status(404).send({
          message: 'Notification not found',
          success: false
        });
      }
      
      if (notification.userId.toString() !== String(session.id)) {
        return res.status(403).send({
          message: 'Access denied. You can only manage your own notifications.',
          success: false
        });
      }

      await Notification.findByIdAndUpdate(id, {
        read: true
      });

      res.send({
        success: true
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to update notification'
      });
    }
  }
);

module.exports = router;
