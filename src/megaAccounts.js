const { Storage } = require('megajs');
const { encrypt, decrypt } = require('./crypto');
const db = require('./db');

// label -> { storage, quota: {spaceUsed, spaceTotal}, quotaAt: timestamp }
const sessions = new Map();
const QUOTA_TTL_MS = 30 * 1000;

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

async function addAccount({ label, email, password, secondFactorCode }) {
  if (!label || !email || !password) {
    throw new Error('label, email and password are all required.');
  }
  const existing = db.read().accounts.find((a) => a.label === label);
  if (existing) throw new Error(`An account labeled "${label}" already exists.`);

  const storage = await login(email, password, secondFactorCode); // throws on bad credentials/2FA
  sessions.set(label, { storage, quota: null, quotaAt: 0 });

  await db.mutate((data) => {
    data.accounts.push({
      label,
      email,
      password: encrypt(password),
      addedAt: new Date().toISOString(),
    });
  });

  return { label, email };
}

// Note: there is deliberately no removeAccount function. Once an account joins the pool it
// stays part of it permanently — see the comment in src/routes/accounts.js for why.

async function getSession(label) {
  const cached = sessions.get(label);
  if (cached) return cached.storage;

  const account = db.read().accounts.find((a) => a.label === label);
  if (!account) throw new Error(`Unknown MEGA account label "${label}".`);

  const storage = await login(account.email, decrypt(account.password));
  sessions.set(label, { storage, quota: null, quotaAt: 0 });
  return storage;
}

// Re-logs in a single account (used after auth/session errors) and returns the fresh storage.
async function reloginAccount(label) {
  sessions.delete(label);
  return getSession(label);
}

async function getQuota(label) {
  const now = Date.now();
  const cached = sessions.get(label);
  if (cached && cached.quota && now - cached.quotaAt < QUOTA_TTL_MS) {
    return cached.quota;
  }

  const storage = await getSession(label);
  let info;
  try {
    info = await storage.getAccountInfo();
  } catch (err) {
    // Session may have gone stale — try exactly once more after a fresh login.
    const fresh = await reloginAccount(label);
    info = await fresh.getAccountInfo();
  }
  const quota = { spaceUsed: info.spaceUsed, spaceTotal: info.spaceTotal };
  const entry = sessions.get(label);
  entry.quota = quota;
  entry.quotaAt = now;
  return quota;
}

async function listAccountsWithUsage() {
  const accounts = db.read().accounts;
  const results = [];
  for (const acc of accounts) {
    try {
      const quota = await getQuota(acc.label);
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

async function getPoolSummary() {
  const accounts = await listAccountsWithUsage();
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
