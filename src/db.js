const { supabaseAdmin } = require('./supabaseClient');

// This module is the only place that talks to Postgres directly. Every function
// takes the caller's userId (taken from their verified JWT in requireAuth) and
// filters by it explicitly — the service-role connection bypasses RLS, so this
// hand-scoping is what actually keeps one user's accounts/files invisible to
// another, on top of the database-level RLS policies in supabase/schema.sql.

function normalizeAccount(row) {
  if (!row) return null;
  return {
    label: row.label,
    email: row.email,
    passwordEncrypted: row.password_encrypted,
    addedAt: row.added_at,
  };
}

function normalizeFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    size: Number(row.size),
    chunks: row.chunks || [],
    createdAt: row.created_at,
    share: row.share_token
      ? { token: row.share_token, createdAt: row.share_created_at, expiresAt: row.share_expires_at }
      : null,
  };
}

// ---------------- MEGA accounts ----------------

async function listAccounts(userId) {
  const { data, error } = await supabaseAdmin
    .from('mega_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: true });
  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  return data.map(normalizeAccount);
}

async function findAccount(userId, label) {
  const { data, error } = await supabaseAdmin
    .from('mega_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('label', label)
    .maybeSingle();
  if (error) throw new Error(`Failed to load account: ${error.message}`);
  return normalizeAccount(data);
}

async function insertAccount(userId, { label, email, passwordEncrypted }) {
  const { data, error } = await supabaseAdmin
    .from('mega_accounts')
    .insert({ user_id: userId, label, email, password_encrypted: passwordEncrypted })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`An account labeled "${label}" already exists.`);
    throw new Error(`Failed to save account: ${error.message}`);
  }
  return normalizeAccount(data);
}

// ---------------- Files ----------------

async function listFiles(userId) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load files: ${error.message}`);
  return data.map(normalizeFile);
}

async function findFile(userId, id) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load file: ${error.message}`);
  return normalizeFile(data);
}

async function insertFile(userId, record) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .insert({
      id: record.id,
      user_id: userId,
      name: record.name,
      size: record.size,
      chunks: record.chunks,
      created_at: record.createdAt,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to save file record: ${error.message}`);
  return normalizeFile(data);
}

async function deleteFile(userId, id) {
  const { error } = await supabaseAdmin.from('pool_files').delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error(`Failed to delete file record: ${error.message}`);
}

async function setFileShare(userId, id, share) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .update({
      share_token: share ? share.token : null,
      share_created_at: share ? share.createdAt : null,
      share_expires_at: share ? share.expiresAt : null,
    })
    .eq('user_id', userId)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update share link: ${error.message}`);
  return normalizeFile(data);
}

// Not user-scoped by design — a share link is meant to be found by its token
// alone, by an anonymous visitor. This is only ever called from the public
// /share/:token route via the service-role connection; it never touches the
// anon key, so it does not need (and deliberately has no) RLS policy backing
// anonymous access.
async function findFileByShareToken(token) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .select('*')
    .eq('share_token', token)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up shared file: ${error.message}`);
  return normalizeFile(data);
}

module.exports = {
  listAccounts,
  findAccount,
  insertAccount,
  listFiles,
  findFile,
  insertFile,
  deleteFile,
  setFileShare,
  findFileByShareToken,
};
