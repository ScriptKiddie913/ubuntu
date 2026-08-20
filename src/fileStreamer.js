const megaAccounts = require('./megaAccounts');

function isShareActive(share) {
  if (!share) return false;
  if (!share.expiresAt) return true;
  return new Date(share.expiresAt).getTime() > Date.now();
}

// Streams a file record (possibly made of several chunks on different MEGA accounts)
// to an HTTP response, in order, reassembling it transparently.
async function sendFileDownload(record, res) {
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
    if (chunk.size === 0) continue;
    const storage = await megaAccounts.getSession(record.userId, chunk.label);
    const megaFile = storage.files[chunk.nodeId];
    if (!megaFile) {
      throw new Error(`Missing chunk on MEGA account "${chunk.label}" (node ${chunk.nodeId}).`);
    }
    await streamChunk(megaFile, res);
  }
  res.end();
}

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

module.exports = { sendFileDownload, isShareActive };
