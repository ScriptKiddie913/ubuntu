const { supabaseAdmin } = require('../supabaseClient');

// Every protected route sends `Authorization: Bearer <supabase access token>`,
// obtained client-side from supabase-js after sign-in. We verify it against
// Supabase Auth on every request (no server-side session state to manage) and
// attach the caller's user id, which every downstream query then filters by.
module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) {
    return res.status(401).json({ error: 'Session expired or invalid — please sign in again.' });
  }

  if (!data.user.email_confirmed_at) {
    return res
      .status(403)
      .json({ error: 'Please verify your email address first — check your inbox for the confirmation link.' });
  }

  req.userId = data.user.id;
  req.userEmail = data.user.email;
  next();
};
