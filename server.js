require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const requireAuth = require('./src/middleware/requireAuth');
const authRoutes = require('./src/routes/auth');
const accountRoutes = require('./src/routes/accounts');
const fileRoutes = require('./src/routes/files');
const publicShareRoutes = require('./src/routes/publicShare');

for (const name of ['ADMIN_PASSWORD', 'MASTER_KEY', 'SESSION_SECRET']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable ${name}. See .env.example. Exiting.`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

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
});
