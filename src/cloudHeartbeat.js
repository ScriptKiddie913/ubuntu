// ============================================================================
// SoTaNik_AI Data Lake — Cloud Account Anti-Deactivation Heartbeat Engine
// Cloud storage providers deactivate or flag accounts if unused for 90 days.
// This scheduler runs daily across all mounted personal and public storage
// accounts, authenticating and requesting fresh telemetry so cloud accounts
// remain permanently active and never get suspended due to inactivity.
// ============================================================================

const { supabaseAdmin } = require('./supabaseClient');
const { decrypt } = require('./crypto');
const { Storage } = require('megajs');

const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run every 24 hours
const INITIAL_HEARTBEAT_DELAY_MS = 45 * 1000;     // Run 45s after server boots

let heartbeatState = {
  lastRunAt: null,
  accountsChecked: 0,
  accountsActive: 0,
  accountsFailed: 0,
  isRunning: false,
  lastError: null,
};

async function pingSingleAccount(email, password) {
  const storage = await new Storage({
    email,
    password,
    userAgent: 'SoTaNik_AI-DataLake-Heartbeat/2.0',
  }).ready;

  try {
    const info = await storage.getAccountInfo();
    // Read root file count to register API activity
    const fileCount = Object.keys(storage.files || {}).length;
    return { info, fileCount };
  } finally {
    // Release the MEGA connection to avoid leaking event listeners and sockets
    try { storage.close(); } catch (_) { /* best-effort cleanup */ }
  }
}

async function runCloudHeartbeat() {
  if (heartbeatState.isRunning) {
    console.log('[cloud-heartbeat] Heartbeat already running in background, skipping.');
    return heartbeatState;
  }

  heartbeatState.isRunning = true;
  heartbeatState.lastError = null;
  console.log('[cloud-heartbeat] Starting periodic cloud account inactivity protection sweep…');

  let checked = 0;
  let active = 0;
  let failed = 0;

  try {
    // 1. Fetch all personal storage nodes
    const { data: personalNodes, error: pErr } = await supabaseAdmin
      .from('mega_accounts')
      .select('id, user_id, label, email, password_encrypted');
    
    if (pErr) console.warn('[cloud-heartbeat] Error loading personal nodes:', pErr.message);

    // 2. Fetch all public storage nodes
    const { data: publicNodes, error: pubErr } = await supabaseAdmin
      .from('public_storage_nodes')
      .select('id, label, email, password_encrypted');

    if (pubErr && pubErr.code !== '42P01') {
      console.warn('[cloud-heartbeat] Error loading public nodes:', pubErr.message);
    }

    const allNodes = [
      ...(personalNodes || []).map((n) => ({ ...n, type: 'personal' })),
      ...(publicNodes || []).map((n) => ({ ...n, type: 'public' })),
    ];

    checked = allNodes.length;

    for (const node of allNodes) {
      try {
        const plainPassword = decrypt(node.password_encrypted);
        await pingSingleAccount(node.email, plainPassword);
        active++;
        console.log(`[cloud-heartbeat] Account [${node.label}] (${node.email}) kept alive successfully.`);
      } catch (err) {
        failed++;
        console.warn(`[cloud-heartbeat] Failed to ping account [${node.label}] (${node.email}):`, err.message);
      }
      // Stagger pings by 1.5s to prevent cloud provider burst rate limits
      await new Promise((r) => setTimeout(r, 1500));
    }

    heartbeatState.lastRunAt = new Date().toISOString();
    heartbeatState.accountsChecked = checked;
    heartbeatState.accountsActive = active;
    heartbeatState.accountsFailed = failed;

    console.log(
      `[cloud-heartbeat] Completed sweep: ${active} active / ${checked} total (${failed} errors). Accounts protected from deactivation.`
    );
  } catch (err) {
    heartbeatState.lastError = err.message;
    console.error('[cloud-heartbeat] Fatal error during cloud account sweep:', err);
  } finally {
    heartbeatState.isRunning = false;
  }

  return heartbeatState;
}

function startCloudHeartbeat() {
  console.log(`[cloud-heartbeat] Scheduler registered. Next sweep in ${INITIAL_HEARTBEAT_DELAY_MS / 1000}s.`);
  setTimeout(runCloudHeartbeat, INITIAL_HEARTBEAT_DELAY_MS);
  setInterval(runCloudHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function getHeartbeatStatus() {
  return { ...heartbeatState };
}

module.exports = {
  startCloudHeartbeat,
  runCloudHeartbeat,
  getHeartbeatStatus,
};
