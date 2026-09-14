const express = require('express');
const megaAccounts = require('../megaAccounts');

const router = express.Router();

// Accounts are permanent once added — no DELETE route by design, since a file's
// chunks may already live on any connected account at any time, and removing an
// account out from under placed chunks would silently break downloads.

router.get('/', async (req, res) => {
  try {
    const summary = await megaAccounts.getPoolSummary(req.userId);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { label, email, password, secondFactorCode } = req.body || {};
  try {
    const account = await megaAccounts.addAccount(req.userId, { label, email, password, secondFactorCode });
    res.status(201).json(account);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Force a fresh login attempt for a disconnected node — clears the stale cached
// session and re-authenticates from the stored (encrypted) credentials.
router.post('/:label/reconnect', async (req, res) => {
  try {
    const storage = await megaAccounts.reloginAccount(req.userId, req.params.label);
    const info = await storage.getAccountInfo();
    res.json({
      ok: true,
      label: req.params.label,
      spaceUsed: info.spaceUsed,
      spaceTotal: info.spaceTotal,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
