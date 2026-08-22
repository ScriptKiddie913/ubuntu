// Render's free tier spins a web service down after ~15 minutes with no inbound
// HTTP traffic, then "cold starts" it (10-30s delay) on the next request. This
// pings the app's own public /health endpoint on an interval well under that
// window, so Render's edge keeps seeing real traffic and never spins it down.
//
// Render sets RENDER_EXTERNAL_URL automatically for every web service — no
// config needed there. If you're running this somewhere else, set SELF_PING_URL
// yourself (e.g. https://your-app.example.com) to get the same effect; if
// neither is set, this simply does nothing (e.g. local dev, or a plan that
// doesn't spin down, like Render's paid tiers).
//
// Caveat worth knowing: this only prevents spin-down WHILE the process is
// already running — it can't wake an instance that's already asleep (a sleeping
// instance isn't running this code either). For extra redundancy, you can also
// point a free external cron service (UptimeRobot, cron-job.org, etc.) at
// `${your-url}/health` every 10 minutes — that hits Render's edge from outside
// no matter what state the instance is in, which is the more bulletproof setup.

const PING_INTERVAL_MS = 10 * 60 * 1000; // safely under Render's 15-minute idle window
const FIRST_PING_DELAY_MS = 20 * 1000;

function startKeepAlive() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;

  if (!baseUrl) {
    console.log(
      '[keep-alive] No RENDER_EXTERNAL_URL / SELF_PING_URL set — skipping self-ping ' +
        '(expected in local dev, or on a plan that doesn\'t spin down).'
    );
    return;
  }

  let target;
  try {
    target = new URL('/health', baseUrl).toString();
  } catch (err) {
    console.error(`[keep-alive] Invalid URL "${baseUrl}" — skipping self-ping.`, err.message);
    return;
  }

  async function ping() {
    try {
      const res = await fetch(target, { method: 'GET' });
      console.log(`[keep-alive] ping ${target} -> ${res.status}`);
    } catch (err) {
      console.warn(`[keep-alive] ping to ${target} failed: ${err.message}`);
    }
  }

  console.log(`[keep-alive] Will self-ping ${target} every ${PING_INTERVAL_MS / 60000} minutes.`);
  setTimeout(ping, FIRST_PING_DELAY_MS);
  setInterval(ping, PING_INTERVAL_MS);
}

module.exports = { startKeepAlive };
