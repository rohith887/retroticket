// apps/api/src/lib/session.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const { getJwtSecret } = require('./jwtSecret');

// Validate JWT, confirm the session has not been revoked, and fetch the user with permissions
async function checkSession(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const secret = getJwtSecret();
    if (!secret) {
      // No fallback secret: without configuration nothing can be authenticated.
      return null;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });

    const userId = decoded.data?.id || decoded.userId;
    if (!userId) {
      return null;
    }

    // Logout / "delete session" / expiry must actually invalidate the token.
    const activeSession = await Session.exists({
      userId,
      sessionToken: token,
      expires: { $gt: new Date() },
    });
    if (!activeSession) {
      return null;
    }

    const user = await User.findById(userId).populate('roles').exec();
    if (!user) {
      return null;
    }

    const resolvedRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
    const roleNames = resolvedRoles
      .map((role) => (typeof role?.name === 'string' ? role.name.trim() : ''))
      .filter(Boolean);
    const isAgent = roleNames.some((roleName) => roleName.toLowerCase() === 'agent');
    const rolePermissions = resolvedRoles.flatMap((role) =>
      Array.isArray(role.permissions) ? role.permissions : []
    );
    const permissions = new Set(rolePermissions);

    if (user.isAdmin) {
      permissions.add('*');
    }

    req.user = {
      _id: user._id,
      id: user._id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      isAgent,
      roles: resolvedRoles,
      permissions: Array.from(permissions),
    };

    return req.user;
  } catch (err) {
    return null;
  }
}


// Express middleware version
async function attachUser(req, res, next) {
  const user = await checkSession(req);
  if (user) {
    req.user = user;
  }
  next();
}

module.exports = {
  checkSession,
  attachUser,
};
