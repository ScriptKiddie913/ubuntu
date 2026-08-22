const fs = require('fs');
const readline = require('readline');
const megaAccounts = require('./megaAccounts');
const db = require('./db');

// ============================================================================
// A tiny "database" whose data — catalog, table rows, and search index — lives
// entirely as objects on MEGA, not in Supabase/Postgres or on the server's own
// disk. Supabase is used elsewhere only for auth and for MEGA account
// credentials/connection metadata; none of that is "your data" in the sense
// meant here.
//
// Honest design notes (read before assuming this behaves like Postgres):
//
// - There is no query planner or index in the relational sense — this is a
//   simple inverted keyword index (word -> which rows contain it), built and
//   stored on MEGA alongside the data. A search downloads only the (much
//   smaller) index files, then downloads just the specific data segment(s)
//   that actually contain a hit — never the whole table, and never the whole
//   pool. But megajs (the MEGA client library this app uses) does not support
//   true HTTP byte-range downloads, so a "hit" costs downloading that hit's
//   whole segment (capped at DB_SEGMENT_MAX_BYTES, default 64MB) — not a
//   precise byte-exact fetch. Multiple hits in the same segment only pay that
//   cost once per search.
// - The catalog (table list + segment locations) is one small JSON file on
//   MEGA, rewritten (delete + re-upload) on every schema/segment change. This
//   is NOT concurrency-safe — two writes racing each other can clobber one
//   another. Fine for one person using their own pool; not a substitute for a
//   real transactional database if you need concurrent writers.
// - Search matches whole lowercase word tokens (plus a prefix-match bonus),
//   not phrases, fuzzy matching, or ranking. It answers "which rows contain
//   this keyword," which is what was actually asked for.
// ============================================================================

const CATALOG_FILENAME = '.megapool_catalog.json';
// 200MB per segment: fewer MEGA files/uploads for a given dataset size, at the
// cost of a bigger worst-case download per search hit (see notes above — a hit
// costs "download that hit's whole segment," not a byte-exact fetch, since
// megajs has no true range-download support). Smaller segments trade the other
// way: more files/upload overhead, cheaper per-hit search cost. Override with
// DB_SEGMENT_MAX_BYTES if you want a different balance.
const SEGMENT_MAX_BYTES = Number(process.env.DB_SEGMENT_MAX_BYTES) || 200 * 1024 * 1024;
const TOKEN_RE = /[a-z0-9]+/g;

function tokenize(text) {
  if (!text) return [];
  const matches = String(text).toLowerCase().match(TOKEN_RE);
  return matches ? [...new Set(matches)] : [];
}

function validTableName(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name);
}

async function uploadBuffer(storage, name, buffer) {
  const uploadStream = storage.upload({ name, size: buffer.length });
  uploadStream.end(buffer);
  return uploadStream.complete;
}

async function pickAccountWithMostFreeSpace(userId) {
  const summary = await megaAccounts.getPoolSummary(userId);
  const target = summary.accounts.filter((a) => a.status === 'ok').sort((a, b) => b.spaceFree - a.spaceFree)[0];
  if (!target) throw new Error('No usable MEGA account with free space. Add or reconnect an account first.');
  return target.label;
}

// ---------------- Catalog (lives on MEGA, not Supabase) ----------------

async function findCatalogLocation(userId) {
  const accounts = await db.listAccounts(userId);
  for (const acc of accounts) {
    let storage;
    try {
      storage = await megaAccounts.getSession(userId, acc.label);
    } catch (err) {
      continue; // skip accounts that can't currently log in; don't fail the whole lookup
    }
    const node = Object.values(storage.files || {}).find((f) => f.name === CATALOG_FILENAME);
    if (node) return { label: acc.label, storage, node };
  }
  return null;
}

async function loadCatalog(userId) {
  const found = await findCatalogLocation(userId);
  if (!found) return { tables: {} };
  const buf = await found.node.downloadBuffer();
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    return { tables: parsed.tables || {} };
  } catch (err) {
    throw new Error('The database catalog file on MEGA is corrupted or unreadable.');
  }
}

async function saveCatalog(userId, catalog) {
  const existing = await findCatalogLocation(userId);
  let storage;
  if (existing) {
    storage = existing.storage;
    try {
      await existing.node.delete(true);
    } catch (err) {
      /* proceed — worst case this leaves one orphaned old catalog file */
    }
  } else {
    const label = await pickAccountWithMostFreeSpace(userId);
    storage = await megaAccounts.getSession(userId, label);
  }
  const buf = Buffer.from(JSON.stringify(catalog), 'utf8');
  await uploadBuffer(storage, CATALOG_FILENAME, buf);
}

// ---------------- Segment writer (rows + inverted index, batched) ----------------

class SegmentBuilder {
  constructor() {
    this.lines = [];
    this.index = {}; // token -> [[offset, length], ...]
    this.byteLength = 0;
    this.rowCount = 0;
  }

  addRow(row, searchableText) {
    const lineBuf = Buffer.from(JSON.stringify(row) + '\n', 'utf8');
    const offset = this.byteLength;
    this.lines.push(lineBuf);
    this.byteLength += lineBuf.length;
    this.rowCount += 1;
    for (const token of tokenize(searchableText)) {
      if (!this.index[token]) this.index[token] = [];
      this.index[token].push([offset, lineBuf.length]);
    }
  }

  toDataBuffer() {
    return Buffer.concat(this.lines);
  }
}

async function flushSegment(userId, tableName, builder) {
  if (builder.rowCount === 0) return null;
  const label = await pickAccountWithMostFreeSpace(userId);
  const storage = await megaAccounts.getSession(userId, label);

  const stamp = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const dataBuf = builder.toDataBuffer();
  const dataFile = await uploadBuffer(storage, `${tableName}.seg.${stamp}.jsonl`, dataBuf);
  const indexBuf = Buffer.from(JSON.stringify(builder.index), 'utf8');
  const indexFile = await uploadBuffer(storage, `${tableName}.idx.${stamp}.json`, indexBuf);

  return {
    label,
    dataNodeId: dataFile.nodeId,
    indexNodeId: indexFile.nodeId,
    size: dataBuf.length,
    rowCount: builder.rowCount,
    createdAt: new Date().toISOString(),
  };
}

async function commitSegments(userId, tableName, newSegments, addedRowCount) {
  const catalog = await loadCatalog(userId);
  if (!catalog.tables[tableName]) {
    catalog.tables[tableName] = { segments: [], rowCount: 0, createdAt: new Date().toISOString() };
  }
  const table = catalog.tables[tableName];
  table.segments.push(...newSegments);
  table.rowCount += addedRowCount;
  await saveCatalog(userId, catalog);
  return table;
}

// ---------------- Public API ----------------

async function listTables(userId) {
  const catalog = await loadCatalog(userId);
  return Object.entries(catalog.tables).map(([name, t]) => ({
    name,
    rowCount: t.rowCount,
    segmentCount: t.segments.length,
    totalBytes: t.segments.reduce((sum, seg) => sum + seg.size, 0),
    createdAt: t.createdAt,
  }));
}

// Segment metadata for an external consumer — everything needed to know WHAT
// to fetch and IN WHAT SIZE, without exposing raw MEGA node ids (the actual
// download endpoint looks those up server-side from the index + userId, so a
// caller only ever needs the table name and segment index).
async function listSegments(userId, tableName) {
  const catalog = await loadCatalog(userId);
  const table = catalog.tables[tableName];
  if (!table) throw new Error(`Unknown table "${tableName}".`);
  return table.segments.map((seg, index) => ({
    index,
    rowCount: seg.rowCount,
    dataBytes: seg.size,
    createdAt: seg.createdAt,
  }));
}

// Raw bytes of one data segment's JSONL content (one JSON object per line).
async function getSegmentData(userId, tableName, segmentIndex) {
  const catalog = await loadCatalog(userId);
  const table = catalog.tables[tableName];
  if (!table) throw new Error(`Unknown table "${tableName}".`);
  const seg = table.segments[segmentIndex];
  if (!seg) throw new Error(`Segment ${segmentIndex} does not exist on table "${tableName}".`);
  const storage = await megaAccounts.getSession(userId, seg.label);
  const dataFile = storage.files[seg.dataNodeId];
  if (!dataFile) throw new Error(`Segment ${segmentIndex}'s data object is missing on MEGA (account "${seg.label}").`);
  return { buffer: await dataFile.downloadBuffer(), rowCount: seg.rowCount, size: seg.size };
}

// Raw bytes of one segment's inverted-index JSON (token -> [[offset,length],...]),
// in case an external scanner wants to reuse it rather than rebuild its own.
async function getSegmentIndex(userId, tableName, segmentIndex) {
  const catalog = await loadCatalog(userId);
  const table = catalog.tables[tableName];
  if (!table) throw new Error(`Unknown table "${tableName}".`);
  const seg = table.segments[segmentIndex];
  if (!seg) throw new Error(`Segment ${segmentIndex} does not exist on table "${tableName}".`);
  const storage = await megaAccounts.getSession(userId, seg.label);
  const indexFile = storage.files[seg.indexNodeId];
  if (!indexFile) throw new Error(`Segment ${segmentIndex}'s index object is missing on MEGA (account "${seg.label}").`);
  return await indexFile.downloadBuffer();
}

async function createTable(userId, name) {
  if (!validTableName(name)) {
    throw new Error('Table name must start with a letter and contain only letters, numbers, or underscores (max 64 chars).');
  }
  const catalog = await loadCatalog(userId);
  if (catalog.tables[name]) throw new Error(`Table "${name}" already exists.`);
  catalog.tables[name] = { segments: [], rowCount: 0, createdAt: new Date().toISOString() };
  await saveCatalog(userId, catalog);
  return { name, rowCount: 0, segmentCount: 0 };
}

async function deleteTable(userId, name) {
  const catalog = await loadCatalog(userId);
  const table = catalog.tables[name];
  if (!table) throw new Error(`Unknown table "${name}".`);

  for (const seg of table.segments) {
    try {
      const storage = await megaAccounts.getSession(userId, seg.label);
      const dataFile = storage.files[seg.dataNodeId];
      if (dataFile) await dataFile.delete(true);
      const indexFile = storage.files[seg.indexNodeId];
      if (indexFile) await indexFile.delete(true);
    } catch (err) {
      /* best-effort cleanup — proceed even if a piece can't be reached right now */
    }
  }

  delete catalog.tables[name];
  await saveCatalog(userId, catalog);
}

// Small, synchronous-ish inserts (a handful of rows pasted/typed in the UI).
// rows: array of plain objects. Searchable text = every string value in each row.
async function insertRows(userId, tableName, rows) {
  if (!validTableName(tableName)) throw new Error('Invalid table name.');
  let builder = new SegmentBuilder();
  const segments = [];
  for (const row of rows) {
    const searchable = Object.values(row)
      .filter((v) => typeof v === 'string')
      .join(' ');
    builder.addRow(row, searchable);
    if (builder.byteLength >= SEGMENT_MAX_BYTES) {
      const seg = await flushSegment(userId, tableName, builder);
      if (seg) segments.push(seg);
      builder = new SegmentBuilder();
    }
  }
  const seg = await flushSegment(userId, tableName, builder);
  if (seg) segments.push(seg);

  const table = await commitSegments(userId, tableName, segments, rows.length);
  return { rowCount: table.rowCount, segmentsWritten: segments.length };
}

// Streams a large text file line-by-line into a table, one row per line, with
// real backpressure (each segment flush is awaited before more lines are read)
// so this stays memory-safe regardless of file size — this is what makes
// 50GB+ imports possible without loading the whole file into RAM.
async function ingestTextFileStreaming(userId, tableName, filePath, onProgress) {
  if (!validTableName(tableName)) throw new Error('Invalid table name.');
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let builder = new SegmentBuilder();
  const segments = [];
  let totalRows = 0;

  for await (const line of rl) {
    if (line.length === 0) continue;
    builder.addRow({ text: line }, line);
    totalRows += 1;
    if (builder.byteLength >= SEGMENT_MAX_BYTES) {
      const seg = await flushSegment(userId, tableName, builder);
      if (seg) {
        segments.push(seg);
        // Commit incrementally so a crash partway through a 50GB import doesn't
        // orphan everything already uploaded — only the segment still being
        // built at the moment of failure is lost, not everything before it.
        await commitSegments(userId, tableName, [seg], seg.rowCount);
        if (onProgress) onProgress({ rowsProcessed: totalRows, segmentsWritten: segments.length });
      }
      builder = new SegmentBuilder();
    }
  }
  const seg = await flushSegment(userId, tableName, builder);
  if (seg) {
    segments.push(seg);
    await commitSegments(userId, tableName, [seg], seg.rowCount);
  }
  if (onProgress) onProgress({ rowsProcessed: totalRows, segmentsWritten: segments.length, done: true });

  return { rowCount: totalRows, segmentsWritten: segments.length };
}

// Keyword search: scans index segments (small) for token/prefix matches, then
// pulls only the specific hit segments' data (see the module-level notes above
// for why that's "whole segment" rather than a precise byte range).
async function search(userId, tableName, keyword, { limit = 50 } = {}) {
  const catalog = await loadCatalog(userId);
  const table = catalog.tables[tableName];
  if (!table) throw new Error(`Unknown table "${tableName}".`);

  const term = String(keyword || '').toLowerCase().trim();
  if (!term) throw new Error('A search keyword is required.');

  const results = [];
  let matchCount = 0;
  let segmentsScanned = 0;

  for (const seg of table.segments) {
    if (results.length >= limit) break;
    segmentsScanned += 1;
    let storage;
    try {
      storage = await megaAccounts.getSession(userId, seg.label);
    } catch (err) {
      continue; // that account is currently unreachable — skip, don't fail the whole search
    }
    const indexFile = storage.files[seg.indexNodeId];
    if (!indexFile) continue;

    const indexBuf = await indexFile.downloadBuffer();
    const index = JSON.parse(indexBuf.toString('utf8'));
    const matchingTokens = Object.keys(index).filter((t) => t === term || t.startsWith(term));
    if (matchingTokens.length === 0) continue;

    const seen = new Map();
    for (const t of matchingTokens) {
      for (const [offset, length] of index[t]) seen.set(`${offset}:${length}`, [offset, length]);
    }
    const pointers = [...seen.values()].sort((a, b) => a[0] - b[0]);
    matchCount += pointers.length;
    if (pointers.length === 0) continue;

    const dataFile = storage.files[seg.dataNodeId];
    if (!dataFile) continue;
    const dataBuf = await dataFile.downloadBuffer();

    for (const [offset, length] of pointers) {
      if (results.length >= limit) break;
      try {
        const row = JSON.parse(dataBuf.subarray(offset, offset + length).toString('utf8'));
        results.push(row);
      } catch (err) {
        /* skip a malformed line rather than fail the whole search */
      }
    }
  }

  return { rows: results, matchCount, segmentsScanned, segmentsTotal: table.segments.length };
}

module.exports = {
  listTables,
  createTable,
  deleteTable,
  insertRows,
  ingestTextFileStreaming,
  search,
  listSegments,
  getSegmentData,
  getSegmentIndex,
  SEGMENT_MAX_BYTES,
};
