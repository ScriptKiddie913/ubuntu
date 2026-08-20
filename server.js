require('dotenv').config();
const express = require('express');
const path = require('path');

const requireAuth = require('./src/middleware/requireAuth');
const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/accounts');
const fileRoutes = require('./src/routes/files');
const publicShareRoutes = require('./src/routes/publicShare');

for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'MASTER_KEY']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable ${name}. See .env.example. Exiting.`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // needed for correct protocol/host behind Render's proxy

app.use(express.json());

// No server-side session middleware: auth is stateless. The frontend signs up/in
// directly against Supabase Auth (via supabase-js + the anon key) and attaches the
// resulting JWT as `Authorization: Bearer <token>` on every API call; requireAuth
// verifies that token fresh on each request. See src/middleware/requireAuth.js.
app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/files', requireAuth, fileRoutes);
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
app.listen(PORT, () => {
  console.log(`MegaPool listening on port ${PORT}`);
  console.log(`[supabase] Using project: ${process.env.SUPABASE_URL}`);
});
