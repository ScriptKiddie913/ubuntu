const el = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Auth ----------

async function init() {
  try {
    const { authenticated } = await api('/api/auth/status');
    if (authenticated) showApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  el('login-screen').classList.remove('hidden');
  el('app-screen').classList.add('hidden');
}

function showApp() {
  el('login-screen').classList.add('hidden');
  el('app-screen').classList.remove('hidden');
  loadAccounts();
  loadFiles();
}

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').classList.add('hidden');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: el('login-password').value }),
    });
    el('login-password').value = '';
    showApp();
  } catch (err) {
    el('login-error').textContent = err.message;
    el('login-error').classList.remove('hidden');
  }
});

el('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
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
    btn.addEventListener('click', () => {
      window.location.href = `/api/files/${btn.dataset.id}/download`;
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
  fill.style.width = '0%';
  text.textContent = `Uploading ${file.name}…`;

  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    fill.style.width = `${pct}%`;
    text.textContent = `Uploading ${file.name}… ${pct}%`;
  });
  xhr.onload = () => {
    wrap.classList.add('hidden');
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
    alert('Upload failed (network error).');
  };
  xhr.send(formData);
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

init();
