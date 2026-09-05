const express = require('express');
const db = require('../db');
const megaAccounts = require('../megaAccounts');
const { encrypt } = require('../crypto');
const { supabaseAdmin } = require('../supabaseClient');
const { runCloudHeartbeat, getHeartbeatStatus } = require('../cloudHeartbeat');

const router = express.Router();

// Verify admin status
router.get('/status', (req, res) => {
  res.json({ isAdmin: true, email: req.userEmail });
});

// List all tenants with files and node telemetry
router.get('/users', async (req, res) => {
  try {
    const users = await db.adminListUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full Account & Cloud Storage Deletion
router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    console.log(`[admin] Commencing full user and cloud wipe for user: ${userId}`);

    // 1. Wipe all physical file chunks across cloud storage nodes
    const cloudCleanup = await megaAccounts.adminWipeUserCloudFiles(userId);

    // 2. Delete database records in pool_files
    await supabaseAdmin.from('pool_files').delete().eq('user_id', userId);

    // 3. Delete database records in mega_accounts
    await supabaseAdmin.from('mega_accounts').delete().eq('user_id', userId);

    // 4. Delete any public node allocations
    await supabaseAdmin.from('public_node_allocations').delete().eq('user_id', userId);

    // 5. Delete the tenant user in Supabase Auth
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      console.warn(`[admin] Supabase auth deletion notice for ${userId}:`, authErr.message);
    }

    res.json({
      ok: true,
      message: `User ${userId} and all sharded cloud data (${cloudCleanup.piecesDeleted} pieces across ${cloudCleanup.filesCount} files) were permanently deleted.`,
    });
  } catch (err) {
    console.error(`[admin] Error during full wipe of ${userId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Public Storage Nodes ----------------

router.get('/public-nodes', async (req, res) => {
  try {
    const nodes = await db.listPublicNodes();
    res.json({ nodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public-nodes', async (req, res) => {
  const { label, email, password, notes } = req.body || {};
  if (!label || !email || !password) {
    return res.status(400).json({ error: 'Label, email and password are all required.' });
  }

  try {
    // Save to public storage nodes
    const node = await db.insertPublicNode({
      label: label.trim(),
      email: email.trim(),
      passwordEncrypted: encrypt(password),
      notes: (notes || '').trim(),
    });

    res.status(201).json(node);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/public-nodes/:nodeId', async (req, res) => {
  try {
    await db.deletePublicNode(req.params.nodeId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Allocate public node to a user
router.post('/public-nodes/:nodeId/allocate', async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required for allocation.' });
  }
  try {
    const allocation = await db.allocatePublicNode(req.params.nodeId, userId);
    res.status(201).json(allocation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Revoke allocation
router.delete('/public-nodes/:nodeId/allocate/:userId', async (req, res) => {
  try {
    await db.revokePublicNodeAllocation(req.params.nodeId, req.params.userId);
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
  try {
    const result = await runCloudHeartbeat();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
