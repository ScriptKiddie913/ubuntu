// Small safety margin per account so we never try to upload right up against the
// exact quota edge (MEGA sometimes rejects uploads a few KB before the hard limit).
const RESERVE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Greedy largest-free-account-first placement.
 * - If the whole file fits (within chunkMaxBytes) on the account with the most
 *   free space, it is stored as a single object there (no unnecessary splitting).
 * - Otherwise the file is split into as few chunks as possible, filling the
 *   emptiest accounts first, so the pool is used evenly and no single chunk
 *   exceeds chunkMaxBytes.
 *
 * @param {number} fileSize
 * @param {Array<{label:string,status:string,spaceFree:number}>} accounts
 * @param {number} chunkMaxBytes
 * @returns {Array<{label:string,size:number}>} ordered chunk plan, sizes sum to fileSize
 */
function planPlacement(fileSize, accounts, chunkMaxBytes) {
  const avail = accounts
    .filter((a) => a.status === 'ok')
    .map((a) => ({ label: a.label, free: Math.max(0, a.spaceFree - RESERVE_BYTES) }))
    .filter((a) => a.free > 0)
    .sort((a, b) => b.free - a.free);

  if (avail.length === 0) {
    throw new Error('No usable MEGA accounts with free space. Add or reconnect an account first.');
  }

  const totalFree = avail.reduce((sum, a) => sum + a.free, 0);
  if (fileSize > totalFree) {
    throw new Error(
      `Not enough combined free space: need ${formatBytes(fileSize)}, pool only has ${formatBytes(
        totalFree
      )} free.`
    );
  }

  // Mutable working copy: an account can receive more than one chunk if a single
  // chunk can't exceed chunkMaxBytes but the account still has free space left over.
  const working = avail.map((a) => ({ ...a }));
  const plan = [];
  let remaining = fileSize;
  while (remaining > 0) {
    working.sort((a, b) => b.free - a.free);
    const acc = working[0];
    if (!acc || acc.free <= 0) break;
    const take = Math.min(acc.free, chunkMaxBytes, remaining);
    if (take <= 0) break;
    plan.push({ label: acc.label, size: take });
    acc.free -= take;
    remaining -= take;
  }

  if (remaining > 0) {
    // Ran out of per-account room even though total free space looked sufficient
    // (this only happens if chunkMaxBytes itself is smaller than the leftover).
    throw new Error(
      'Could not fully place the file across the available accounts. Try raising CHUNK_MAX_BYTES.'
    );
  }

  // A zero-byte file still needs exactly one (empty) chunk to be recorded.
  if (plan.length === 0) plan.push({ label: avail[0].label, size: 0 });

  return plan;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

module.exports = { planPlacement, formatBytes, RESERVE_BYTES };
