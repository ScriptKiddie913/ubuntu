const express = require('express');
const db = require('../db');
const { sendFileDownload, isShareActive } = require('../fileStreamer');

const router = express.Router();

router.get('/:token', async (req, res) => {
  let record;
  try {
    record = await db.findFileByShareToken(req.params.token);
  } catch (err) {
    console.error('[share lookup] failed:', err);
    return res.status(500).send('Something went wrong looking up that link.');
  }

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
