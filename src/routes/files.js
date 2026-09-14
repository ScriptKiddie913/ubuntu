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
const CHUNK_MAX_BYTES = Number(process.env.CHUNK_MAX_BYTES) || 100 * 1024 * 1024; // 100MB chunk default for distributed sharding & memory safety

const EXPIRY_OPTIONS_HOURS = { '1h': 1, '1d': 24, '7d': 24 * 7, '30d': 24 * 30 }; // 'never' = no expiry

// Ephemeral in-memory registry for chunked upload sessions
const activeUploadSessions = new Map();

// Periodic cleanup of stale upload sessions older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeUploadSessions.entries()) {
    if (now - session.createdAt > 2 * 60 * 60 * 1000) {
      activeUploadSessions.delete(id);
    }
  }
}, 30 * 60 * 1000).unref?.();

// No fileSize limit set here on purpose — the pool's real ceiling is whatever the
// connected MEGA accounts can hold, enforced later by planPlacement(), not an
// arbitrary multer cutoff. `dest` streams straight to disk (not buffered in
// memory), so large files don't blow up server RAM while they're received.
const upload = multer({ dest: os.tmpdir() });

// Wraps multer so a failure while RECEIVING the upload (client gave up partway,
// disk ran out of space, etc.) comes back as a clear JSON error instead of a bare
// connection drop the frontend can't explain to the user.
function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    console.error('[upload] failed while receiving the file:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large for this server\'s configured limit.' });
    }
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({
      error:
        'Upload was interrupted while the file was being received (connection dropped or timed out). ' +
        'This is common with slow connections and large files — try again, ideally on a faster/more stable network.',
    });
  });
}

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

// ============================================================================
// High-Reliability Chunked Ingestion Pipeline (Handles 1GB+ files on Free Render)
// ============================================================================

// 1. Initialize Chunked Upload Session
router.post('/init', async (req, res) => {
  const { name, size } = req.body || {};
  if (!name || typeof size !== 'number' || size < 0) {
    return res.status(400).json({ error: 'Invalid file metadata (name and size are required).' });
  }

  try {
    const summary = await megaAccounts.getPoolSummary(req.userId);
    const plan = planPlacement(size, summary.accounts, CHUNK_MAX_BYTES);
    const uploadId = nanoid(24);

    activeUploadSessions.set(uploadId, {
      uploadId,
      userId: req.userId,
      name,
      size,
      plan,
      uploadedChunks: [],
      createdAt: Date.now(),
    });

    res.json({
      uploadId,
      plan,
      totalChunks: plan.length,
    });
  } catch (err) {
    console.error('[upload/init] placement planning failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// 2. Ingest Single Chunk Shard
router.post('/chunk', uploadMiddleware, async (req, res) => {
  const { uploadId, partIndex } = req.body || {};
  const partIdx = parseInt(partIndex, 10);

  if (!uploadId || isNaN(partIdx) || !req.file) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Missing uploadId, partIndex, or chunk file.' });
  }

  const session = activeUploadSessions.get(uploadId);
  if (!session || session.userId !== req.userId) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Upload session expired or not found.' });
  }

  const part = session.plan[partIdx - 1];
  if (!part) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `Invalid part index ${partIdx}.` });
  }

  const tmpPath = req.file.path;
  const chunkName = session.plan.length === 1 ? session.name : `${session.name}.part${partIdx}`;

  try {
    const storage = await megaAccounts.getSession(session.userId, part.label);
    let megaFile;

    if (part.size === 0) {
      megaFile = await storage.upload(chunkName, Buffer.alloc(0)).complete;
    } else {
      const uploadStream = storage.upload({ name: chunkName, size: part.size });
      const readStream = fs.createReadStream(tmpPath);
      readStream.pipe(uploadStream);
      megaFile = await uploadStream.complete;
    }

    session.uploadedChunks.push({
      label: part.label,
      nodeId: megaFile.nodeId,
      size: part.size,
      part: partIdx,
    });

    res.json({ ok: true, partIndex: partIdx, label: part.label });
  } catch (err) {
    console.error(`[upload/chunk] part ${partIdx} upload to "${part.label}" failed:`, err);
    res.status(500).json({ error: `Shard ${partIdx} commit failed on node "${part.label}": ${err.message}` });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

// 3. Finalize and Commit Ingestion Catalog
router.post('/finalize', async (req, res) => {
  const { uploadId } = req.body || {};
  const session = activeUploadSessions.get(uploadId);

  if (!session || session.userId !== req.userId) {
    return res.status(404).json({ error: 'Upload session not found or expired.' });
  }

  if (session.uploadedChunks.length !== session.plan.length) {
    return res.status(400).json({
      error: `Incomplete upload: received ${session.uploadedChunks.length} of ${session.plan.length} planned shards.`,
    });
  }

  try {
    // Sort chunks in ascending part order
    session.uploadedChunks.sort((a, b) => a.part - b.part);

    const record = await db.insertFile(session.userId, {
      id: nanoid(),
      name: session.name,
      size: session.size,
      createdAt: new Date().toISOString(),
      chunks: session.uploadedChunks,
    });

    activeUploadSessions.delete(uploadId);
    res.status(201).json(toPublicRecord(record, req));
  } catch (err) {
    console.error('[upload/finalize] DB commit failed:', err);
    res.status(500).json({ error: `Finalizing ingestion failed: ${err.message}` });
  }
});

// 4. Abort / Clean up failed session
router.post('/abort/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const session = activeUploadSessions.get(uploadId);
  if (!session || session.userId !== req.userId) {
    return res.json({ ok: true });
  }

  for (const chunk of session.uploadedChunks) {
    try {
      const storage = await megaAccounts.getSession(session.userId, chunk.label);
      const f = storage.files[chunk.nodeId];
      if (f) await f.delete(true);
    } catch (_) {}
  }

  activeUploadSessions.delete(uploadId);
  res.json({ ok: true, aborted: true });
});

// Single-Shot Upload Route (Preserved for curl/API clients)
router.post('/', uploadMiddleware, async (req, res) => {
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
