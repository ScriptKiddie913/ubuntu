const express = require('express');
const db = require('../db');
const megaAccounts = require('../megaAccounts');
const { encrypt } = require('../crypto');
const { supabaseAdmin } = require('../supabaseClient');
const { runCloudHeartbeat, getHeartbeatStatus } = require('../cloudHeartbeat');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id) {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_REGEX.test(email.trim());
}

// ---------------- Admin Status Verification ----------------

router.get('/status', (req, res) => {
  res.json({
    isAdmin: true,
    email: req.userEmail,
    verifiedAt: req.adminAudit?.timestamp || new Date().toISOString(),
  });
});

// ---------------- List All Tenants ----------------

router.get('/users', async (req, res) => {
  try {
    const users = await db.adminListUsers();
    res.json({ users });
  } catch (err) {
    console.error('[admin] Error listing users:', err.message);
    res.status(500).json({ error: 'Failed to retrieve tenant directory.' });
  }
});

// ---------------- Full Account & Cloud Storage Deletion ----------------

router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;

  // 1. UUID Validation
  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format: UUID required.' });
  }

  // 2. Anti-Self-Deletion Check
  if (userId.trim() === req.userId.trim()) {
    console.warn(`[SECURITY ALERT] Admin attempted self-deletion! IP: ${req.adminAudit?.ip}`);
    return res.status(400).json({
      error: 'Security violation: Master Super-Admin account cannot delete itself.',
    });
  }

  try {
    // 3. Verify target user exists and is not another admin instance
    const { data: targetData, error: targetErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (targetErr || !targetData || !targetData.user) {
      return res.status(404).json({ error: 'Target tenant user does not exist in authentication store.' });
    }

    const targetEmail = (targetData.user.email || '').trim().toLowerCase();
    const adminEmail = (req.userEmail || '').trim().toLowerCase();
    if (targetEmail === adminEmail) {
      return res.status(400).json({
        error: 'Security violation: Master Super-Admin account is protected from deletion.',
      });
    }

    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" (IP: ${req.adminAudit?.ip}) initiated full deletion of tenant "${targetEmail}" (ID: ${userId})`);

    // 4. Physical cloud chunk cleanup across storage accounts
    const cloudCleanup = await megaAccounts.adminWipeUserCloudFiles(userId);

    // 5. Cascade delete database records
    await supabaseAdmin.from('pool_files').delete().eq('user_id', userId);
    await supabaseAdmin.from('mega_accounts').delete().eq('user_id', userId);
    await supabaseAdmin.from('public_node_allocations').delete().eq('user_id', userId);

    // 6. Delete tenant user from Supabase Auth
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      console.warn(`[admin] Supabase auth deletion warning for ${userId}:`, authErr.message);
    }

    console.log(`[AUDIT-LOG] Tenant "${targetEmail}" (ID: ${userId}) completely wiped: ${cloudCleanup.piecesDeleted} pieces across ${cloudCleanup.filesCount} files purged.`);

    res.json({
      ok: true,
      message: `Tenant ${targetEmail} and all associated cloud data (${cloudCleanup.piecesDeleted} sharded pieces across ${cloudCleanup.filesCount} files) were permanently deleted.`,
    });
  } catch (err) {
    console.error(`[admin] Critical error during full wipe of ${userId}:`, err);
    res.status(500).json({ error: `Deletion failed: ${err.message}` });
  }
});

// ---------------- Public Storage Nodes ----------------

router.get('/public-nodes', async (req, res) => {
  try {
    const rawNodes = await db.listPublicNodes();
    // Security: Never leak encrypted passwords or internal cipher fields in responses
    const nodes = rawNodes.map((n) => ({
      id: n.id,
      label: n.label,
      email: n.email,
      notes: n.notes || '',
      addedAt: n.addedAt,
      allocatedUserIds: n.allocatedUserIds || [],
      isPublic: true,
    }));
    res.json({ nodes });
  } catch (err) {
    console.error('[admin] Error listing public nodes:', err.message);
    res.status(500).json({ error: 'Failed to load public storage pool.' });
  }
});

router.post('/public-nodes', async (req, res) => {
  const { label, email, password, notes } = req.body || {};

  // Input Validation
  if (!label || typeof label !== 'string' || label.trim().length < 2 || label.trim().length > 64) {
    return res.status(400).json({ error: 'Label must be between 2 and 64 characters.' });
  }
  if (!/^[a-zA-Z0-9_\-\. ]+$/.test(label.trim())) {
    return res.status(400).json({ error: 'Label contains invalid characters. Use letters, numbers, spaces, dots, dashes, and underscores.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid cloud account email address is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6 || password.length > 256) {
    return res.status(400).json({ error: 'Password must be between 6 and 256 characters.' });
  }
  if (notes && typeof notes === 'string' && notes.length > 500) {
    return res.status(400).json({ error: 'Notes cannot exceed 500 characters.' });
  }

  try {
    const node = await db.insertPublicNode({
      label: label.trim(),
      email: email.trim().toLowerCase(),
      passwordEncrypted: encrypt(password),
      notes: (notes || '').trim(),
    });

    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" mounted public storage node "${label.trim()}" (${email.trim().toLowerCase()})`);

    // Sanitize response
    res.status(201).json({
      id: node.id,
      label: node.label,
      email: node.email,
      notes: node.notes,
      addedAt: node.added_at,
      isPublic: true,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/public-nodes/:nodeId', async (req, res) => {
  const { nodeId } = req.params;
  if (!isValidUUID(nodeId)) {
    return res.status(400).json({ error: 'Invalid node ID: UUID required.' });
  }

  try {
    await db.deletePublicNode(nodeId);
    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" deleted public storage node "${nodeId}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Public Node Allocations ----------------

router.post('/public-nodes/:nodeId/allocate', async (req, res) => {
  const { nodeId } = req.params;
  const { userId } = req.body || {};

  if (!isValidUUID(nodeId)) {
    return res.status(400).json({ error: 'Invalid node ID: UUID required.' });
  }
  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID: UUID required.' });
  }

  try {
    // Verify user exists
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userData || !userData.user) {
      return res.status(404).json({ error: 'Target tenant user does not exist.' });
    }

    const allocation = await db.allocatePublicNode(nodeId, userId);
    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" allocated public node "${nodeId}" to tenant "${userData.user.email}" (${userId})`);
    res.status(201).json(allocation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/public-nodes/:nodeId/allocate/:userId', async (req, res) => {
  const { nodeId, userId } = req.params;

  if (!isValidUUID(nodeId) || !isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid identifier format: UUID required.' });
  }

  try {
    await db.revokePublicNodeAllocation(nodeId, userId);
    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" revoked allocation of public node "${nodeId}" from tenant "${userId}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Cloud Heartbeat Telemetry & Trigger ----------------

router.get('/heartbeat/status', (req, res) => {
  res.json(getHeartbeatStatus());
});

router.post('/heartbeat/run', async (req, res) => {
  const currentStatus = getHeartbeatStatus();
  if (currentStatus.isRunning) {
    return res.status(409).json({ error: 'A cloud heartbeat sweep is already in progress.' });
  }

  try {
    console.log(`[AUDIT-LOG] Super-Admin "${req.userEmail}" manually triggered cloud heartbeat sweep`);
    const result = await runCloudHeartbeat();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
