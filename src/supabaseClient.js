const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Server-side client, authenticated with the SERVICE ROLE key. This key bypasses
// Row Level Security entirely — that's expected and required here, because the
// server needs to read/write on behalf of whichever user made the request. Every
// query the server issues is scoped by hand using req.userId (taken from that
// user's verified Supabase JWT, see src/middleware/requireAuth.js), so RLS bypass
// on this connection does not mean users can see each other's data.
//
// CRITICAL: this client (and the service role key behind it) must never be sent
// to the browser. Only src/supabaseClient's `publicConfig` (the URL + anon key)
// is ever exposed to the frontend, via GET /api/auth/config.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Safe to expose to the browser. The anon/publishable key has no power on its
// own — it can only do what the RLS policies in supabase/schema.sql allow, which
// is "read/write rows you own, once signed in." This is the standard, documented
// way Supabase expects the anon key to be used.
const publicConfig = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
};

module.exports = { supabaseAdmin, publicConfig };
