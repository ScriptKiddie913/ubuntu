const fmtBytes = (n) => {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

async function loadSummary() {
  const res = await fetch("/api/summary");
  const s = await res.json();
  document.getElementById("stat-summary").textContent =
    `${fmtBytes(s.used)} used / ${fmtBytes(s.total)} pooled across ${s.accounts} shard(s)`;
  document.getElementById("array-heading-sub").textContent =
    `${s.accounts} shards / ${fmtBytes(s.total)} total / ${fmtBytes(s.free)} free`;
}

async function loadAccounts() {
  const res = await fetch("/api/accounts");
  const accounts = await res.json();
  const grid = document.getElementById("account-grid");
  const bar = document.getElementById("array-bar");

  if (accounts.length === 0) {
    grid.innerHTML = `<div class="empty-hint">no accounts connected yet — click "add google account" above</div>`;
    bar.innerHTML = `<div class="array-segment"><div class="fill-free" style="width:100%"></div></div>`;
    return;
  }

  grid.innerHTML = accounts.map(a => {
    if (a.error) {
      return `
        <div class="account-card bad">
          <div class="acc-label">${a.label}</div>
          <div class="acc-email">${a.email || "unreachable"}</div>
          <div class="acc-nums">token expired / revoked</div>
        </div>`;
    }
    const pct = a.total ? Math.min(100, (a.used / a.total) * 100) : 0;
    return `
      <div class="account-card">
        <div class="acc-label">${a.label}</div>
        <div class="acc-email">${a.email || ""}</div>
        <div class="acc-bar"><div class="acc-bar-fill" style="width:${pct}%"></div></div>
        <div class="acc-nums"><span>${fmtBytes(a.used)}</span><span>${fmtBytes(a.total)}</span></div>
      </div>`;
  }).join("");

  const totalPool = accounts.reduce((sum, a) => sum + (a.total || 0), 0) || 1;
  bar.innerHTML = accounts.map(a => {
    const width = ((a.total || (totalPool / accounts.length)) / totalPool) * 100;
    if (a.error) {
      return `
        <div class="array-segment bad" style="width:${width}%">
          <div class="fill-used" style="width:100%"></div>
          <span class="array-segment-label">${a.label}</span>
        </div>`;
    }
    const usedPct = a.total ? (a.used / a.total) * 100 : 0;
    return `
      <div class="array-segment" style="width:${width}%">
        <div class="fill-free" style="width:100%"></div>
        <div class="fill-used" style="width:${usedPct}%"></div>
        <span class="array-segment-label">${a.label}</span>
      </div>`;
  }).join("");
}

async function loadFiles() {
  const res = await fetch("/api/files");
  const files = await res.json();
  const body = document.getElementById("file-table-body");
  document.getElementById("file-count-sub").textContent = `${files.length} file(s)`;

  if (files.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="empty-hint">no files uploaded yet</td></tr>`;
    return;
  }

  body.innerHTML = files.map(f => `
    <tr>
      <td>${f.filename}</td>
      <td>${fmtBytes(f.size)}</td>
      <td>${f.chunk_count}</td>
      <td class="status-${f.status}">${f.status}</td>
      <td>${fmtDate(f.created_at)}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn-download" onclick="downloadFile(${f.id}, '${f.filename.replace(/'/g, "\\'")}')">↓ get</button>
        <button class="btn-danger" onclick="deleteFile(${f.id})">delete</button>
      </td>
    </tr>
  `).join("");
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadAccounts(), loadFiles()]);
}

function downloadFile(id, filename) {
  const a = document.createElement("a");
  a.href = `/api/download/${id}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function deleteFile(id) {
  if (!confirm("Delete this file? This removes every shard it's split across.")) return;
  const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
  if (res.ok) {
    refreshAll();
  } else {
    alert("Delete failed — check server logs.");
  }
}

async function uploadFile(file) {
  const statusEl = document.getElementById("upload-status");
  statusEl.className = "upload-status";
  statusEl.textContent = `uploading ${file.name} (${fmtBytes(file.size)})…`;

  const form = new FormData();
  form.append("file", file);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "upload failed");
    statusEl.className = "upload-status ok";
    statusEl.textContent = `done: ${data.filename} → split across shards.`;
    refreshAll();
  } catch (e) {
    statusEl.className = "upload-status err";
    statusEl.textContent = `error: ${e.message}`;
  }
}

document.getElementById("btn-add-account").addEventListener("click", () => {
  const label = prompt("Short label for this Google account (e.g. acc1, work, personal):");
  if (!label) return;
  window.location.href = `/oauth/start?label=${encodeURIComponent(label.trim())}`;
});

const fileInput = document.getElementById("file-input");
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) uploadFile(e.target.files[0]);
  fileInput.value = "";
});

const dropzone = document.getElementById("dropzone");
["dragenter", "dragover"].forEach(evt =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); })
);
["dragleave", "drop"].forEach(evt =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag-over"); })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

refreshAll();
setInterval(refreshAll, 15000);
