const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const megaDb = require('../megaDb');
const importJobs = require('../importJobs');

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message || 'Upload was interrupted while receiving the file.' });
  });
}

// ---------------- Tables ----------------

router.get('/tables', async (req, res) => {
  try {
    res.json({ tables: await megaDb.listTables(req.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tables', async (req, res) => {
  try {
    res.status(201).json(await megaDb.createTable(req.userId, (req.body || {}).name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tables/:name', async (req, res) => {
  try {
    await megaDb.deleteTable(req.userId, req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tables/:name/rows', async (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "rows" array.' });
  }
  try {
    res.status(201).json(await megaDb.insertRows(req.userId, req.params.name, rows));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tables/:name/search', async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  try {
    res.json(await megaDb.search(req.userId, req.params.name, req.query.q, { limit }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- Large text-file import (background job) ----------------

router.post('/tables/:name/import', uploadMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (form field name must be "file").' });
  try {
    const jobId = importJobs.startImportJob(req.userId, req.params.name, req.file.path);
    res.status(202).json({ jobId, status: 'running' });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

router.get('/import-jobs/:jobId', (req, res) => {
  const job = importJobs.getImportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Unknown or expired job id.' });
  res.json(job);
});

// ---------------- Raw chunk access (for an external scanning/indexing server) ----------------
// See API.md for full documentation of these endpoints, auth, and chunk sizing.

router.get('/tables/:name/segments', async (req, res) => {
  try {
    res.json({
      segmentMaxBytes: megaDb.SEGMENT_MAX_BYTES,
      segments: await megaDb.listSegments(req.userId, req.params.name),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tables/:name/segments/:index/data', async (req, res) => {
  const segmentIndex = Number(req.params.index);
  try {
    const { buffer, rowCount } = await megaDb.getSegmentData(req.userId, req.params.name, segmentIndex);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Row-Count', String(rowCount));
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.segment-${segmentIndex}.jsonl"`);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/tables/:name/segments/:index/index', async (req, res) => {
  const segmentIndex = Number(req.params.index);
  try {
    const buffer = await megaDb.getSegmentIndex(req.userId, req.params.name, segmentIndex);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.segment-${segmentIndex}.index.json"`);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
