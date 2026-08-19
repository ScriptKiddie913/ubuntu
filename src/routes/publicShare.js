const express = require('express');
const db = require('../db');
const { sendFileDownload, isShareActive } = require('../fileStreamer');

const router = express.Router();

router.get('/:token', async (req, res) => {
  const { files } = db.read();
  const record = files.find((f) => f.share && f.share.token === req.params.token);

  if (!record || !isShareActive(record.share)) {
    return res
      .status(404)
      .type('html')
      .send(
        '<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;">' +
          '<h2>Link not found or expired</h2>' +
          '<p>Ask whoever sent this link to generate a new one.</p></body></html>'
      );
  }

  try {
    await sendFileDownload(record, res);
  } catch (err) {
    console.error('[share download] failed:', err);
    if (!res.headersSent) res.status(500).send('Download failed: ' + err.message);
    else res.destroy(err);
  }
});

module.exports = router;
