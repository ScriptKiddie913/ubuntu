const express = require('express');
const db = require('../db');
const megaAccounts = require('../megaAccounts');

const router = express.Router();

// Pool-wide summary: every account's usage plus combined totals.
router.get('/', async (req, res) => {
  try {
    const summary = await megaAccounts.getPoolSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { label, email, password, secondFactorCode } = req.body || {};
  try {
    const account = await megaAccounts.addAccount({ label, email, password, secondFactorCode });
    res.status(201).json(account);
  } catch (err) {
    // Surface the real MEGA login error (wrong password, 2FA required, etc.) to the UI.
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:label', async (req, res) => {
  const { label } = req.params;
  const inUse = db.read().files.some((f) => f.chunks.some((c) => c.label === label));
  if (inUse && req.query.force !== 'true') {
    return res.status(409).json({
      error:
        'This account still holds pieces of one or more files. Delete those files first, or resend with ?force=true to remove the account anyway (those files will become unrecoverable).',
    });
  }
  try {
    await megaAccounts.removeAccount(label);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
