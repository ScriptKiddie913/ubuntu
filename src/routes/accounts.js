const express = require('express');
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

// Intentionally no DELETE route: once an account is added to the pool it stays part of it
// permanently, since files may have chunks placed on it at any time. Removing an account
// mid-flight risks silently orphaning pieces of files. If an account genuinely needs to go
// (e.g. it was compromised), do it by editing data/db.json directly and manually re-uploading
// any files that had chunks there — this is a deliberate, not a one-click, action.

module.exports = router;
