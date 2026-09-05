const { supabaseAdmin } = require('./supabaseClient');

function normalizeAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    passwordEncrypted: row.password_encrypted,
    addedAt: row.added_at,
    isPublic: !!row.is_public,
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

// ---------------- Personal Storage Accounts ----------------

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
    if (error.code === '23505') throw new Error(`A node labeled "${label}" already exists in your pool.`);
    throw new Error(`Failed to save account: ${error.message}`);
  }
  return normalizeAccount(data);
}

// ---------------- Public Storage Nodes (Admin Managed) ----------------

async function listPublicNodes() {
  const { data, error } = await supabaseAdmin
    .from('public_storage_nodes')
    .select('*')
    .order('added_at', { ascending: true });
  if (error) {
    if (error.code === '42P01') return []; // table not yet migrated
    throw new Error(`Failed to load public storage nodes: ${error.message}`);
  }

  // Also fetch allocations for each node
  const { data: allocations } = await supabaseAdmin
    .from('public_node_allocations')
    .select('*');

  return (data || []).map((node) => {
    const allocatedUsers = (allocations || [])
      .filter((a) => a.node_id === node.id)
      .map((a) => a.user_id);
    return {
      id: node.id,
      label: node.label,
      email: node.email,
      passwordEncrypted: node.password_encrypted,
      notes: node.notes || '',
      addedAt: node.added_at,
      allocatedUserIds: allocatedUsers,
      isPublic: true,
    };
  });
}

async function findPublicNodeByLabel(label) {
  const { data, error } = await supabaseAdmin
    .from('public_storage_nodes')
    .select('*')
    .eq('label', label)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    label: data.label,
    email: data.email,
    passwordEncrypted: data.password_encrypted,
    isPublic: true,
  };
}

async function insertPublicNode({ label, email, passwordEncrypted, notes }) {
  const { data, error } = await supabaseAdmin
    .from('public_storage_nodes')
    .insert({
      label,
      email,
      password_encrypted: passwordEncrypted,
      notes: notes || '',
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`A public node labeled "${label}" already exists.`);
    throw new Error(`Failed to create public node: ${error.message}`);
  }
  return data;
}

async function deletePublicNode(nodeId) {
  const { error } = await supabaseAdmin
    .from('public_storage_nodes')
    .delete()
    .eq('id', nodeId);
  if (error) throw new Error(`Failed to delete public node: ${error.message}`);
}

async function allocatePublicNode(nodeId, userId) {
  const { data, error } = await supabaseAdmin
    .from('public_node_allocations')
    .insert({ node_id: nodeId, user_id: userId })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('User already has this public storage node allocated.');
    throw new Error(`Failed to allocate node: ${error.message}`);
  }
  return data;
}

async function revokePublicNodeAllocation(nodeId, userId) {
  const { error } = await supabaseAdmin
    .from('public_node_allocations')
    .delete()
    .eq('node_id', nodeId)
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to revoke allocation: ${error.message}`);
}

async function getUserAllocatedPublicNodes(userId) {
  const { data: allocs, error: aErr } = await supabaseAdmin
    .from('public_node_allocations')
    .select('node_id')
    .eq('user_id', userId);
  
  if (aErr || !allocs || allocs.length === 0) return [];
  const nodeIds = allocs.map((a) => a.node_id);

  const { data: nodes, error: nErr } = await supabaseAdmin
    .from('public_storage_nodes')
    .select('*')
    .in('id', nodeIds);
  
  if (nErr || !nodes) return [];
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    email: node.email,
    passwordEncrypted: node.password_encrypted,
    addedAt: node.added_at,
    isPublic: true,
  }));
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

async function findFileByShareToken(token) {
  const { data, error } = await supabaseAdmin
    .from('pool_files')
    .select('*')
    .eq('share_token', token)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up shared file: ${error.message}`);
  return normalizeFile(data);
}

// ---------------- Super-Admin Functions ----------------

async function adminListUsers() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Failed to list users from auth: ${error.message}`);

  const users = data.users || [];

  // Get file counts & node counts
  const { data: fileCounts } = await supabaseAdmin.from('pool_files').select('user_id, size');
  const { data: nodeCounts } = await supabaseAdmin.from('mega_accounts').select('user_id');
  const { data: allocations } = await supabaseAdmin
    .from('public_node_allocations')
    .select('user_id, public_storage_nodes(label)');

  return users.map((u) => {
    const userFiles = (fileCounts || []).filter((f) => f.user_id === u.id);
    const totalBytes = userFiles.reduce((sum, f) => sum + Number(f.size || 0), 0);
    const personalNodes = (nodeCounts || []).filter((n) => n.user_id === u.id).length;
    const userAllocs = (allocations || [])
      .filter((a) => a.user_id === u.id)
      .map((a) => (a.public_storage_nodes ? a.public_storage_nodes.label : ''));

    return {
      id: u.id,
      email: u.email,
      emailConfirmed: !!u.email_confirmed_at,
      createdAt: u.created_at,
      fileCount: userFiles.length,
      totalBytes,
      personalNodes,
      allocatedPublicNodes: userAllocs,
    };
  });
}

module.exports = {
  listAccounts,
  findAccount,
  insertAccount,
  listPublicNodes,
  findPublicNodeByLabel,
  insertPublicNode,
  deletePublicNode,
  allocatePublicNode,
  revokePublicNodeAllocation,
  getUserAllocatedPublicNodes,
  listFiles,
  findFile,
  insertFile,
  deleteFile,
  setFileShare,
  findFileByShareToken,
  adminListUsers,
};
