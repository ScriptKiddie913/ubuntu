const express = require('express');
const { supabaseAdmin, publicConfig } = require('../supabaseClient');

const router = express.Router();

// Public, unauthenticated. Hands the browser what it needs to talk to Supabase
// Auth directly (sign up / sign in / sign out all happen client-side against
// Supabase, using this anon key — the server is never involved in the password
// exchange itself). The anon key is meant to be public; see the comment in
// src/supabaseClient.js and the RLS policies in supabase/schema.sql for why
// that's safe.
router.get('/config', (req, res) => {
  if (!publicConfig.supabaseUrl || !publicConfig.supabaseAnonKey) {
    return res.status(500).json({ error: 'Server misconfigured: SUPABASE_URL / SUPABASE_ANON_KEY not set.' });
  }
  res.json(publicConfig);
});

// Lets the frontend check whether the bearer token it's holding is still
// valid, and whether that account has verified its email yet, without
// tripping the 401/403 that requireAuth would throw on a protected route.
router.get('/status', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.json({ authenticated: false });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return res.json({ authenticated: false });

  res.json({
    authenticated: true,
    email: data.user.email,
    emailVerified: !!data.user.email_confirmed_at,
  });
});

module.exports = router;
