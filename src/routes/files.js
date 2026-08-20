const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { nanoid } = require('nanoid');
const db = require('../db');
const megaAccounts = require('../megaAccounts');
const { planPlacement } = require('../placement');
const { sendFileDownload, isShareActive } = require('../fileStreamer');

const router = express.Router();
const CHUNK_MAX_BYTES = Number(process.env.CHUNK_MAX_BYTES) || 4 * 1024 * 1024 * 1024; // 4GB default

const EXPIRY_OPTIONS_HOURS = { '1h': 1, '1d': 24, '7d': 24 * 7, '30d': 24 * 30 }; // 'never' = no expiry

const upload = multer({ dest: os.tmpdir() });

function shareUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/share/${token}`;
}

function toPublicRecord(f, req) {
  const share = isShareActive(f.share)
    ? { url: shareUrl(req, f.share.token), expiresAt: f.share.expiresAt || null }
    : null;
  return {
    id: f.id,
    name: f.name,
    size: f.size,
    createdAt: f.createdAt,
    chunkCount: f.chunks.length,
    accounts: [...new Set(f.chunks.map((c) => c.label))],
    share,
  };
}

router.get('/', async (req, res) => {
  try {
    const files = await db.listFiles(req.userId);
    res.json({ files: files.map((f) => toPublicRecord(f, req)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (form field name must be "file").' });
  }
  const tmpPath = req.file.path;
  const originalName = req.file.originalname;
  const fileSize = req.file.size;
  const uploadedChunks = []; // for rollback if something fails partway

  try {
    const summary = await megaAccounts.getPoolSummary(req.userId);
    const plan = planPlacement(fileSize, summary.accounts, CHUNK_MAX_BYTES);

    let offset = 0;
    let partIndex = 0;
    for (const part of plan) {
      const start = offset;
      const end = offset + part.size - 1;
      offset += part.size;
      partIndex += 1;

      const storage = await megaAccounts.getSession(req.userId, part.label);
      const chunkName = plan.length === 1 ? originalName : `${originalName}.part${partIndex}`;

      let megaFile;
      if (part.size === 0) {
        megaFile = await storage.upload(chunkName, Buffer.alloc(0)).complete;
      } else {
        const uploadStream = storage.upload({ name: chunkName, size: part.size });
        fs.createReadStream(tmpPath, { start, end }).pipe(uploadStream);
        megaFile = await uploadStream.complete;
      }

      uploadedChunks.push({
        label: part.label,
        nodeId: megaFile.nodeId,
        size: part.size,
        part: partIndex,
      });
    }

    const record = await db.insertFile(req.userId, {
      id: nanoid(),
      name: originalName,
      size: fileSize,
      createdAt: new Date().toISOString(),
      chunks: uploadedChunks,
    });

    res.status(201).json(toPublicRecord(record, req));
  } catch (err) {
    console.error('[upload] failed:', err);
    // Best-effort cleanup of whatever chunks did make it to MEGA before the failure.
    for (const chunk of uploadedChunks) {
      try {
        const storage = await megaAccounts.getSession(req.userId, chunk.label);
        const f = storage.files[chunk.nodeId];
        if (f) await f.delete(true);
      } catch (_) {
        /* ignore cleanup errors */
      }
    }
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const record = await db.findFile(req.userId, req.params.id);
    if (!record) return res.status(404).json({ error: 'File not found.' });
    await sendFileDownload(record, res);
  } catch (err) {
    console.error('[download] failed:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  }
});

router.delete('/:id', async (req, res) => {
  const record = await db.findFile(req.userId, req.params.id);
  if (!record) return res.status(404).json({ error: 'File not found.' });

  const warnings = [];
  for (const chunk of record.chunks) {
    try {
      const storage = await megaAccounts.getSession(req.userId, chunk.label);
      const megaFile = storage.files[chunk.nodeId];
      if (megaFile) await megaFile.delete(true);
    } catch (err) {
      warnings.push(`${chunk.label}: ${err.message}`);
    }
  }

  await db.deleteFile(req.userId, req.params.id);

  res.json({ ok: true, warnings: warnings.length ? warnings : undefined });
});

// Create (or replace) a public share link for a file.
// body: { expiry: '1h' | '1d' | '7d' | '30d' | 'never' } — defaults to 'never'.
router.post('/:id/share', async (req, res) => {
  const record = await db.findFile(req.userId, req.params.id);
  if (!record) return res.status(404).json({ error: 'File not found.' });

  const expiry = (req.body && req.body.expiry) || 'never';
  let expiresAt = null;
  if (expiry !== 'never') {
    const hours = EXPIRY_OPTIONS_HOURS[expiry];
    if (!hours) return res.status(400).json({ error: 'Invalid expiry option.' });
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  const token = nanoid(28);
  try {
    await db.setFileShare(req.userId, req.params.id, {
      token,
      createdAt: new Date().toISOString(),
      expiresAt,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  res.status(201).json({ url: shareUrl(req, token), expiresAt });
});

router.delete('/:id/share', async (req, res) => {
  const record = await db.findFile(req.userId, req.params.id);
  if (!record) return res.status(404).json({ error: 'File not found.' });

  await db.setFileShare(req.userId, req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
