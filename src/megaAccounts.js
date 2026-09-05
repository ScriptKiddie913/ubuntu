const { Storage } = require('megajs');
const { encrypt, decrypt } = require('./crypto');
const db = require('./db');

const sessions = new Map();
const QUOTA_TTL_MS = 30 * 1000;

function sessionKey(userId, label) {
  return `${userId}:${label}`;
}

async function login(email, password, secondFactorCode) {
  const options = {
    email,
    password,
    userAgent: 'SoTaNik_AI-DataLake/2.0',
  };
  if (secondFactorCode) options.secondFactorCode = secondFactorCode;
  const storage = await new Storage(options).ready;
  return storage;
}

async function addAccount(userId, { label, email, password, secondFactorCode }) {
  if (!label || !email || !password) {
    throw new Error('Label, email and password are all required.');
  }

  const storage = await login(email, password, secondFactorCode);
  sessions.set(sessionKey(userId, label), { storage, quota: null, quotaAt: 0 });

  await db.insertAccount(userId, { label, email, passwordEncrypted: encrypt(password) });
  return { label, email };
}

async function getSession(userId, label) {
  const key = sessionKey(userId, label);
  const cached = sessions.get(key);
  if (cached) return cached.storage;

  // Check personal accounts first
  let account = await db.findAccount(userId, label);

  // If not found, check if it's an allocated public node
  if (!account) {
    account = await db.findPublicNodeByLabel(label);
  }

  if (!account) throw new Error(`Unknown storage node identifier "${label}".`);

  const storage = await login(account.email, decrypt(account.passwordEncrypted));
  sessions.set(key, { storage, quota: null, quotaAt: 0 });
  return storage;
}

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
    const fresh = await reloginAccount(userId, label);
    info = await fresh.getAccountInfo();
  }
  const quota = { spaceUsed: info.spaceUsed, spaceTotal: info.spaceTotal };
  const entry = sessions.get(key);
  if (entry) {
    entry.quota = quota;
    entry.quotaAt = now;
  }
  return quota;
}

async function listAccountsWithUsage(userId) {
  const personalAccounts = await db.listAccounts(userId);
  const allocatedPublic = await db.getUserAllocatedPublicNodes(userId);

  const combined = [
    ...personalAccounts.map((a) => ({ ...a, isPublic: false })),
    ...allocatedPublic.map((a) => ({ ...a, isPublic: true })),
  ];

  const results = [];
  for (const acc of combined) {
    try {
      const quota = await getQuota(userId, acc.label);
      results.push({
        label: acc.label,
        email: acc.email,
        spaceUsed: quota.spaceUsed,
        spaceTotal: quota.spaceTotal,
        spaceFree: Math.max(0, quota.spaceTotal - quota.spaceUsed),
        status: 'ok',
        isPublic: acc.isPublic,
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
        isPublic: acc.isPublic,
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

// ---------------- Admin Full Cloud Deletion ----------------
// Completely purges all physical chunks across personal and public cloud nodes
// for a specified user, so no orphaned data pieces remain in the clouds.
async function adminWipeUserCloudFiles(userId) {
  const files = await db.listFiles(userId);
  let deletedPieces = 0;

  for (const file of files) {
    for (const chunk of file.chunks || []) {
      try {
        const storage = await getSession(userId, chunk.label);
        const nodeFile = storage.files ? storage.files[chunk.nodeId] : null;
        if (nodeFile) {
          await nodeFile.delete(true);
          deletedPieces++;
        }
      } catch (err) {
        console.warn(`[admin wipe] Failed to delete chunk ${chunk.nodeId} on node ${chunk.label}:`, err.message);
      }
    }
  }

  // Clear memory sessions for this user
  for (const [key] of sessions.entries()) {
    if (key.startsWith(`${userId}:`)) {
      sessions.delete(key);
    }
  }

  return { filesCount: files.length, piecesDeleted: deletedPieces };
}

module.exports = {
  addAccount,
  getSession,
  reloginAccount,
  getQuota,
  listAccountsWithUsage,
  getPoolSummary,
  adminWipeUserCloudFiles,
};
