require("dotenv").config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const LRUCache = require('lru-cache');
const axios = require('axios');
const crypto = require('crypto');
const { generators } = require('openid-client');
const { AuthorizationCode } = require('simple-oauth2');
const { getJwtSecret } = require('../lib/jwtSecret');

// Import custom utilities and Mongoose models
const { getOAuthProvider, getOidcConfig } = require('../lib/auth');
const { track } = require('../lib/hog');
const { forgotPassword } = require('../lib/nodemailer/auth/forgot-password');
const { requirePermission, hasModeratorRole } = require('../lib/roles');
const { checkSession } = require('../lib/session');
const { getOAuthClient } = require('../lib/utils/oauth_client');
const { getOidcClient } = require('../lib/utils/oidc_client');
const User = require('../models/User');
const Session = require('../models/Session');
const PasswordResetToken = require('../models/PasswordResetToken');
const Config = require('../models/Config');
const Notification = require('../models/Notification');
const Note = require('../models/Note');
const EmailQueue = require('../models/EmailQueue');

const router = express.Router();

// --- CACHE SETUP ---
const options = { max: 500, ttl: 1000 * 60 * 5 };
const cache = new LRUCache(options);

// --- LOGIN THROTTLING (in-memory; per IP + email) ---
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map(); // key -> { count, firstAt, blockedUntil }
// Real bcrypt hash computed once; used only to equalise timing for unknown accounts.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function loginBlockedFor(key) {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return Math.ceil((entry.blockedUntil - now) / 1000);
  }
  if (now - entry.firstAt > LOGIN_WINDOW_MS) loginFailures.delete(key);
  return 0;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) entry.blockedUntil = now + LOGIN_WINDOW_MS;
}

function clearLoginFailures(key) {
  loginFailures.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginFailures) {
    if (now - entry.firstAt > LOGIN_WINDOW_MS && (!entry.blockedUntil || entry.blockedUntil < now)) {
      loginFailures.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// --- HELPERS ---
async function getUserEmails(token) {
  const res = await axios.get('https://api.github.com/user/emails', {
    headers: { Authorization: `token ${token}` }
  });
  const primaryEmail = res.data.find(email => email.primary);
  return primaryEmail ? primaryEmail.email : null;
}

function generateRandomPassword(length) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset[randomIndex];
  }
  return password;
}

async function tracking(event, properties) {
  const client = track();
  client.capture({
    event,
    properties,
    distinctId: "uuid",
  });
}

// === AUTH ROUTES ===

// User Registration (admin only)
// User Registration (admin only, simplified)
router.post('/register', requirePermission(['user::create', 'user::manage'], false), async (req, res) => {
  try {
    const { email, password, admin, name } = req.body;

    const sessionUser = await checkSession(req);
    if (!sessionUser) {
      return res.status(401).json({ message: 'Unauthorized', success: false });
    }

    const config = await Config.findOne({});
    if (!config?.roles_active && !sessionUser.isAdmin) {
      return res.status(403).json({ message: 'Forbidden', success: false });
    }

    // Check if email already exists
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash password and save user
    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashed, name, isAdmin: admin || false });
    await newUser.save();

    await tracking('user_registered', { userId: newUser._id });

    res.json({ success: true, message: `User ${name} created successfully!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Something went wrong", success: false });
  }
});


// Login route (password)
// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    if (email.length > 254 || password.length > 256) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const throttleKey = `${req.ip}|${normalizedEmail}`;
    const blockedFor = loginBlockedFor(throttleKey);
    if (blockedFor > 0) {
      res.set('Retry-After', String(blockedFor));
      return res.status(429).json({
        message: `Too many failed attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).`,
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).populate('roles');

    // Always run a bcrypt comparison so response time does not reveal whether the account exists.
    const isPasswordValid = await bcrypt.compare(password, user?.password || DUMMY_BCRYPT_HASH);
    if (!user || !user.password || !isPasswordValid) {
      recordLoginFailure(throttleKey);
      return res.status(401).json({ message: "Invalid email or password" });
    }
    clearLoginFailures(throttleKey);
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    const secretEnv = getJwtSecret();
    if (!secretEnv) {
      return res.status(500).json({ message: "JWT secret not configured" });
    }

    const resolvedRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
    const roleNames = resolvedRoles
      .map((role) => (typeof role?.name === 'string' ? role.name.trim() : ''))
      .filter(Boolean);
    const isAgent = roleNames.some((roleName) => roleName.toLowerCase() === 'agent');
    const rolePermissions = resolvedRoles.flatMap((role) =>
      Array.isArray(role.permissions) ? role.permissions : []
    );
    const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
    let finalPermissions = Array.from(new Set([...rolePermissions, ...directPermissions]));

    if (user.isAdmin || hasModeratorRole({ roles: resolvedRoles }) || resolvedRoles.some((role) => role.name === "Admin")) {
      finalPermissions = ["*"];
    }

    const token = jwt.sign(
      {
        data: {
          id: user._id,
          roles: resolvedRoles.map((role) => role.name),
          permissions: finalPermissions,
          sessionId: crypto.randomBytes(32).toString("hex")
        }
      },
      secretEnv,
      { expiresIn: "8h", algorithm: "HS256" }
    );

    await Session.create({
      userId: user._id,
      sessionToken: token,
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip
    });

    const loginConfig = await Config.findOne({}).lean();

    return res.json({
      token,
      user: {
          id: user._id,
          email: user.email,
          name: user.name,
          roles: roleNames,
          permissions: finalPermissions,
          isAdmin: user.isAdmin,
          isAgent,
          rolesActive: loginConfig?.roles_active === true,
          signature: user.signature || '',
          language: user.language,
          ticket_created: user.notify_ticket_created,
        ticket_status_changed: user.notify_ticket_status_changed,
        ticket_comments: user.notify_ticket_comments,
        ticket_assigned: user.notify_ticket_assigned,
        firstLogin: user.firstLogin,
        external_user: user.external_user,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// External user registration (SSO/new external users)
router.post('/user/register/external', async (req, res) => {
  const { email, password, name, language } = req.body;
  if (await User.findOne({ email })) {
    return res.status(400).json({ message: "Email already exists" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ email, password: hashed, name, isAdmin: false, language, external_user: true, firstLogin: false });
  await user.save();
  await tracking('user_registered_external', { userId: user._id });
  res.json({ success: true });
});

// Forgot Password: send reset code
router.post('/password-reset', async (req, res) => {
  const { email, link } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid email", success: false });
  }
  function generateRandomCode(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  const code = generateRandomCode();
  const uuid = await PasswordResetToken.create({ userId: user._id, code: String(code) });
  forgotPassword(email, String(code), link, uuid._id);
  res.json({ success: true });
});

// Verify reset code
router.post('/password-reset/code', async (req, res) => {
  const { code, uuid } = req.body;
  const reset = await PasswordResetToken.findOne({ code: code, _id: uuid });
  if (!reset) {
    return res.status(401).json({ message: "Invalid Code", success: false });
  }
  res.json({ success: true });
});

// Reset password using code
router.post('/password-reset/password', async (req, res) => {
  const { password, code } = req.body;
  const reset = await PasswordResetToken.findOne({ code: code });
  if (!reset) {
    return res.status(401).json({ message: "Invalid Code", success: false });
  }
  const hashed = await bcrypt.hash(password, 10);
  await User.updateOne({ _id: reset.userId }, { password: hashed });
  res.json({ success: true });
});

// Login route (password)


// Check SSO/OIDC/OAuth config
router.get('/check', async (req, res) => {
  const authtype = await Config.find({ sso_active: true });
  if (authtype.length === 0) {
    return res.json({ success: true, message: "SSO not enabled", oauth: false });
  }
  const provider = authtype[0].sso_provider;
  const sso_active = authtype[0].sso_active;
  if (!sso_active) {
    return res.json({ success: true, message: "SSO not enabled", oauth: false });
  }
  switch (provider) {
   case "oidc": {
  const config = await getOidcConfig();
  if (!config) return res.status(500).json({ error: "OIDC configuration not found" });
  const oidcClient = await getOidcClient(config);
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();

  cache.set(state, { codeVerifier }, options.ttl);
  console.log(`[OIDC START] Stored state ${state} in memory cache`);

  const url = oidcClient.authorizationUrl({
    scope: "openid email profile",
    response_type: "code",
    redirect_uri: config.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: state,
  });
  res.json({ type: "oidc", success: true, url });
  break;
}
    case "oauth": {
      const oauthProvider = await getOAuthProvider();
      if (!oauthProvider) return res.status(500).json({ error: `OAuth provider ${provider} configuration not found` });
      const client = getOAuthClient({ ...oauthProvider, name: oauthProvider.name });
      const uri = client.authorizeURL({ redirect_uri: oauthProvider.redirectUri, scope: oauthProvider.scope });
      res.json({ type: "oauth", success: true, url: uri });
      break;
    }
    default:
      res.json({ success: false, message: `Unknown provider: ${provider}` });
      break;
  }
});

// OIDC callback
// OIDC callback
router.get('/oidc/callback', async (req, res) => {
  try {
    console.log('[OIDC CALLBACK] Request received:', req.query); // Debug log
    
    const oidc = await getOidcConfig();
    const config = await getOidcClient(oidc);
    if (!config) return res.status(500).json({ error: "OIDC configuration not properly set" });
    
    const oidcClient = await getOidcClient(config);
    const params = oidcClient.callbackParams(req);
    
    if (params.iss === "undefined") {
      params.iss = oidc.issuer.replace(/\/\.well-known\/openid-configuration$/, "/");
    }
    const state = params.state;
    console.log('[OIDC CALLBACK] Looking for state in memory cache:', state);
    const sessionData = cache.get(state);

    if (!sessionData) {
      console.error('[OIDC CALLBACK] State not found in memory cache:', state);
      return res.status(400).send("Invalid or expired session");
    }

    const { codeVerifier } = sessionData;
    console.log('[OIDC CALLBACK] Found codeVerifier in memory cache');

    if (!codeVerifier) {
      console.error('[OIDC CALLBACK] No codeVerifier found for state:', state);
      return res.status(400).send("Invalid or expired session");
    }

    cache.delete(state);
    console.log('[OIDC CALLBACK] Deleted state from memory cache:', state);
    let tokens = await oidcClient.callback(
      oidc.redirectUri,
      params,
      { code_verifier: codeVerifier, state }
    );
    
    const userInfo = await oidcClient.userinfo(tokens.access_token);
    let user = await User.findOne({ email: userInfo.email });
    await tracking("user_logged_in_oidc", {});
    
    if (!user) {
      user = await User.create({
        email: userInfo.email,
        password: await bcrypt.hash(generateRandomPassword(12), 10),
        name: userInfo.name || "New User",
        isAdmin: false,
        language: "en",
        external_user: false,
        firstLogin: true,
      });
    }
    
    const secret = getJwtSecret();
    if (!secret) {
      return res.status(500).json({ success: false, message: "JWT secret not configured" });
    }

    const signed_token = jwt.sign({ data: { id: user._id } }, secret, { expiresIn: "8h" });
    
    await Session.create({
      userId: user._id,
      sessionToken: signed_token,
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    
    res.json({ token: signed_token, onboarding: user.firstLogin, success: true });
    
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(403).json({ success: false, error: "OIDC callback error", details: error.message });
  }
});

// OAuth callback
router.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  const oauthProvider = await getOAuthProvider();
  if (!oauthProvider) return res.status(500).json({ error: `OAuth provider configuration not found` });
  const client = new AuthorizationCode({
    client: { id: oauthProvider.clientId, secret: oauthProvider.clientSecret },
    auth: { tokenHost: oauthProvider.authorizationUrl },
  });
  const tokenParams = { code, redirect_uri: oauthProvider.redirectUri };
  try {
    const fetch_token = await client.getToken(tokenParams);
    const access_token = fetch_token.token.access_token;
    const userInfoResponse = await axios.get(
      oauthProvider.userInfoUrl,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const emails = oauthProvider.name === "github"
      ? await getUserEmails(access_token)
      : userInfoResponse.data.email;
    let user = await User.findOne({ email: emails });
    if (!user) {
      return res.json({ success: false, message: "Invalid email" });
    }
    const secret = getJwtSecret();
    if (!secret) {
      return res.status(500).json({ success: false, message: "JWT secret not configured" });
    }

    const signed_token = jwt.sign({ data: { id: user._id } }, secret, { expiresIn: "8h" });
    await Session.create({
      userId: user._id,
      sessionToken: signed_token,
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    await tracking("user_logged_in_oauth", {});
    res.json({ token: signed_token, onboarding: user.firstLogin, success: true });
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(403).json({ success: false, error: "OAuth callback error", details: error.message });
  }
});

// Delete user (admin-protected)
router.delete('/user/:id', 
  requirePermission(['user::delete', 'user::manage'], false),
   async (req, res) => {
  const { id } = req.params;
  if (req.user && String(req.user._id) === String(id)) {
    return res.status(400).json({ message: "You cannot delete your own account", success: false });
  }
  const userToDelete = await User.findById(id);
  if (!userToDelete) return res.status(404).json({ message: "User not found", success: false });
  if (userToDelete.isAdmin) {
    const adminCount = await User.countDocuments({ isAdmin: true });
    if (adminCount <= 1) {
      return res.status(400).json({ message: "Cannot delete the last admin account", success: false });
    }
  }
  await Note.deleteMany({ userId: id });
  await Session.deleteMany({ userId: id });
  await Notification.deleteMany({ userId: id });
  await User.deleteOne({ _id: id });
  res.json({ success: true });
});

// User Profile
router.get('/profile', async (req, res) => {
  const session = await checkSession(req);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }

  const user = await User.findById(session.id).populate('roles');
  if (!user) return res.status(401).json({ message: "Invalid user" });
  const config = await Config.findOne();
  const activeMailbox = await EmailQueue.findOne({
    active: true,
    isDeleted: false,
  }).select('_id');
  const notifications = await Notification.find({ userId: user._id }).sort({ createdAt: -1 });
  const imapEnabled =
    Boolean(activeMailbox) ||
    Boolean(process.env.IMAP_HOST && process.env.IMAP_USER);
  const resolvedRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
  const roleNames = resolvedRoles
    .map((role) => (typeof role?.name === 'string' ? role.name.trim() : ''))
    .filter(Boolean);
  const isAgent = roleNames.some((roleName) => roleName.toLowerCase() === 'agent');
  const profilePermissions = user.isAdmin || hasModeratorRole({ roles: resolvedRoles })
    ? ['*']
    : Array.from(new Set([...resolvedRoles.flatMap((role) => (Array.isArray(role.permissions) ? role.permissions : []))]));
  const data = {
    id: user._id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    isAgent,
    roles: roleNames,
    permissions: profilePermissions,
    rolesActive: config?.roles_active === true,
    signature: user.signature || '',
    language: user.language,
    ticket_created: user.notify_ticket_created,
    ticket_status_changed: user.notify_ticket_status_changed,
    ticket_comments: user.notify_ticket_comments,
    ticket_assigned: user.notify_ticket_assigned,
    sso_status: config && config.sso_active,
    version: config && config.client_version,
    notifications,
    external_user: user.external_user,
    imap_enabled: imapEnabled,
  };
  await tracking("user_profile", {});
  res.json({ user: data });
});

// Reset own password
router.post('/reset-password', async (req, res) => {
  const { password } = req.body;
  const session = await checkSession(req);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }
  const hashedPass = await bcrypt.hash(password, 10);
  await User.updateOne({ _id: session.id }, { password: hashedPass });
  res.json({ success: true });
});

// Reset password by admin
router.post('/admin/reset-password',
    requirePermission(['user::update', 'user::manage'], false),
    async (req, res) => {
  const { password, user: userId } = req.body;
  const session = await checkSession(req);

  if (!session || (!session.isAdmin && !session.permissions.includes('*') && !session.permissions.includes('user::manage'))) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const hashedPass = await bcrypt.hash(password, 10);
  await User.updateOne({ _id: userId }, { password: hashedPass });
  res.json({ success: true });
});

// Update profile/config
router.put('/profile',
   async (req, res) => {
  const session = await checkSession(req);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }

  const { name, email, language, signature } = req.body || {};
  const updates = {};

  if (name !== undefined) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 120) {
      return res.status(422).json({ message: "Name must be 1-120 characters", success: false });
    }
    updates.name = trimmed;
  }
  if (language !== undefined) {
    if (typeof language !== 'string' || !/^[a-zA-Z-]{2,10}$/.test(language)) {
      return res.status(422).json({ message: "Invalid language", success: false });
    }
    updates.language = language;
  }
  if (signature !== undefined) {
    if (typeof signature !== 'string' || signature.length > 2000) {
      return res.status(422).json({ message: "Signature must be at most 2000 characters", success: false });
    }
    updates.signature = signature;
  }
  if (email !== undefined) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(422).json({ message: "Enter a valid email address", success: false });
    }
    const taken = await User.exists({ email: normalized, _id: { $ne: session.id } });
    if (taken) {
      return res.status(409).json({ message: "That email is already in use", success: false });
    }
    updates.email = normalized;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(422).json({ message: "Nothing to update", success: false });
  }

  const user = await User.findByIdAndUpdate(session.id, { $set: updates }, { new: true });
  res.json({ user, success: true });
});

// Change own password: requires the current password, revokes every other session
router.post('/password/change', async (req, res) => {
  const session = await checkSession(req);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(422).json({ message: "Current and new password are required", success: false });
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return res.status(422).json({ message: "New password must be 8-128 characters", success: false });
  }
  const user = await User.findById(session.id);
  const valid = user?.password ? await bcrypt.compare(currentPassword, user.password) : false;
  if (!valid) {
    return res.status(403).json({ message: "Your current password is incorrect", success: false });
  }
  const token = (req.headers.authorization || '').split(' ')[1];
  await User.updateOne({ _id: user._id }, { password: await bcrypt.hash(newPassword, 10) });
  await Session.deleteMany({ userId: user._id, sessionToken: { $ne: token } });
  res.json({ success: true });
});

// Update email notification settings
router.put('/profile/notifcations/emails',
   async (req, res) => {
  const session = await checkSession(req);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }

  const { notify_ticket_created, notify_ticket_assigned, notify_ticket_comments, notify_ticket_status_changed } = req.body;
  const user = await User.findByIdAndUpdate(
    session.id,
    {
      notify_ticket_created,
      notify_ticket_assigned,
      notify_ticket_comments,
      notify_ticket_status_changed,
    },
    { new: true }
  );
  res.json({ user });
});

// Logout - revoke only the session that made this request
router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!req.user || !token) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }
  await Session.deleteOne({ userId: req.user._id, sessionToken: token });
  res.json({ success: true });
});

// Logout - delete all sessions for user
router.get('/user/:id/logout', async (req, res) => {
  const { id } = req.params;
  const session = await checkSession(req);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }

  const canManageUsers = session.permissions.includes('*') || session.permissions.includes('user::manage');
  if (String(session.id) !== String(id) && !session.isAdmin && !canManageUsers) {
    return res.status(403).json({ message: "Forbidden", success: false });
  }

  await Session.deleteMany({ userId: id });
  res.json({ success: true });
});

// Update user role (admin only)
router.put('/user/role',
   requirePermission(['user::manage']), 
   async (req, res) => {
  const session = await checkSession(req);
  if (session && (session.isAdmin || session.permissions.includes('*') || session.permissions.includes('user::manage'))) {
    const { id, role } = req.body;
    if (role === false) {
      const admins = await User.find({ isAdmin: true });
      if (admins.length === 1) {
        return res.status(400).json({ message: "At least one admin required", success: false });
      }
    }
    await User.updateOne({ _id: id }, { isAdmin: role });
    res.json({ success: true });
  } else {
    res.status(401).json({ message: "Unauthorized", success: false });
  }
});

// First login update
router.post('/user/:id/first-login', async (req, res) => {
  const { id } = req.params;
  const session = await checkSession(req);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized", success: false });
  }

  const canManageUsers = session.permissions.includes('*') || session.permissions.includes('user::manage');
  if (String(session.id) !== String(id) && !session.isAdmin && !canManageUsers) {
    return res.status(403).json({ message: "Forbidden", success: false });
  }

  await User.updateOne({ _id: id }, { firstLogin: false });
  await tracking("user_first_login", {});
  res.json({ success: true });
});

// List sessions for current user
router.get('/sessions', async (req, res) => {
  const currentUser = await checkSession(req);
  if (!currentUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const currentToken = (req.headers.authorization || '').split(' ')[1];
  const rows = await Session.find({ userId: currentUser.id, expires: { $gt: new Date() } })
    .select('sessionToken userAgent ipAddress createdAt expires')
    .sort({ createdAt: -1 })
    .lean();
  const sessions = rows.map((row) => ({
    _id: row._id,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt,
    expires: row.expires,
    current: row.sessionToken === currentToken,
  }));
  res.json({ sessions });
});

// Delete specific session
router.delete('/sessions/:sessionId', async (req, res) => {
  const currentUser = await checkSession(req);
  if (!currentUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { sessionId } = req.params;
  const session = await Session.findOne({ _id: sessionId, userId: currentUser.id });
  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }
  await Session.deleteOne({ _id: sessionId });
  res.json({ success: true });
});

module.exports = router;


