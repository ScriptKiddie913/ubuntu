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
      <div class="acc-email">${escapeHtml(acc.email)}</div>
      ${
        acc.status === 'error'
          ? `<div class="error">${escapeHtml(acc.error || 'connection error')}</div>`
          : `<div class="mini-bar"><div class="mini-bar-fill" style="width:${accPct}%"></div></div>
             <div class="muted">${formatBytes(acc.spaceUsed)} / ${formatBytes(acc.spaceTotal)}</div>`
      }
      <div class="acc-actions">
        <span></span>
        <button data-label="${escapeHtml(acc.label)}" class="remove-acc-btn">Remove</button>
      </div>
    `;
    list.appendChild(card);
  }
  list.querySelectorAll('.remove-acc-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove account "${btn.dataset.label}" from the pool?`)) return;
      try {
        await api(`/api/accounts/${encodeURIComponent(btn.dataset.label)}`, { method: 'DELETE' });
        loadAccounts();
      } catch (err) {
        alert(err.message);
      }
    });
  });
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
    tr.innerHTML = `
      <td>${escapeHtml(f.name)}</td>
      <td>${formatBytes(f.size)}</td>
      <td>${spread}${f.chunkCount > f.accounts.length ? `<span class="chip">${f.chunkCount} parts</span>` : ''}</td>
      <td>${new Date(f.createdAt).toLocaleString()}</td>
      <td class="actions">
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
}

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
