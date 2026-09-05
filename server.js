require('dotenv').config();
const express = require('express');
const path = require('path');

const requireAuth = require('./src/middleware/requireAuth');
const requireAdmin = require('./src/middleware/requireAdmin');
const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/accounts');
const fileRoutes = require('./src/routes/files');
const publicShareRoutes = require('./src/routes/publicShare');
const dbRoutes = require('./src/routes/db');
const adminRoutes = require('./src/routes/admin');
const apiKeyRoutes = require('./src/routes/apiKeys');
const { startKeepAlive } = require('./src/keepAlive');
const { startCloudHeartbeat } = require('./src/cloudHeartbeat');

for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MASTER_KEY']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable ${name}. See .env.example. Exiting.`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // needed for correct protocol/host behind Render's proxy
app.disable('x-powered-by');

// Enterprise Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '10mb' }));

// Cheap, unauthenticated, no external calls (Supabase/storage nodes) — this is what both
// the self-ping keep-alive (src/keepAlive.js) and any external uptime monitor
// should hit. Deliberately lightweight so pinging it every few minutes forever
// costs effectively nothing.
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// No server-side session middleware: auth is stateless. The frontend signs up/in
// directly against Supabase Auth (via supabase-js + the anon key) and attaches the
// resulting JWT as `Authorization: Bearer <token>` on every API call; requireAuth
// verifies that token fresh on each request. See src/middleware/requireAuth.js.
app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/db', requireAuth, dbRoutes);
app.use('/api/keys', requireAuth, apiKeyRoutes);
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
app.use('/share', publicShareRoutes); // intentionally NOT behind requireAuth — this is the public link surface

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Basic error safety net so a stray thrown error doesn't crash the whole server.
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`SoTaNik_AI Data Lake listening on port ${PORT}`);
  console.log(`[supabase] Using project: ${process.env.SUPABASE_URL}`);
});

// Uploads for large files take a while: the server receives the file from the
// browser, THEN re-uploads it to the storage lake, all within the same request/response cycle
// — so a big file can easily take several minutes end-to-end, especially on a
// slower connection. Node's defaults (headersTimeout: 60s, requestTimeout: 5min)
// are tuned for typical API requests and will silently kill a slow upload partway
// through, which looks exactly like "small files work, big ones just fail." Give
// large uploads real room to finish instead.
server.requestTimeout = 30 * 60 * 1000; // 30 min to fully receive the incoming request body
server.headersTimeout = 30 * 60 * 1000 + 5000; // must be >= requestTimeout per Node's own constraint
server.timeout = 0; // disable the separate idle-socket timeout for this flow
server.keepAliveTimeout = 65 * 1000; // keep the usual keep-alive behavior for normal requests

startKeepAlive();
startCloudHeartbeat();

// Note: if this is deployed behind another proxy/CDN in front of Node (Render's
// own edge, Cloudflare, nginx, etc.), that layer may have its own independent
// timeout or body-size limit that these settings can't reach — worth checking
// there too if large uploads still fail after this change.
