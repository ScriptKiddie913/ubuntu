const { Storage } = require('megajs');
const { encrypt, decrypt } = require('./crypto');
const db = require('./db');

// Live MEGA sessions are cached in memory, keyed by `${userId}:${label}` so two
// different users can each use the same label (e.g. both calling an account
// "personal") without colliding.
const sessions = new Map();
const QUOTA_TTL_MS = 30 * 1000;

function sessionKey(userId, label) {
  return `${userId}:${label}`;
}

async function login(email, password, secondFactorCode) {
  const options = {
    email,
    password,
    userAgent: 'MegaPool/1.0',
  };
  if (secondFactorCode) options.secondFactorCode = secondFactorCode;
  const storage = await new Storage(options).ready;
  return storage;
}

async function addAccount(userId, { label, email, password, secondFactorCode }) {
  if (!label || !email || !password) {
    throw new Error('label, email and password are all required.');
  }

  const storage = await login(email, password, secondFactorCode); // throws on bad credentials/2FA
  sessions.set(sessionKey(userId, label), { storage, quota: null, quotaAt: 0 });

  await db.insertAccount(userId, { label, email, passwordEncrypted: encrypt(password) });

  return { label, email };
}

// Note: there is deliberately no removeAccount function. Once an account joins a
// user's pool it stays part of it permanently — see the comment in
// src/routes/accounts.js for why. RLS backs this up (no UPDATE/DELETE policy on
// mega_accounts) as a second layer.

async function getSession(userId, label) {
  const key = sessionKey(userId, label);
  const cached = sessions.get(key);
  if (cached) return cached.storage;

  const account = await db.findAccount(userId, label);
  if (!account) throw new Error(`Unknown MEGA account label "${label}".`);

  const storage = await login(account.email, decrypt(account.passwordEncrypted));
  sessions.set(key, { storage, quota: null, quotaAt: 0 });
  return storage;
}

// Re-logs in a single account (used after auth/session errors) and returns the fresh storage.
async function reloginAccount(userId, label) {
  sessions.delete(sessionKey(userId, label));
  return getSession(userId, label);
}

async function getQuota(userId, label) {
  const key = sessionKey(userId, label);
  const now = Date.now();
  const cached = sessions.get(key);
  if (cached && cached.quota && now - cached.quotaAt < QUOTA_TTL_MS) {
    return cached.quota;
  }

  const storage = await getSession(userId, label);
  let info;
  try {
    info = await storage.getAccountInfo();
  } catch (err) {
    // Session may have gone stale — try exactly once more after a fresh login.
    const fresh = await reloginAccount(userId, label);
    info = await fresh.getAccountInfo();
  }
  const quota = { spaceUsed: info.spaceUsed, spaceTotal: info.spaceTotal };
  const entry = sessions.get(key);
  entry.quota = quota;
  entry.quotaAt = now;
  return quota;
}

async function listAccountsWithUsage(userId) {
  const accounts = await db.listAccounts(userId);
  const results = [];
  for (const acc of accounts) {
    try {
      const quota = await getQuota(userId, acc.label);
      results.push({
        label: acc.label,
        email: acc.email,
        spaceUsed: quota.spaceUsed,
        spaceTotal: quota.spaceTotal,
        spaceFree: Math.max(0, quota.spaceTotal - quota.spaceUsed),
        status: 'ok',
      });
    } catch (err) {
      results.push({
        label: acc.label,
        email: acc.email,
        spaceUsed: 0,
        spaceTotal: 0,
        spaceFree: 0,
        status: 'error',
        error: err.message,
      });
    }
  }
  return results;
}

async function getPoolSummary(userId) {
  const accounts = await listAccountsWithUsage(userId);
  const totals = accounts.reduce(
    (acc, a) => {
      acc.spaceUsed += a.spaceUsed;
      acc.spaceTotal += a.spaceTotal;
      return acc;
    },
    { spaceUsed: 0, spaceTotal: 0 }
  );
  return {
    accounts,
    spaceUsed: totals.spaceUsed,
    spaceTotal: totals.spaceTotal,
    spaceFree: Math.max(0, totals.spaceTotal - totals.spaceUsed),
  };
}

module.exports = {
  addAccount,
  getSession,
  reloginAccount,
  getQuota,
  listAccountsWithUsage,
  getPoolSummary,
};
