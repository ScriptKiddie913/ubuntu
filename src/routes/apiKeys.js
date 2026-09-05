const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../supabaseClient');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------- List API Keys for Tenant ----------------
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, name, key_prefix, created_at, last_used_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01') return res.json({ keys: [] }); // Table pending migration
      throw new Error(error.message);
    }

    res.json({ keys: data || [] });
  } catch (err) {
    console.error('[api-keys] Error listing keys:', err.message);
    res.status(500).json({ error: 'Failed to retrieve API keys.' });
  }
});

// ---------------- Generate New API Key ----------------
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  const keyName = (name && typeof name === 'string' ? name.trim().slice(0, 60) : '') || 'External Scraper Key';

  try {
    // Generate cryptographically secure API key
    const rawSecret = 'sot_live_' + crypto.randomBytes(24).toString('hex');
    const keyPrefix = rawSecret.slice(0, 16) + '…';
    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        user_id: req.userId,
        name: keyName,
        key_prefix: keyPrefix,
        key_hash: keyHash,
      })
      .select('id, name, key_prefix, created_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    console.log(`[AUDIT-LOG] Tenant "${req.userEmail}" generated API key "${keyName}" (${data.id})`);

    // Return the plaintext rawSecret ONCE so the user can copy it
    res.status(201).json({
      key: {
        id: data.id,
        name: data.name,
        keyPrefix: data.key_prefix,
        createdAt: data.created_at,
        secret: rawSecret, // Plaintext shown only once!
      },
    });
  } catch (err) {
    console.error('[api-keys] Error generating key:', err.message);
    res.status(500).json({ error: `Could not generate API key: ${err.message}` });
  }
});

// ---------------- Revoke / Delete API Key ----------------
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid API key ID format.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw new Error(error.message);

    console.log(`[AUDIT-LOG] Tenant "${req.userEmail}" revoked API key "${id}"`);
    res.json({ ok: true, message: 'API key revoked immediately.' });
  } catch (err) {
    console.error('[api-keys] Error revoking key:', err.message);
    res.status(500).json({ error: `Could not revoke key: ${err.message}` });
  }
});

module.exports = router;
