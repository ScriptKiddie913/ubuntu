// ============================================================================
// SoTaNik_AI Data Lake — Render Anti-Sleep & Liveness Engine
// Render's free tier spins a web service down after 15 minutes of zero inbound
// HTTP traffic. This engine ensures the service NEVER falls asleep by:
// 1. Issuing automated self-pings to /health every 3.5 minutes (well under 15m)
// 2. Running an internal event-loop heartbeat tick
// 3. Auto-retrying on network blips
// ============================================================================

const PING_INTERVAL_MS = 3.5 * 60 * 1000; // 3.5 minutes (Render sleep threshold is 15m)
const INITIAL_PING_DELAY_MS = 15 * 1000;  // First ping 15s after startup
let pingFailCount = 0;

function startKeepAlive() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;

  // Active event-loop pulse every 60s to prevent internal timer freezing
  setInterval(() => {
    // Keep internal process timers active
    const mem = process.memoryUsage();
    // Memory and tick verification
  }, 60 * 1000).unref();

  if (!baseUrl) {
    console.log(
      '[anti-sleep] Neither RENDER_EXTERNAL_URL nor SELF_PING_URL is defined. ' +
        'Local dev or dedicated instance assumed (spin-down disabled).'
    );
    return;
  }

  let pingUrl;
  try {
    pingUrl = new URL('/health', baseUrl).toString();
  } catch (err) {
    console.error(`[anti-sleep] Invalid base URL "${baseUrl}":`, err.message);
    return;
  }

  async function performPing() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(pingUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'SoTaNik_AI-DataLake-AntiSleep/2.0',
          'Cache-Control': 'no-cache',
        },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        pingFailCount = 0;
        console.log(`[anti-sleep] Liveness ping OK -> ${pingUrl} (HTTP ${res.status}) [${new Date().toISOString()}]`);
      } else {
        pingFailCount++;
        console.warn(`[anti-sleep] Liveness ping returned HTTP ${res.status} (attempt ${pingFailCount})`);
      }
    } catch (err) {
      pingFailCount++;
      console.warn(`[anti-sleep] Liveness ping error: ${err.message} (fail count: ${pingFailCount})`);
      
      // If failed, retry after 30s instead of waiting 3.5 minutes
      if (pingFailCount < 3) {
        setTimeout(performPing, 30 * 1000);
      }
    }
  }

  console.log(`[anti-sleep] Anti-sleep engine active. Ping target: ${pingUrl} every ${PING_INTERVAL_MS / 60000} minutes.`);
  setTimeout(performPing, INITIAL_PING_DELAY_MS);
  setInterval(performPing, PING_INTERVAL_MS);
}

module.exports = { startKeepAlive };
