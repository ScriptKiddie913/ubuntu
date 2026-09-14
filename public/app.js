const el = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ---------- State Store ----------
let cachedFiles = [];
let cachedAccounts = [];
let activeNodeFilter = null;
let currentSearchTerm = '';
let currentCategoryFilter = 'all';
let currentSortKey = 'date-desc';
let currentViewMode = 'table'; // 'table' or 'grid'

// ---------- Toasts ----------
function toast(message, kind = 'info') {
  const container = el('toast-container');
  if (!container) return;
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  container.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast-in'));
  setTimeout(() => {
    node.classList.remove('toast-in');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
  }, 4500);
}

// ---------- Activity Audit Log (Feature 9) ----------
const AUDIT_STORAGE_KEY = 'sotanik_lake_audit_log';

function getAuditLogs() {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function recordAuditLog(action, description) {
  const logs = getAuditLogs();
  logs.unshift({
    action,
    description,
    timestamp: new Date().toISOString(),
  });
  if (logs.length > 50) logs.pop();
  try {
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs));
  } catch {}
  renderAuditLogs();
}

function renderAuditLogs() {
  const container = el('activity-timeline');
  if (!container) return;
  const logs = getAuditLogs();
  if (logs.length === 0) {
    container.innerHTML = `
      <div class="timeline-item">
        <div class="timeline-item-left">
          <span class="timeline-type-tag">CLUSTER</span>
          <span>Cluster operational. Ready for ingestion and telemetry.</span>
        </div>
        <span class="timeline-time">Live</span>
      </div>`;
    return;
  }
  container.innerHTML = logs.slice(0, 15).map((log) => `
    <div class="timeline-item">
      <div class="timeline-item-left">
        <span class="timeline-type-tag">${escapeHtml(log.action)}</span>
        <span>${escapeHtml(log.description)}</span>
      </div>
      <span class="timeline-time">${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
  `).join('');
}

// ---------- Theme Manager (Feature 20) ----------
function initTheme() {
  const saved = localStorage.getItem('sotanik_lake_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeButtonLabel(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('sotanik_lake_theme', next);
  updateThemeButtonLabel(next);
  toast(`Theme shifted to ${next === 'dark' ? 'Deep Charcoal' : 'Warm Cream'}`, 'info');
}

function updateThemeButtonLabel(theme) {
  const label = el('theme-btn-label');
  if (label) {
    label.textContent = theme === 'dark' ? 'Warm Cream Mode' : 'Charcoal Mode';
  }
}

// ---------- Supabase Client ----------
let supabaseClient = null;

async function initSupabase() {
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    throw new Error('Supabase client library failed to load (check connection or ad-blocker).');
  }
  let res;
  try {
    res = await fetch('/api/auth/config');
  } catch (err) {
    throw new Error('Could not reach the SoTaNik_AI Data Lake server. Is it running?');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Server rejected the configuration request.');
  }
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Server is missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables.');
  }
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

async function getAccessToken() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

// ---------- API Helper ----------
async function api(path, options = {}) {
  const token = await getAccessToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Screen Management ----------
function switchScreen(id) {
  ['boot-screen', 'login-screen', 'app-screen'].forEach((s) => {
    const node = el(s);
    if (!node) return;
    if (s === id) {
      node.classList.remove('hidden');
      node.classList.add('screen-in');
    } else {
      node.classList.add('hidden');
      node.classList.remove('screen-in');
    }
  });
}

function showLogin() {
  switchScreen('login-screen');
  showAuthTab('signin');
}

async function showApp() {
  switchScreen('app-screen');
  const { data } = await supabaseClient.auth.getUser();
  const userEmail = (data && data.user && data.user.email) || '';
  el('user-email-badge').textContent = userEmail;
  initSidebar();
  setupAdminConsole(userEmail);
  loadAccounts();
  loadFiles();
  loadApiKeys();
  renderAuditLogs();
}

function showBootError(message) {
  el('boot-status').classList.add('hidden');
  el('boot-error-message').textContent = message;
  el('boot-error').classList.remove('hidden');
}

async function init() {
  initTheme();
  el('boot-error').classList.add('hidden');
  el('boot-status').classList.remove('hidden');
  switchScreen('boot-screen');

  try {
    await initSupabase();
  } catch (err) {
    showBootError(err.message || 'Error initializing SoTaNik_AI Data Lake.');
    return;
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) showApp();
    else showLogin();
  });

  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) await showApp();
    else showLogin();
  } catch (err) {
    showBootError('Could not verify authentication session. ' + (err.message || ''));
  }
}

el('boot-retry-btn').addEventListener('click', init);

// ---------- Auth Tab Controller ----------
function showAuthTab(which) {
  const isSignin = which === 'signin';
  el('tab-signin').classList.toggle('active', isSignin);
  el('tab-signup').classList.toggle('active', !isSignin);
  el('signin-form').classList.toggle('hidden', !isSignin);
  el('signup-form').classList.toggle('hidden', isSignin);
  el('verify-notice').classList.add('hidden');

  const indicator = el('auth-tab-indicator');
  if (indicator) {
    indicator.style.transform = isSignin ? 'translateX(0%)' : 'translateX(100%)';
  }
}

el('tab-signin').addEventListener('click', () => showAuthTab('signin'));
el('tab-signup').addEventListener('click', () => showAuthTab('signup'));

el('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('signin-error').classList.add('hidden');
  const email = el('signin-email').value.trim();
  const password = el('signin-password').value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    el('signin-error').textContent = /confirm/i.test(error.message)
      ? 'Please verify your email address via the confirmation link sent to your inbox.'
      : error.message;
    el('signin-error').classList.remove('hidden');
    return;
  }
  el('signin-password').value = '';
  recordAuditLog('AUTH', `Tenant authenticated: ${email}`);
});

el('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('signup-error').classList.add('hidden');
  const email = el('signup-email').value.trim();
  const password = el('signup-password').value;
  const confirm = el('signup-password-confirm').value;

  if (password !== confirm) {
    el('signup-error').textContent = 'Passwords do not match.';
    el('signup-error').classList.remove('hidden');
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    el('signup-error').textContent = error.message;
    el('signup-error').classList.remove('hidden');
    return;
  }

  el('signup-form').reset();
  if (!data.session) {
    el('signin-form').classList.add('hidden');
    el('signup-form').classList.add('hidden');
    el('verify-email-addr').textContent = email;
    el('verify-notice').classList.remove('hidden');
  }
  recordAuditLog('PROVISION', `New tenant registered: ${email}`);
});

el('verify-back-btn').addEventListener('click', () => showAuthTab('signin'));

el('logout-btn').addEventListener('click', async () => {
  recordAuditLog('AUTH', 'Tenant signed out');
  await supabaseClient.auth.signOut();
  showLogin();
});

// ---------- Storage Nodes (Accounts) & Cluster Topology ----------
async function loadAccounts() {
  let summary;
  try {
    summary = await api('/api/accounts');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  cachedAccounts = summary.accounts || [];
  const pct = summary.spaceTotal ? Math.min(100, (summary.spaceUsed / summary.spaceTotal) * 100) : 0;
  
  el('pool-bar-fill').style.width = `${pct}%`;
  el('pool-summary-text').textContent = summary.spaceTotal
    ? `${formatBytes(summary.spaceUsed)} / ${formatBytes(summary.spaceTotal)} pooled (${pct.toFixed(1)}% full)`
    : 'No storage nodes mounted.';

  // Feature 6: Update Scorecard Metrics
  if (el('stat-total-capacity')) el('stat-total-capacity').textContent = formatBytes(summary.spaceTotal);
  if (el('stat-used-capacity')) el('stat-used-capacity').textContent = formatBytes(summary.spaceUsed);
  if (el('stat-utilization-pct')) el('stat-utilization-pct').textContent = `${pct.toFixed(1)}% capacity utilized`;
  if (el('stat-free-capacity')) el('stat-free-capacity').textContent = formatBytes(summary.spaceFree);
  if (el('stat-node-count')) el('stat-node-count').textContent = `${cachedAccounts.length} storage node${cachedAccounts.length === 1 ? '' : 's'} mounted`;

  // Feature 7: Load Balancer Advisor Check
  updateLoadBalancerAdvisor(cachedAccounts, summary);

  const list = el('accounts-list');
  list.innerHTML = '';

  if (cachedAccounts.length === 0) {
    list.innerHTML = `<div class="accounts-empty muted">No storage nodes mounted yet — mount a node to begin sharding objects across the lake.</div>`;
    return;
  }

  cachedAccounts.forEach((acc, i) => {
    const card = document.createElement('div');
    const isFiltered = activeNodeFilter === acc.label;
    card.className = 'account-card' + (acc.status === 'error' ? ' error' : '') + (isFiltered ? ' active-filter' : '');
    card.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
    const accPct = acc.spaceTotal ? Math.min(100, (acc.spaceUsed / acc.spaceTotal) * 100) : 0;
    
    card.innerHTML = `
      <div class="account-card-header">
        <div class="acc-label">${escapeHtml(acc.label)}</div>
        <span class="node-status-badge">${acc.status === 'error' ? 'DISCONNECTED' : 'MOUNTED'}</span>
      </div>
      ${
        acc.status === 'error'
          ? `<div class="error" style="font-size:11.5px;">${escapeHtml(acc.error || 'Connection error')}</div>
             <button class="secondary btn-xs reconnect-node-btn" data-node-label="${escapeHtml(acc.label)}" style="margin-top:6px;width:100%;font-size:11px;padding:4px 8px;">⟳ Reconnect Node</button>`
          : `<div class="mini-bar"><div class="mini-bar-fill" style="width:${accPct}%"></div></div>
             <div class="node-card-footer">
               <span>${formatBytes(acc.spaceUsed)} / ${formatBytes(acc.spaceTotal)}</span>
               <span>${accPct.toFixed(1)}%</span>
             </div>`
      }
    `;

    // Feature 10: Click to Filter Files by Node
    card.addEventListener('click', (e) => {
      // Don't filter when clicking the reconnect button
      if (e.target.closest('.reconnect-node-btn')) return;
      toggleNodeFilter(acc.label);
    });

    list.appendChild(card);
  });

  // Wire Reconnect Buttons
  list.querySelectorAll('.reconnect-node-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const label = btn.getAttribute('data-node-label');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Reconnecting…';
      try {
        await api(`/api/accounts/${encodeURIComponent(label)}/reconnect`, { method: 'POST' });
        toast(`Node "${label}" reconnected successfully.`, 'success');
        recordAuditLog('NODE', `Reconnected storage node: ${label}`);
        loadAccounts();
      } catch (err) {
        toast(`Reconnect failed for "${label}": ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });
}

function updateLoadBalancerAdvisor(accounts, summary) {
  const advisorEl = el('lake-advisor-text');
  if (!advisorEl) return;

  if (accounts.length === 0) {
    advisorEl.textContent = 'Zero nodes available. Ingestion blocked until at least 1 node is mounted.';
    return;
  }
  if (accounts.length === 1) {
    advisorEl.textContent = 'Single node mode. Connect 2 or more nodes to enable distributed chunk sharding.';
    return;
  }

  const freeSpaces = accounts.map((a) => a.spaceFree || 0);
  const maxFree = Math.max(...freeSpaces);
  const minFree = Math.min(...freeSpaces);
  if (maxFree - minFree > 2 * 1024 * 1024 * 1024) {
    advisorEl.textContent = 'Optimal sharding active. Automated bin-packing prioritizing node with largest free quota.';
  } else {
    advisorEl.textContent = 'Cluster capacity balanced across all mounted storage nodes.';
  }
}

function toggleNodeFilter(nodeLabel) {
  if (activeNodeFilter === nodeLabel) {
    activeNodeFilter = null;
  } else {
    activeNodeFilter = nodeLabel;
  }
  updateNodeFilterUI();
  renderFiles();
}

function updateNodeFilterUI() {
  const banner = el('active-node-banner');
  const labelText = el('active-node-label-text');
  const resetBtn = el('reset-node-filter-btn');

  if (activeNodeFilter) {
    banner.classList.remove('hidden');
    labelText.textContent = activeNodeFilter;
    if (resetBtn) resetBtn.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    if (resetBtn) resetBtn.classList.add('hidden');
  }

  document.querySelectorAll('.account-card').forEach((card) => {
    const label = card.querySelector('.acc-label')?.textContent;
    card.classList.toggle('active-filter', label === activeNodeFilter);
  });
}

el('clear-node-filter')?.addEventListener('click', () => {
  activeNodeFilter = null;
  updateNodeFilterUI();
  renderFiles();
});

el('reset-node-filter-btn')?.addEventListener('click', () => {
  activeNodeFilter = null;
  updateNodeFilterUI();
  renderFiles();
});

el('add-account-btn').addEventListener('click', () => el('add-account-modal').classList.remove('hidden'));
el('cancel-add-account').addEventListener('click', () => el('add-account-modal').classList.add('hidden'));

el('add-account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('add-account-error').classList.add('hidden');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Mounting Node…';
  const label = el('acc-label').value.trim();

  try {
    await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        label,
        email: el('acc-email').value.trim(),
        password: el('acc-password').value,
        secondFactorCode: el('acc-2fa').value.trim() || undefined,
      }),
    });
    el('add-account-form').reset();
    el('add-account-modal').classList.add('hidden');
    toast(`Node "${label}" mounted successfully.`, 'success');
    recordAuditLog('NODE', `Storage node mounted: ${label}`);
    loadAccounts();
  } catch (err) {
    el('add-account-error').textContent = err.message;
    el('add-account-error').classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Mount Storage Node';
  }
});

// ---------- Files Ingestion & Table / Grid Rendering ----------
const downloadIcon = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v8M8 10L5 7M8 10l3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.5"/></svg>';
const shareIcon = '<svg viewBox="0 0 16 16" fill="none"><circle cx="12" cy="4" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="8" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M5.4 7.2l5.2-2.4M5.4 8.8l5.2 2.4" stroke="currentColor" stroke-width="1.3"/></svg>';
const linkIcon = '<svg viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5l3-3M6 5H4.5A2.5 2.5 0 002 7.5v0A2.5 2.5 0 004.5 10H6M10 5h1.5A2.5 2.5 0 0114 7.5v0A2.5 2.5 0 0111.5 10H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>';
const trashIcon = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5V13h7V4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"/></svg>';
const inspectIcon = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.3"/></svg>';

function categorizeFile(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['csv', 'tsv', 'json', 'jsonl', 'parquet', 'avro', 'db', 'sqlite', 'sql'].includes(ext)) return 'dataset';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt'].includes(ext)) return 'document';
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'bin', 'iso', 'exe', 'dmg'].includes(ext)) return 'archive';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'mp4', 'mov', 'mp3', 'wav'].includes(ext)) return 'media';
  if (['js', 'ts', 'py', 'go', 'rs', 'c', 'cpp', 'html', 'css', 'yaml', 'yml'].includes(ext)) return 'code';
  return 'document';
}

async function loadFiles() {
  try {
    const data = await api('/api/files');
    cachedFiles = data.files || [];
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  updateCategoryCounts();
  renderFiles();
}

function updateCategoryCounts() {
  const counts = { all: cachedFiles.length, dataset: 0, document: 0, archive: 0, media: 0, code: 0 };
  cachedFiles.forEach((f) => {
    const cat = categorizeFile(f.name);
    if (counts[cat] !== undefined) counts[cat]++;
  });

  Object.keys(counts).forEach((cat) => {
    const countEl = el(`count-${cat}`);
    if (countEl) countEl.textContent = counts[cat];
  });

  // Scorecard updates
  if (el('stat-file-count')) el('stat-file-count').textContent = cachedFiles.length;
  const totalShards = cachedFiles.reduce((acc, f) => acc + (f.chunkCount || 1), 0);
  if (el('stat-shard-count')) el('stat-shard-count').textContent = `${totalShards} total sharded pieces`;
}

function getProcessedFiles() {
  let list = [...cachedFiles];

  // 1. Search filter
  if (currentSearchTerm) {
    const q = currentSearchTerm.toLowerCase();
    list = list.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      f.accounts.some((a) => a.toLowerCase().includes(q))
    );
  }

  // 2. Category filter
  if (currentCategoryFilter !== 'all') {
    list = list.filter((f) => categorizeFile(f.name) === currentCategoryFilter);
  }

  // 3. Node isolation filter
  if (activeNodeFilter) {
    list = list.filter((f) => f.accounts.includes(activeNodeFilter));
  }

  // 4. Sorting (Feature 3)
  list.sort((a, b) => {
    switch (currentSortKey) {
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'size-asc': return a.size - b.size;
      case 'size-desc': return b.size - a.size;
      case 'date-asc': return new Date(a.createdAt) - new Date(b.createdAt);
      case 'date-desc': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'shards-desc': return b.chunkCount - a.chunkCount;
      default: return 0;
    }
  });

  return list;
}

function renderFiles() {
  const files = getProcessedFiles();
  const hasFiles = files.length > 0;

  el('no-files-msg').classList.toggle('hidden', hasFiles);
  el('files-table-wrap').classList.toggle('hidden', !hasFiles || currentViewMode !== 'table');
  el('files-grid-wrap').classList.toggle('hidden', !hasFiles || currentViewMode !== 'grid');

  if (!hasFiles) return;

  if (currentViewMode === 'table') {
    renderTableView(files);
  } else {
    renderGridView(files);
  }
}

function renderTableView(files) {
  const tbody = el('files-tbody');
  tbody.innerHTML = '';

  files.forEach((f, i) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = `${Math.min(i, 8) * 20}ms`;
    tr.className = 'row-in';
    const spread = f.accounts.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join('');
    const shareBtn = f.share
      ? `<button data-id="${f.id}" class="share-btn link-btn icon-btn" title="Stream link active">${linkIcon}<span>Active</span></button>`
      : `<button data-id="${f.id}" class="share-btn secondary icon-btn" title="Create stream link">${shareIcon}<span>Share</span></button>`;
    
    tr.innerHTML = `
      <td class="file-name-cell" title="${escapeHtml(f.name)}">
        <span>${escapeHtml(f.name)}</span>
      </td>
      <td><strong>${formatBytes(f.size)}</strong></td>
      <td>
        ${spread}
        <button class="shard-inspect-btn" data-id="${f.id}">[${f.chunkCount} shards]</button>
      </td>
      <td>${new Date(f.createdAt).toLocaleDateString()} ${new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      <td class="actions">
        ${shareBtn}
        <button data-id="${f.id}" class="dl-btn secondary icon-btn" title="Download">${downloadIcon}<span>Stream</span></button>
        <button data-id="${f.id}" class="del-btn icon-btn" title="Delete">${trashIcon}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  attachFileActionListeners(tbody);
}

function renderGridView(files) {
  const grid = el('files-grid-wrap');
  grid.innerHTML = '';

  files.forEach((f) => {
    const card = document.createElement('div');
    card.className = 'file-grid-card';
    const spread = f.accounts.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join('');

    card.innerHTML = `
      <div class="file-grid-card-top">
        <div class="file-grid-icon">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" stroke="currentColor" stroke-width="1.4"/><path d="M6 5h4M6 8h4" stroke="currentColor" stroke-width="1.2"/></svg>
        </div>
        <div class="file-grid-details">
          <div class="file-grid-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="file-grid-meta">
            <span>${formatBytes(f.size)}</span>
            <span>&bull;</span>
            <span>${f.chunkCount} shard${f.chunkCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
      <div>
        <div style="margin-bottom: 4px; font-size: 10.5px; font-weight: 700; color: var(--muted);">NODES:</div>
        <div>${spread}</div>
      </div>
      <div class="file-grid-actions">
        <button data-id="${f.id}" class="shard-inspect-btn secondary" style="font-size: 11px;">Inspect Shards</button>
        <button data-id="${f.id}" class="share-btn secondary icon-btn" style="padding: 5px 8px;">${shareIcon}</button>
        <button data-id="${f.id}" class="dl-btn secondary icon-btn" style="padding: 5px 8px;">${downloadIcon}</button>
        <button data-id="${f.id}" class="del-btn icon-btn" style="padding: 5px 8px;">${trashIcon}</button>
      </div>
    `;
    grid.appendChild(card);
  });

  attachFileActionListeners(grid);
}

function attachFileActionListeners(container) {
  // Download / Stream
  container.querySelectorAll('.dl-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `${downloadIcon}<span>Streaming…</span>`;
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/files/${btn.dataset.id}/download`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        const filename = match ? decodeURIComponent(match[1]) : 'download';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        recordAuditLog('STREAM', `Downloaded object: ${filename}`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  });

  // Delete
  container.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = cachedFiles.find((f) => f.id === btn.dataset.id);
      const name = target ? target.name : 'this object';
      if (!confirm(`Delete "${name}" from SoTaNik_AI Data Lake? This removes all sharded pieces across nodes.`)) return;
      try {
        await api(`/api/files/${btn.dataset.id}`, { method: 'DELETE' });
        toast(`Object "${name}" deleted from lake.`, 'success');
        recordAuditLog('DELETE', `Removed object: ${name}`);
        loadFiles();
        loadAccounts();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Share
  container.querySelectorAll('.share-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = cachedFiles.find((file) => file.id === btn.dataset.id);
      openShareModal(btn.dataset.id, f);
    });
  });

  // Feature 5: Shard Inspector
  container.querySelectorAll('.shard-inspect-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = cachedFiles.find((file) => file.id === btn.dataset.id);
      if (f) openShardInspector(f);
    });
  });
}

// ---------- Feature 5: Shard Inspector Modal ----------
function openShardInspector(fileRecord) {
  el('inspector-file-name').textContent = fileRecord.name;
  el('inspector-file-id').textContent = fileRecord.id;

  const list = el('inspector-chunks-list');
  list.innerHTML = '';

  const chunksCount = fileRecord.chunkCount || 1;
  for (let i = 1; i <= chunksCount; i++) {
    const assignedNode = fileRecord.accounts[(i - 1) % fileRecord.accounts.length] || 'node-01';
    const item = document.createElement('div');
    item.className = 'shard-inspector-item';
    item.innerHTML = `
      <span><strong>Shard ${i} of ${chunksCount}</strong> &bull; Segment ${i}</span>
      <span class="chip">${escapeHtml(assignedNode)}</span>
    `;
    list.appendChild(item);
  }

  el('shard-inspector-modal').classList.remove('hidden');
}

el('close-inspector-modal').addEventListener('click', () => {
  el('shard-inspector-modal').classList.add('hidden');
});

// ---------- Feature 1: Live Search & Filters ----------
el('object-search-input')?.addEventListener('input', (e) => {
  currentSearchTerm = e.target.value.trim();
  renderFiles();
});

// Feature 2: Category Filter Pills
document.querySelectorAll('.filter-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    currentCategoryFilter = pill.dataset.filter;
    renderFiles();
  });
});

// Feature 3: Sort Selector
el('sort-select')?.addEventListener('change', (e) => {
  currentSortKey = e.target.value;
  renderFiles();
});

// Table Header Sorting Click
document.querySelectorAll('.files-table th[data-sort-key]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    if (key === 'name') currentSortKey = currentSortKey === 'name-asc' ? 'name-desc' : 'name-asc';
    else if (key === 'size') currentSortKey = currentSortKey === 'size-desc' ? 'size-asc' : 'size-desc';
    else if (key === 'date') currentSortKey = currentSortKey === 'date-desc' ? 'date-asc' : 'date-desc';
    else if (key === 'shards') currentSortKey = 'shards-desc';
    el('sort-select').value = currentSortKey;
    renderFiles();
  });
});

// Feature 4: View Mode Switcher
el('view-table-btn')?.addEventListener('click', () => {
  currentViewMode = 'table';
  el('view-table-btn').classList.add('active');
  el('view-grid-btn').classList.remove('active');
  renderFiles();
});

el('view-grid-btn')?.addEventListener('click', () => {
  currentViewMode = 'grid';
  el('view-grid-btn').classList.add('active');
  el('view-table-btn').classList.remove('active');
  renderFiles();
});

// Feature 8: Export Lake Manifest (JSON)
el('export-manifest-json')?.addEventListener('click', () => {
  const manifest = {
    exportedAt: new Date().toISOString(),
    totalObjects: cachedFiles.length,
    activeNodes: cachedAccounts.map((a) => ({ label: a.label, capacity: a.spaceTotal, used: a.spaceUsed })),
    objects: cachedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      sizeBytes: f.size,
      chunks: f.chunkCount,
      placedNodes: f.accounts,
      ingestedAt: f.createdAt,
    })),
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sotanik_lake_manifest_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Lake manifest JSON exported.', 'success');
  recordAuditLog('MANIFEST', 'Exported lake catalog manifest JSON');
});

// Feature 19: Keyboard Shortcuts Handler
window.addEventListener('keydown', (e) => {
  // If typing in input, don't hijack keys except Escape
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
    return;
  }
  if (isInput) return;

  if (e.key === '/') {
    e.preventDefault();
    el('object-search-input')?.focus();
  } else if (e.key === 'u' || e.key === 'U') {
    e.preventDefault();
    el('file-input')?.click();
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    el('add-account-modal')?.classList.remove('hidden');
  } else if (e.key === 'v' || e.key === 'V') {
    e.preventDefault();
    currentViewMode = currentViewMode === 'table' ? 'grid' : 'table';
    el('view-table-btn')?.classList.toggle('active', currentViewMode === 'table');
    el('view-grid-btn')?.classList.toggle('active', currentViewMode === 'grid');
    renderFiles();
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    toggleTheme();
  } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    el('shortcuts-modal')?.classList.remove('hidden');
  } else if (e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    toggleSidebar();
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    loadFiles();
    loadAccounts();
    loadApiKeys();
    toast('Data Lake refreshed.', 'info');
  }
});

el('theme-toggle-btn')?.addEventListener('click', toggleTheme);
el('shortcuts-modal-btn')?.addEventListener('click', () => el('shortcuts-modal')?.classList.remove('hidden'));
el('close-shortcuts-modal')?.addEventListener('click', () => el('shortcuts-modal')?.classList.add('hidden'));

// Feature 16: Vault Modal
el('vault-info-btn')?.addEventListener('click', () => el('vault-modal')?.classList.remove('hidden'));
el('close-vault-modal')?.addEventListener('click', () => el('vault-modal')?.classList.add('hidden'));

// Clear Activity Log
el('clear-activity-btn')?.addEventListener('click', () => {
  localStorage.removeItem(AUDIT_STORAGE_KEY);
  renderAuditLogs();
  toast('Audit activity log cleared.', 'info');
});

// ---------- Sharing Modal Logic ----------
let currentShareFileId = null;

function openShareModal(fileId, fileRecord) {
  currentShareFileId = fileId;
  el('share-modal-error').classList.add('hidden');
  el('share-modal').classList.remove('hidden');

  if (fileRecord && fileRecord.share) {
    showShareResult(fileRecord.share.url, fileRecord.share.expiresAt);
  } else {
    el('share-modal-create').classList.remove('hidden');
    el('share-modal-result').classList.add('hidden');
  }
}

function showShareResult(url, expiresAt) {
  el('share-modal-create').classList.add('hidden');
  el('share-modal-result').classList.remove('hidden');
  el('share-link-output').value = url;
  el('share-expiry-note').textContent = expiresAt
    ? `Expires ${new Date(expiresAt).toLocaleString()}`
    : 'Permanent token link (valid until revoked).';
}

function closeShareModal() {
  el('share-modal').classList.add('hidden');
  currentShareFileId = null;
}

el('cancel-share').addEventListener('click', closeShareModal);
el('close-share-modal').addEventListener('click', () => {
  closeShareModal();
  loadFiles();
});

el('create-share-btn').addEventListener('click', async () => {
  el('share-modal-error').classList.add('hidden');
  try {
    const { url, expiresAt } = await api(`/api/files/${currentShareFileId}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiry: el('share-expiry').value }),
    });
    showShareResult(url, expiresAt);
    recordAuditLog('SHARE', `Created public stream token for object ID ${currentShareFileId}`);
  } catch (err) {
    el('share-modal-error').textContent = err.message;
    el('share-modal-error').classList.remove('hidden');
  }
});

el('copy-share-link').addEventListener('click', async () => {
  const input = el('share-link-output');
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = el('copy-share-link');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = original), 1500);
  } catch {}
});

el('revoke-share-btn').addEventListener('click', async () => {
  if (!confirm('Revoke this access token? The stream link will deactivate immediately.')) return;
  try {
    await api(`/api/files/${currentShareFileId}/share`, { method: 'DELETE' });
    closeShareModal();
    loadFiles();
    recordAuditLog('SHARE', `Revoked stream token for object ID ${currentShareFileId}`);
    toast('Share link revoked.', 'info');
  } catch (err) {
    el('share-modal-error').textContent = err.message;
    el('share-modal-error').classList.remove('hidden');
  }
});

// ---------- Feature 13: Multi-file Batch Upload Queue ----------
async function processUploadQueue(filesList) {
  const wrap = el('upload-progress-wrap');
  const fill = el('upload-progress-fill');
  const text = el('upload-progress-text');
  wrap.classList.remove('hidden');

  const filesArray = Array.from(filesList);
  const total = filesArray.length;

  for (let i = 0; i < total; i++) {
    const file = filesArray[i];
    fill.classList.remove('indeterminate');
    fill.style.width = '0%';
    text.textContent = `[${i + 1}/${total}] Preparing ${file.name}…`;

    try {
      await uploadSingleFile(file, (pct, statusText) => {
        fill.style.width = `${pct}%`;
        fill.classList.remove('indeterminate');
        text.textContent = statusText || `[${i + 1}/${total}] Ingesting ${file.name}… ${pct}%`;
      });
      toast(`[${i + 1}/${total}] ${file.name} ingested successfully.`, 'success');
      recordAuditLog('INGEST', `Ingested: ${file.name} (${formatBytes(file.size)})`);
    } catch (err) {
      toast(`Upload failed for ${file.name}: ${err.message}`, 'error');
    }
  }

  wrap.classList.add('hidden');
  fill.classList.remove('indeterminate');
  loadFiles();
  loadAccounts();
}

async function uploadSingleFile(file, onProgress) {
  const token = await getAccessToken();
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

  // For small files (< 20MB), use single-shot upload
  if (file.size < 20 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct, `Uploading ${file.name}… ${pct}%`);
      });

      xhr.upload.addEventListener('load', () => {
        onProgress(100, `Committing ${file.name} to lake nodes…`);
      });

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || 'Upload rejected.'));
          } catch {
            reject(new Error('Upload rejected by lake server.'));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network connection error during transfer.'));
      xhr.send(formData);
    });
  }

  // For large files (20MB to 10GB+), use the resilient chunked ingestion pipeline:
  // Uploads in 100MB shards, eliminating Render 100s proxy timeouts and RAM exhaustion!
  const initRes = await fetch('/api/files/init', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to initialize upload session.');
  }

  const { uploadId, plan, totalChunks } = await initRes.json();
  let offset = 0;

  for (let partIdx = 1; partIdx <= totalChunks; partIdx++) {
    const part = plan[partIdx - 1];
    const chunkBlob = file.slice(offset, offset + part.size);
    offset += part.size;

    const basePct = Math.round(((partIdx - 1) / totalChunks) * 100);
    onProgress(basePct, `Uploading shard ${partIdx}/${totalChunks} to "${part.label}" (${basePct}%)…`);

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('partIndex', String(partIdx));
    formData.append('file', chunkBlob, `${file.name}.part${partIdx}`);

    const chunkRes = await fetch('/api/files/chunk', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    if (!chunkRes.ok) {
      const err = await chunkRes.json().catch(() => ({}));
      fetch(`/api/files/abort/${uploadId}`, { method: 'POST', headers: authHeaders }).catch(() => {});
      throw new Error(err.error || `Failed uploading shard ${partIdx} of ${file.name}`);
    }

    const currentPct = Math.round((partIdx / totalChunks) * 100);
    onProgress(currentPct, `Committed shard ${partIdx}/${totalChunks} to "${part.label}" (${currentPct}%)…`);
  }

  onProgress(100, `Assembling lake shards for ${file.name}…`);
  const finalizeRes = await fetch('/api/files/finalize', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });

  if (!finalizeRes.ok) {
    const err = await finalizeRes.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to finalize lake upload.');
  }

  return await finalizeRes.json();
}

el('file-input').addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    processUploadQueue(e.target.files);
  }
  e.target.value = '';
});

const dropzone = el('dropzone');
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    processUploadQueue(files);
  }
});

// ============================================================================
// Super-Admin Console (Exclusive for sagnik.saha.raptor@gmail.com)
// ============================================================================
let adminUsersCache = [];
let adminPublicNodesCache = [];
let currentWipeTarget = null;
let currentAllocateNodeId = null;
let adminInitialized = false;

function setupAdminConsole(userEmail) {
  const isAdmin = (userEmail || '').toLowerCase() === 'sagnik.saha.raptor@gmail.com';
  const toggleBtn = el('admin-panel-toggle-btn');
  const adminSection = el('admin-section');

  if (toggleBtn) {
    toggleBtn.classList.toggle('hidden', !isAdmin);
  }

  if (!isAdmin) {
    if (adminSection) adminSection.classList.add('hidden');
    return;
  }

  if (!adminInitialized) {
    initAdminEventListeners();
    adminInitialized = true;
  }

  // Preload admin data silently
  loadAdminData();
}

function initAdminEventListeners() {
  // Toggle Admin Section
  el('admin-panel-toggle-btn')?.addEventListener('click', () => {
    const adminSection = el('admin-section');
    if (!adminSection) return;
    const isNowOpen = adminSection.classList.toggle('hidden');
    if (!isNowOpen) {
      loadAdminData();
      adminSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // Admin Tab Navigation
  el('admin-tab-users')?.addEventListener('click', () => {
    el('admin-tab-users')?.classList.add('active');
    el('admin-tab-public')?.classList.remove('active');
    el('admin-users-view')?.classList.remove('hidden');
    el('admin-public-view')?.classList.add('hidden');
  });

  el('admin-tab-public')?.addEventListener('click', () => {
    el('admin-tab-public')?.classList.add('active');
    el('admin-tab-users')?.classList.remove('active');
    el('admin-public-view')?.classList.remove('hidden');
    el('admin-users-view')?.classList.add('hidden');
  });

  // Inactivity Heartbeat Trigger
  el('admin-run-heartbeat-btn')?.addEventListener('click', async () => {
    const btn = el('admin-run-heartbeat-btn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Sweeping Accounts…';
    try {
      const res = await api('/api/admin/heartbeat/run', { method: 'POST' });
      toast(`Cloud heartbeat complete: ${res.accountsActive || 0}/${res.accountsChecked || 0} accounts active.`, 'success');
      loadAdminHeartbeatStatus();
    } catch (err) {
      toast(`Heartbeat failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  // Mount Public Node Modal
  el('admin-mount-public-btn')?.addEventListener('click', () => {
    el('admin-mount-public-error')?.classList.add('hidden');
    el('admin-mount-public-modal')?.classList.remove('hidden');
  });
  el('cancel-mount-public')?.addEventListener('click', () => {
    el('admin-mount-public-modal')?.classList.add('hidden');
  });

  el('admin-mount-public-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = el('admin-mount-public-error');
    if (errEl) errEl.classList.add('hidden');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mounting Node…';
    }

    try {
      await api('/api/admin/public-nodes', {
        method: 'POST',
        body: JSON.stringify({
          label: el('pub-acc-label').value.trim(),
          email: el('pub-acc-email').value.trim(),
          password: el('pub-acc-password').value,
          notes: el('pub-acc-notes').value.trim(),
        }),
      });
      el('admin-mount-public-form').reset();
      el('admin-mount-public-modal')?.classList.add('hidden');
      toast('Public cloud storage node mounted successfully.', 'success');
      loadAdminPublicNodes();
      loadAdminHeartbeatStatus();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Mount Public Node';
      }
    }
  });

  // Wipe User & Cloud Files Modal
  el('cancel-wipe-btn')?.addEventListener('click', () => {
    el('admin-wipe-modal')?.classList.add('hidden');
    currentWipeTarget = null;
  });

  el('confirm-wipe-btn')?.addEventListener('click', async () => {
    if (!currentWipeTarget || !currentWipeTarget.userId) return;
    const btn = el('confirm-wipe-btn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Purging Cloud Shards & DB Records…';

    try {
      const res = await api(`/api/admin/users/${currentWipeTarget.userId}`, { method: 'DELETE' });
      toast(res.message || 'Tenant and cloud files completely wiped.', 'success');
      recordAuditLog('ADMIN_WIPE', `Wiped tenant ${currentWipeTarget.email} and all cloud shards`);
      el('admin-wipe-modal')?.classList.add('hidden');
      currentWipeTarget = null;
      loadAdminUsers();
      loadAdminPublicNodes();
    } catch (err) {
      toast(`Wipe failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // Allocate Modal
  el('cancel-allocate')?.addEventListener('click', () => {
    el('admin-allocate-modal')?.classList.add('hidden');
    currentAllocateNodeId = null;
  });

  el('confirm-allocate-btn')?.addEventListener('click', async () => {
    if (!currentAllocateNodeId) return;
    const select = el('allocate-user-select');
    const userId = select ? select.value : null;
    if (!userId) {
      toast('Please select a tenant.', 'error');
      return;
    }

    const btn = el('confirm-allocate-btn');
    btn.disabled = true;
    btn.textContent = 'Granting Allocation…';

    try {
      await api(`/api/admin/public-nodes/${currentAllocateNodeId}/allocate`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      toast('Public storage node allocated to tenant.', 'success');
      recordAuditLog('ADMIN_ALLOC', `Allocated public node to tenant ${userId}`);
      el('admin-allocate-modal')?.classList.add('hidden');
      currentAllocateNodeId = null;
      loadAdminPublicNodes();
      loadAdminUsers();
    } catch (err) {
      toast(`Allocation failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Grant Allocation';
    }
  });
}

async function loadAdminData() {
  loadAdminHeartbeatStatus();
  await Promise.all([loadAdminUsers(), loadAdminPublicNodes()]);
}

async function loadAdminHeartbeatStatus() {
  const statusEl = el('admin-heartbeat-status-text');
  if (!statusEl) return;
  try {
    const status = await api('/api/admin/heartbeat/status');
    if (!status || !status.lastRunAt) {
      statusEl.textContent = 'Liveness sweep initialized (Automated 24h cycle; Render anti-sleep active)';
    } else {
      const runDate = new Date(status.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusEl.textContent = `Last sweep at ${runDate}: ${status.accountsActive}/${status.accountsChecked} cloud accounts verified active (Protection Active)`;
    }
  } catch {
    statusEl.textContent = 'Cloud heartbeat online (24h automated rotation)';
  }
}

async function loadAdminUsers() {
  const tbody = el('admin-users-tbody');
  if (!tbody) return;
  try {
    const { users } = await api('/api/admin/users');
    adminUsersCache = users || [];
    renderAdminUsers(adminUsersCache);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="error text-center">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAdminUsers(users) {
  const countEl = el('admin-user-count');
  if (countEl) countEl.textContent = users.length;
  const tbody = el('admin-users-tbody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted text-center" style="padding: 24px;">No registered tenants found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((u) => {
    const isMaster = (u.email || '').toLowerCase() === 'sagnik.saha.raptor@gmail.com';
    const allocLabels = (u.allocatedPublicNodes || []).filter(Boolean);
    const allocHtml = allocLabels.length > 0
      ? allocLabels.map((lbl) => `<span class="admin-alloc-chip">${escapeHtml(lbl)}</span>`).join('')
      : '<span class="muted" style="font-size: 11px;">None</span>';

    return `
      <tr>
        <td>
          <div style="font-weight: 600;">${escapeHtml(u.email || 'Anonymous')}</div>
          ${u.emailConfirmed ? '<span class="verified-pill" style="font-size: 9.5px; padding: 1px 4px;">VERIFIED</span>' : ''}
          ${isMaster ? '<span class="admin-badge" style="margin-left: 4px;">SUPER-ADMIN</span>' : ''}
        </td>
        <td>
          <span style="font-family: \'JetBrains Mono\', monospace; font-size: 11px; color: var(--muted-strong);">${escapeHtml((u.id || '').substring(0, 10))}…</span>
        </td>
        <td>
          <strong>${u.fileCount || 0}</strong>
          <span class="muted" style="font-size: 11px;">(${formatBytes(u.totalBytes || 0)})</span>
        </td>
        <td>${u.personalNodes || 0} personal</td>
        <td>${allocHtml}</td>
        <td class="text-right">
          ${
            isMaster
              ? '<span class="muted" style="font-size: 11px; font-weight: 600;">Protected Master</span>'
              : `<button class="danger-btn wipe-tenant-btn" data-wipe-id="${escapeHtml(u.id)}" data-wipe-email="${escapeHtml(u.email)}">Wipe User &amp; Cloud Data</button>`
          }
        </td>
      </tr>
    `;
  }).join('');

  // Wire Wipe Buttons
  tbody.querySelectorAll('.wipe-tenant-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const userId = e.currentTarget.getAttribute('data-wipe-id');
      const userEmail = e.currentTarget.getAttribute('data-wipe-email');
      currentWipeTarget = { userId, email: userEmail };
      if (el('wipe-user-email')) el('wipe-user-email').textContent = userEmail;
      if (el('wipe-user-id')) el('wipe-user-id').textContent = userId;
      el('admin-wipe-modal')?.classList.remove('hidden');
    });
  });
}

async function loadAdminPublicNodes() {
  const container = el('admin-public-nodes-list');
  if (!container) return;
  try {
    const { nodes } = await api('/api/admin/public-nodes');
    adminPublicNodesCache = nodes || [];
    renderAdminPublicNodes(adminPublicNodesCache);
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminPublicNodes(nodes) {
  const countEl = el('admin-public-node-count');
  if (countEl) countEl.textContent = nodes.length;
  const container = el('admin-public-nodes-list');
  if (!container) return;

  if (nodes.length === 0) {
    container.innerHTML = '<div class="accounts-empty muted">No public cloud nodes configured. Click "Mount Public Cloud Node" above to add shared storage pools.</div>';
    return;
  }

  container.innerHTML = nodes.map((node) => {
    const allocUserIds = node.allocatedUserIds || [];
    let allocDisplay = '';
    if (allocUserIds.length === 0) {
      allocDisplay = '<div class="muted" style="font-size: 11px;">Not currently allocated to any tenant.</div>';
    } else {
      allocDisplay = allocUserIds.map((uid) => {
        const found = adminUsersCache.find((u) => u.id === uid);
        const label = found ? found.email : `${uid.substring(0, 8)}…`;
        return `
          <span class="admin-alloc-chip">
            <span>${escapeHtml(label)}</span>
            <button class="alloc-revoke-btn" data-revoke-node="${escapeHtml(node.id)}" data-revoke-user="${escapeHtml(uid)}" title="Revoke allocation">&times;</button>
          </span>
        `;
      }).join('');
    }

    return `
      <div class="account-card" style="cursor: default;">
        <div class="account-card-header">
          <div class="acc-label">${escapeHtml(node.label)}</div>
          <span class="node-status-badge" style="background: var(--accent-bronze-light); color: var(--accent-bronze); border-color: var(--accent-border);">PUBLIC POOL</span>
        </div>
        <div class="muted" style="font-size: 11.5px;">Credential: ${escapeHtml(node.email)}</div>
        ${node.notes ? `<div style="font-size: 11.5px; color: var(--muted-strong);">${escapeHtml(node.notes)}</div>` : ''}

        <div style="margin-top: 8px; border-top: 1px dashed var(--edge); padding-top: 8px;">
          <div style="font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; color: var(--muted-strong); margin-bottom: 4px;">ALLOCATED TENANTS:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${allocDisplay}
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="secondary btn-sm allocate-node-btn" data-node-id="${escapeHtml(node.id)}" data-node-label="${escapeHtml(node.label)}" style="font-size: 11.5px; padding: 4px 8px;">
            + Allocate to Tenant
          </button>
          <button class="ghost btn-sm unmount-node-btn" data-node-id="${escapeHtml(node.id)}" data-node-label="${escapeHtml(node.label)}" style="font-size: 11.5px; padding: 4px 8px; color: var(--danger);">
            Unmount
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire Allocate buttons
  container.querySelectorAll('.allocate-node-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const nodeId = e.currentTarget.getAttribute('data-node-id');
      const nodeLabel = e.currentTarget.getAttribute('data-node-label');
      currentAllocateNodeId = nodeId;
      if (el('allocate-node-label')) el('allocate-node-label').textContent = nodeLabel;

      // Populate user select
      const select = el('allocate-user-select');
      if (select) {
        select.innerHTML = adminUsersCache.map((u) => `
          <option value="${escapeHtml(u.id)}">${escapeHtml(u.email || u.id)}</option>
        `).join('');
      }
      el('admin-allocate-modal')?.classList.remove('hidden');
    });
  });

  // Wire Revoke buttons
  container.querySelectorAll('.alloc-revoke-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const nodeId = e.currentTarget.getAttribute('data-revoke-node');
      const userId = e.currentTarget.getAttribute('data-revoke-user');
      try {
        await api(`/api/admin/public-nodes/${nodeId}/allocate/${userId}`, { method: 'DELETE' });
        toast('Allocation revoked.', 'info');
        loadAdminPublicNodes();
        loadAdminUsers();
      } catch (err) {
        toast(`Revoke failed: ${err.message}`, 'error');
      }
    });
  });

  // Wire Unmount buttons
  container.querySelectorAll('.unmount-node-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const nodeId = e.currentTarget.getAttribute('data-node-id');
      const nodeLabel = e.currentTarget.getAttribute('data-node-label');
      if (!confirm(`Are you sure you want to unmount public storage node "${nodeLabel}"?`)) return;
      try {
        await api(`/api/admin/public-nodes/${nodeId}`, { method: 'DELETE' });
        toast(`Public node "${nodeLabel}" unmounted.`, 'info');
        loadAdminPublicNodes();
        loadAdminUsers();
      } catch (err) {
        toast(`Unmount failed: ${err.message}`, 'error');
      }
    });
  });
}

// ============================================================================
// Collapsible Sidebar Management
// ============================================================================
function initSidebar() {
  const saved = localStorage.getItem('sotanik_lake_sidebar') || 'open';
  const sidebar = el('app-sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed', saved === 'collapsed');
  }
}

function toggleSidebar() {
  const sidebar = el('app-sidebar');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('sotanik_lake_sidebar', isCollapsed ? 'collapsed' : 'open');
  toast(`Sidebar ${isCollapsed ? 'collapsed' : 'expanded'} [B]`, 'info');
}

el('sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);

// ============================================================================
// Programmatic API Keys Management (Scrapers & Scripts)
// ============================================================================
let cachedApiKeys = [];

async function loadApiKeys() {
  const container = el('api-keys-list');
  if (!container) return;
  try {
    const { keys } = await api('/api/keys');
    cachedApiKeys = keys || [];
    renderApiKeys(cachedApiKeys);
  } catch (err) {
    container.innerHTML = `<div class="error" style="font-size:10.5px;">${escapeHtml(err.message)}</div>`;
  }
}

function renderApiKeys(keys) {
  const container = el('api-keys-list');
  if (!container) return;

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="muted" style="font-size: 10.5px; padding: 4px 0;">
        No active API keys. Click "+ New Key" to create credentials for scrapers/scripts.
      </div>`;
    return;
  }

  container.innerHTML = keys.map((k) => `
    <div class="api-key-row">
      <div class="api-key-info">
        <span class="api-key-name">${escapeHtml(k.name || 'API Key')}</span>
        <span class="api-key-prefix">${escapeHtml(k.key_prefix)}</span>
      </div>
      <div class="api-key-actions">
        <button class="ghost btn-xs revoke-key-btn" data-key-id="${escapeHtml(k.id)}" title="Revoke Key" style="color: var(--danger); font-weight: 700; padding: 0 4px;">&times;</button>
      </div>
    </div>
  `).join('');

  // Wire Revoke Buttons
  container.querySelectorAll('.revoke-key-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const keyId = e.currentTarget.getAttribute('data-key-id');
      if (!confirm('Revoke this API key? External scrapers and automated scripts using this key will immediately lose access.')) {
        return;
      }
      try {
        await api(`/api/keys/${keyId}`, { method: 'DELETE' });
        toast('API key revoked immediately.', 'info');
        recordAuditLog('API_KEY', 'Revoked programmatic scraper API key');
        loadApiKeys();
      } catch (err) {
        toast(`Failed to revoke key: ${err.message}`, 'error');
      }
    });
  });
}

// Generate Key Modal Events
el('generate-key-btn')?.addEventListener('click', () => {
  el('api-key-prompt-form')?.reset();
  el('api-key-prompt-modal')?.classList.remove('hidden');
});

el('cancel-api-key-prompt')?.addEventListener('click', () => {
  el('api-key-prompt-modal')?.classList.add('hidden');
});

el('api-key-prompt-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = (el('api-key-name-input')?.value || '').trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating…';
  }

  try {
    const { key } = await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    el('api-key-prompt-modal')?.classList.add('hidden');
    el('api-key-prompt-form')?.reset();

    // Show generated key success modal
    if (el('generated-key-output')) {
      el('generated-key-output').value = key.secret;
    }
    if (el('curl-key-placeholder')) {
      el('curl-key-placeholder').textContent = key.secret;
    }
    el('api-key-created-modal')?.classList.remove('hidden');

    toast('API key created successfully!', 'success');
    recordAuditLog('API_KEY', `Created API key: ${key.name}`);
    loadApiKeys();
  } catch (err) {
    toast(`Failed to generate key: ${err.message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Key';
    }
  }
});

el('copy-generated-key-btn')?.addEventListener('click', async () => {
  const input = el('generated-key-output');
  if (!input) return;
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = el('copy-generated-key-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
    toast('API key copied to clipboard.', 'success');
  } catch {}
});

el('close-api-key-modal')?.addEventListener('click', () => {
  el('api-key-created-modal')?.classList.add('hidden');
});

// ---------- Boot Initializer ----------
init().catch((err) => {
  console.error('[boot] unexpected error:', err);
  showBootError(err.message || 'Fatal initialization error.');
});
