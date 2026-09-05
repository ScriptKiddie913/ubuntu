const crypto = require('crypto');
const { supabaseAdmin } = require('../supabaseClient');

// Protected route middleware: supports both Supabase client JWTs and
// programmatic API keys (X-API-Key or Authorization: Bearer sot_live_...).
// External scrapers and automated pipelines can query and stream files without a browser.
module.exports = async function requireAuth(req, res, next) {
  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  // 1. Programmatic API Key Authentication
  let candidateApiKey = null;
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    candidateApiKey = apiKeyHeader.trim();
  } else if (bearerToken && bearerToken.startsWith('sot_')) {
    candidateApiKey = bearerToken;
  }

  if (candidateApiKey) {
    const keyHash = crypto.createHash('sha256').update(candidateApiKey).digest('hex');

    const { data: keyRecord, error: keyErr } = await supabaseAdmin
      .from('api_keys')
      .select('id, user_id, name')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyErr || !keyRecord) {
      return res.status(401).json({ error: 'Invalid, expired, or revoked API key.' });
    }

    // Touch last_used_at asynchronously
    supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)
      .then(() => {})
      .catch(() => {});

    // Lookup user in auth to fetch confirmed email
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(keyRecord.user_id);
    if (userErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Tenant associated with API key not found.' });
    }

    req.userId = userData.user.id;
    req.userEmail = userData.user.email;
    req.userConfirmedAt = userData.user.email_confirmed_at;
    req.user = userData.user;
    req.isApiKey = true;
    req.apiKeyName = keyRecord.name;
    return next();
  }

  // 2. Standard Supabase JWT Bearer Authentication
  if (!bearerToken) {
    return res.status(401).json({ error: 'Authentication required. Provide an Authorization Bearer token or X-API-Key header.' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(bearerToken);
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
  req.userConfirmedAt = data.user.email_confirmed_at;
  req.user = data.user;
  next();
};
