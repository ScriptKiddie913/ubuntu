// ============================================================================
// SoTaNik_AI Data Lake — Hardened Super-Admin Authorization Middleware
// Only sagnik.saha.raptor@gmail.com has super-admin rights to manage tenants,
// perform complete user + cloud deletions, and allocate public storage nodes.
// ============================================================================

const crypto = require('crypto');

const DEFAULT_ADMIN_EMAIL = 'sagnik.saha.raptor@gmail.com';

/**
 * Normalizes email: strips zero-width/invisible unicode characters,
 * trims, lowercases, and applies NFKC canonical normalization.
 */
function cleanEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim()
    .toLowerCase()
    .normalize('NFKC');
}

/**
 * Constant-time string comparison using SHA-256 digests
 * to eliminate timing attack vectors.
 */
function timingSafeEmailCompare(a, b) {
  if (!a || !b) return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// In-memory sliding-window rate limiter for admin endpoints
const adminRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ADMIN_REQUESTS_PER_MINUTE = 60;

function isRateLimited(ip) {
  const now = Date.now();
  let entry = adminRateLimits.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 1 };
    adminRateLimits.set(ip, entry);
    return false;
  }
  entry.count++;
  return entry.count > MAX_ADMIN_REQUESTS_PER_MINUTE;
}

// Sweep rate limiter map every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of adminRateLimits.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      adminRateLimits.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = function requireAdmin(req, res, next) {
  const clientIp = (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown-ip'
  );

  // 1. Rate-limiting check
  if (isRateLimited(clientIp)) {
    console.warn(`[SECURITY ALERT] Admin rate limit exceeded by IP: ${clientIp} on ${req.method} ${req.originalUrl}`);
    return res.status(429).json({
      error: 'Too many administrative requests. Request throttled for security.',
    });
  }

  // 2. Authentication check
  if (!req.userId || !req.userEmail) {
    console.warn(`[SECURITY ALERT] Unauthenticated admin endpoint attempt from IP: ${clientIp} to ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Authentication required.' });
  }

  // 3. Email confirmation verification
  const isConfirmed = req.userConfirmedAt || (req.user && req.user.email_confirmed_at);
  if (!isConfirmed) {
    console.warn(`[SECURITY ALERT] Unconfirmed email admin attempt by "${req.userEmail}" (ID: ${req.userId}) from IP: ${clientIp}`);
    return res.status(403).json({
      error: 'Access denied: Email address must be verified before administrative access is granted.',
    });
  }

  // 4. Canonical email matching with timing-safe hash comparison
  const targetAdminEmail = cleanEmail(process.env.SUPER_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);
  const callerEmail = cleanEmail(req.userEmail);

  const emailMatches = timingSafeEmailCompare(callerEmail, targetAdminEmail);

  // 5. Optional strict UUID check if configured in environment
  const requiredAdminId = (process.env.SUPER_ADMIN_USER_ID || '').trim();
  let idMatches = true;
  if (requiredAdminId) {
    idMatches = req.userId === requiredAdminId;
  }

  if (!emailMatches || !idMatches) {
    console.error(`[SECURITY ALERT] Unauthorized admin access attempt! IP: ${clientIp}, User: ${req.userId}, Email: "${req.userEmail}", Target: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({
      error: 'Access denied. This endpoint requires verified Super-Admin authorization.',
    });
  }

  // Attach verified admin audit metadata
  req.isAdmin = true;
  req.adminAudit = {
    adminEmail: targetAdminEmail,
    adminId: req.userId,
    ip: clientIp,
    timestamp: new Date().toISOString(),
  };

  next();
};
