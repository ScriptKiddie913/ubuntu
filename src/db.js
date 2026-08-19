const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = { accounts: [], files: [] };

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY, null, 2));
}

function readRaw() {
  ensureFile();
  try {
    const text = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return { accounts: parsed.accounts || [], files: parsed.files || [] };
  } catch (err) {
    console.error('[db] Failed to read/parse db.json, starting from an empty store:', err.message);
    return { ...EMPTY };
  }
}

function writeRaw(data) {
  ensureFile();
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, DB_PATH); // atomic-ish swap, avoids truncated files on crash
}

// Serialize all writes through a promise chain so concurrent requests don't clobber each other.
let queue = Promise.resolve();
function mutate(fn) {
  queue = queue.then(async () => {
    const data = readRaw();
    const result = await fn(data);
    writeRaw(data);
    return result;
  });
  return queue;
}

module.exports = {
  read: readRaw,
  mutate,
  DB_PATH,
};
