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

// ---------- Supabase client ----------

let supabaseClient = null;

async function initSupabase() {
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    throw new Error('Supabase client library failed to load (check your network/ad-blocker and reload).');
  }
  let res;
  try {
    res = await fetch('/api/auth/config');
  } catch (err) {
    throw new Error('Could not reach the MegaPool server. Is it running?');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Server rejected the configuration request.');
  }
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Server is missing SUPABASE_URL / SUPABASE_ANON_KEY — check its environment variables.');
  }
  // The anon key is safe to use in the browser — see supabase/schema.sql for the
  // RLS policies that actually enforce what it's allowed to touch.
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
}

async function getAccessToken() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

// ---------- API helper (attaches the current Supabase session token) ----------

async function api(path, options = {}) {
  const token = await getAccessToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Screens ----------

function switchScreen(id) {
  ['boot-screen', 'login-screen', 'app-screen'].forEach((s) => {
    const node = el(s);
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
  el('user-email-badge').textContent = (data && data.user && data.user.email) || '';
  loadAccounts();
  loadFiles();
}

function showBootError(message) {
  el('boot-status').classList.add('hidden');
  el('boot-error-message').textContent = message;
  el('boot-error').classList.remove('hidden');
}

async function init() {
  el('boot-error').classList.add('hidden');
  el('boot-status').classList.remove('hidden');
  switchScreen('boot-screen');

  try {
    await initSupabase();
  } catch (err) {
    showBootError(err.message || 'Something went wrong while starting up.');
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
    showBootError('Could not check your sign-in status. ' + (err.message || ''));
  }
}

el('boot-retry-btn').addEventListener('click', init);

// ---------- Auth: sign in / sign up tabs ----------

function showAuthTab(which) {
  const isSignin = which === 'signin';
  el('tab-signin').classList.toggle('active', isSignin);
  el('tab-signup').classList.toggle('active', !isSignin);
  el('signin-form').classList.toggle('hidden', !isSignin);
  el('signup-form').classList.toggle('hidden', isSignin);
  el('verify-notice').classList.add('hidden');
  if (isSignin) el('signin-form').classList.remove('hidden');
  else el('signup-form').classList.remove('hidden');
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
      ? 'Please verify your email first — check your inbox for the confirmation link.'
      : error.message;
    el('signin-error').classList.remove('hidden');
    return;
  }
  el('signin-password').value = '';
  // showApp() runs automatically via onAuthStateChange
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
  // If email confirmations are enabled (the default and the recommended setting —
  // see supabase/schema.sql / README), there's no active session yet: show the
  // "check your email" notice instead of the forms.
  if (!data.session) {
    el('signin-form').classList.add('hidden');
    el('signup-form').classList.add('hidden');
    el('verify-email-addr').textContent = email;
    el('verify-notice').classList.remove('hidden');
  }
});

el('verify-back-btn').addEventListener('click', () => showAuthTab('signin'));

el('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  showLogin();
});

// ---------- Accounts ----------

async function loadAccounts() {
  const summary = await api('/api/accounts');
  const pct = summary.spaceTotal ? Math.min(100, (summary.spaceUsed / summary.spaceTotal) * 100) : 0;
  el('pool-bar-fill').style.width = `${pct}%`;
  el('pool-summary-text').textContent = summary.spaceTotal
    ? `${formatBytes(summary.spaceUsed)} used of ${formatBytes(summary.spaceTotal)} combined (${summary.accounts.length} account${summary.accounts.length === 1 ? '' : 's'})`
    : 'No accounts connected yet.';

  const list = el('accounts-list');
  list.innerHTML = '';
  for (const acc of summary.accounts) {
    const card = document.createElement('div');
    card.className = 'account-card' + (acc.status === 'error' ? ' error' : '');
    const accPct = acc.spaceTotal ? Math.min(100, (acc.spaceUsed / acc.spaceTotal) * 100) : 0;
    card.innerHTML = `
      <div class="acc-label">${escapeHtml(acc.label)}</div>
      ${
        acc.status === 'error'
          ? `<div class="error">${escapeHtml(acc.error || 'connection error')}</div>`
          : `<div class="mini-bar"><div class="mini-bar-fill" style="width:${accPct}%"></div></div>
             <div class="muted">${formatBytes(acc.spaceUsed)} / ${formatBytes(acc.spaceTotal)}</div>`
      }
    `;
    list.appendChild(card);
  }
}

el('add-account-btn').addEventListener('click', () => el('add-account-modal').classList.remove('hidden'));
el('cancel-add-account').addEventListener('click', () => el('add-account-modal').classList.add('hidden'));

el('add-account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('add-account-error').classList.add('hidden');
  try {
    await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        label: el('acc-label').value.trim(),
        email: el('acc-email').value.trim(),
        password: el('acc-password').value,
        secondFactorCode: el('acc-2fa').value.trim() || undefined,
      }),
    });
    el('add-account-form').reset();
    el('add-account-modal').classList.add('hidden');
    loadAccounts();
  } catch (err) {
    el('add-account-error').textContent = err.message;
    el('add-account-error').classList.remove('hidden');
  }
});

// ---------- Files ----------

async function loadFiles() {
  const { files } = await api('/api/files');
  const tbody = el('files-tbody');
  tbody.innerHTML = '';
  el('no-files-msg').classList.toggle('hidden', files.length > 0);

  for (const f of files) {
    const tr = document.createElement('tr');
    const spread = f.accounts.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join('');
    const shareBtn = f.share
      ? `<button data-id="${f.id}" class="share-btn link-btn">Link ready</button>`
      : `<button data-id="${f.id}" class="share-btn secondary">Share</button>`;
    tr.innerHTML = `
      <td>${escapeHtml(f.name)}</td>
      <td>${formatBytes(f.size)}</td>
      <td>${spread}${f.chunkCount > f.accounts.length ? `<span class="chip">${f.chunkCount} parts</span>` : ''}</td>
      <td>${new Date(f.createdAt).toLocaleString()}</td>
      <td class="actions">
        ${shareBtn}
        <button data-id="${f.id}" class="dl-btn secondary">Download</button>
        <button data-id="${f.id}" class="del-btn">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.dl-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Downloads need the bearer token too, so we can't just navigate the browser
      // to the URL — fetch it as a blob (ok for reasonably sized files) instead.
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
      } catch (err) {
        alert(err.message);
      }
    });
  });
  tbody.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this file from the pool? This cannot be undone.')) return;
      try {
        await api(`/api/files/${btn.dataset.id}`, { method: 'DELETE' });
        loadFiles();
        loadAccounts();
      } catch (err) {
        alert(err.message);
      }
    });
  });
  tbody.querySelectorAll('.share-btn').forEach((btn) => {
    btn.addEventListener('click', () => openShareModal(btn.dataset.id, files.find((f) => f.id === btn.dataset.id)));
  });
}

// ---------- Sharing ----------

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
    : 'Never expires (until revoked).';
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
  } catch {
    // clipboard API may be blocked — the text is already selected for manual copy
  }
});

el('revoke-share-btn').addEventListener('click', async () => {
  if (!confirm('Revoke this share link? It will stop working immediately.')) return;
  try {
    await api(`/api/files/${currentShareFileId}/share`, { method: 'DELETE' });
    closeShareModal();
    loadFiles();
  } catch (err) {
    el('share-modal-error').textContent = err.message;
    el('share-modal-error').classList.remove('hidden');
  }
});

function uploadFile(file) {
  const wrap = el('upload-progress-wrap');
  const fill = el('upload-progress-fill');
  const text = el('upload-progress-text');
  wrap.classList.remove('hidden');
  fill.classList.remove('indeterminate');
  fill.style.width = '0%';
  text.textContent = `Uploading ${file.name}…`;

  getAccessToken().then((token) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = `${pct}%`;
      text.textContent = `Uploading ${file.name}… ${pct}%`;
    });
    xhr.upload.addEventListener('load', () => {
      // The browser has now finished sending the file, but the server still has
      // to relay it into MEGA before it can respond — that leg has no per-byte
      // progress we can show, so switch to an indeterminate state rather than
      // leaving the bar frozen at 100% (which looks identical to "stuck" on a
      // large file that can take several minutes to finish here).
      fill.style.width = '100%';
      fill.classList.add('indeterminate');
      text.textContent = `${file.name} received — moving it into MEGA now (this can take a few minutes for larger files)…`;
    });
    xhr.onload = () => {
      wrap.classList.add('hidden');
      fill.classList.remove('indeterminate');
      if (xhr.status >= 200 && xhr.status < 300) {
        loadFiles();
        loadAccounts();
      } else {
        try {
          alert(JSON.parse(xhr.responseText).error || 'Upload failed.');
        } catch {
          alert('Upload failed.');
        }
      }
    };
    xhr.onerror = () => {
      wrap.classList.add('hidden');
      fill.classList.remove('indeterminate');
      alert(
        'Upload failed due to a network error. If this was a large file, it may have hit a connection timeout ' +
          'partway through — try again on a faster/more stable connection.'
      );
    };
    xhr.send(formData);
  });
}

el('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
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
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

init().catch((err) => {
  console.error('[boot] unexpected failure:', err);
  showBootError(err.message || 'An unexpected error occurred while starting up.');
});
