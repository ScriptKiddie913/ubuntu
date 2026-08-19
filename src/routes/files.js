const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { nanoid } = require('nanoid');
const db = require('../db');
const megaAccounts = require('../megaAccounts');
const { planPlacement } = require('../placement');

const router = express.Router();
const CHUNK_MAX_BYTES = Number(process.env.CHUNK_MAX_BYTES) || 4 * 1024 * 1024 * 1024; // 4GB default

const upload = multer({ dest: os.tmpdir() });

router.get('/', (req, res) => {
  const { files } = db.read();
  const list = files
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      createdAt: f.createdAt,
      chunkCount: f.chunks.length,
      accounts: [...new Set(f.chunks.map((c) => c.label))],
    }));
  res.json({ files: list });
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
    const summary = await megaAccounts.getPoolSummary();
    const plan = planPlacement(fileSize, summary.accounts, CHUNK_MAX_BYTES);

    let offset = 0;
    let partIndex = 0;
    for (const part of plan) {
      const start = offset;
      const end = offset + part.size - 1;
      offset += part.size;
      partIndex += 1;

      const storage = await megaAccounts.getSession(part.label);
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

    const record = {
      id: nanoid(),
      name: originalName,
      size: fileSize,
      createdAt: new Date().toISOString(),
      chunks: uploadedChunks,
    };
    await db.mutate((data) => {
      data.files.push(record);
    });

    res.status(201).json({
      id: record.id,
      name: record.name,
      size: record.size,
      createdAt: record.createdAt,
      chunkCount: record.chunks.length,
      accounts: [...new Set(record.chunks.map((c) => c.label))],
    });
  } catch (err) {
    console.error('[upload] failed:', err);
    // Best-effort cleanup of whatever chunks did make it to MEGA before the failure.
    for (const chunk of uploadedChunks) {
      try {
        const storage = await megaAccounts.getSession(chunk.label);
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
  const { files } = db.read();
  const record = files.find((f) => f.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'File not found.' });

  try {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(record.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback(record.name)}"; filename*=UTF-8''${encodeURIComponent(
        record.name
      )}`
    );

    const orderedChunks = record.chunks.slice().sort((a, b) => a.part - b.part);
    for (const chunk of orderedChunks) {
      if (chunk.size === 0) continue; // nothing to stream for an empty chunk
      const storage = await megaAccounts.getSession(chunk.label);
      const megaFile = storage.files[chunk.nodeId];
      if (!megaFile) {
        throw new Error(`Missing chunk on MEGA account "${chunk.label}" (node ${chunk.nodeId}).`);
      }
      await streamChunk(megaFile, res);
    }
    res.end();
  } catch (err) {
    console.error('[download] failed:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  }
});

router.delete('/:id', async (req, res) => {
  const { files } = db.read();
  const record = files.find((f) => f.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'File not found.' });

  const warnings = [];
  for (const chunk of record.chunks) {
    try {
      const storage = await megaAccounts.getSession(chunk.label);
      const megaFile = storage.files[chunk.nodeId];
      if (megaFile) await megaFile.delete(true);
    } catch (err) {
      warnings.push(`${chunk.label}: ${err.message}`);
    }
  }

  await db.mutate((data) => {
    data.files = data.files.filter((f) => f.id !== req.params.id);
  });

  res.json({ ok: true, warnings: warnings.length ? warnings : undefined });
});

function streamChunk(megaFile, res) {
  return new Promise((resolve, reject) => {
    const stream = megaFile.download();
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res, { end: false });
  });
}

function asciiFallback(name) {
  return name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
}

module.exports = router;
