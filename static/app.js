(() => {
  const authScreen = document.getElementById("auth-screen");
  const app = document.getElementById("app");
  const tokenInput = document.getElementById("token-input");
  const tokenSubmit = document.getElementById("token-submit");
  const authError = document.getElementById("auth-error");
  const logoutBtn = document.getElementById("logout-btn");

  const connDot = document.getElementById("conn-dot");
  const connLabel = document.getElementById("conn-label");

  const fileList = document.getElementById("file-list");
  const newFileBtn = document.getElementById("new-file-btn");
  const uploadInput = document.getElementById("upload-input");

  const currentPathInput = document.getElementById("current-path");
  const editor = document.getElementById("editor");
  const saveBtn = document.getElementById("save-btn");
  const runBtn = document.getElementById("run-btn");
  const downloadBtn = document.getElementById("download-btn");
  const deleteBtn = document.getElementById("delete-btn");

  const editReqsBtn = document.getElementById("edit-reqs-btn");
  const installBtn = document.getElementById("install-btn");

  const shellInput = document.getElementById("shell-input");
  const shellRunBtn = document.getElementById("shell-run-btn");
  const killBtn = document.getElementById("kill-btn");

  const terminal = document.getElementById("terminal");

  let token = localStorage.getItem("pyrunner_token") || "";
  let ws = null;
  let currentFile = "main.py";
  let busy = false;

  function log(text) {
    terminal.textContent += text;
    terminal.scrollTop = terminal.scrollHeight;
  }
  function clearLog() { terminal.textContent = ""; }

  function setConn(state) {
    connDot.className = "dot " + (state === "on" ? "dot-on" : state === "busy" ? "dot-busy" : "dot-off");
    connLabel.textContent = state === "on" ? "connected" : state === "busy" ? "running..." : "disconnected";
  }

  function setBusy(b) {
    busy = b;
    setConn(b ? "busy" : (ws && ws.readyState === WebSocket.OPEN ? "on" : "off"));
    runBtn.disabled = b;
    installBtn.disabled = b;
    shellRunBtn.disabled = b;
  }

  // ---------------- auth ----------------

  async function tryToken(t) {
    const res = await fetch(`/api/token-check?token=${encodeURIComponent(t)}`);
    return res.ok;
  }

  async function boot() {
    if (token && await tryToken(token)) {
      authScreen.classList.add("hidden");
      app.classList.remove("hidden");
      connectWs();
      await refreshFiles();
      await loadFile("main.py");
    }
  }

  tokenSubmit.addEventListener("click", async () => {
    const t = tokenInput.value.trim();
    if (!t) return;
    authError.textContent = "checking...";
    if (await tryToken(t)) {
      token = t;
      localStorage.setItem("pyrunner_token", token);
      authError.textContent = "";
      authScreen.classList.add("hidden");
      app.classList.remove("hidden");
      connectWs();
      await refreshFiles();
      await loadFile("main.py");
    } else {
      authError.textContent = "invalid token";
    }
  });
  tokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tokenSubmit.click(); });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("pyrunner_token");
    location.reload();
  });

  // ---------------- websocket ----------------

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => setConn("on");
    ws.onclose = () => { setConn("off"); setTimeout(connectWs, 2000); };
    ws.onerror = () => setConn("off");
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "output") {
        log(msg.data);
      } else if (msg.type === "done") {
        log(`\n[exit code ${msg.code}${msg.elapsed ? ", " + msg.elapsed + "s" : ""}]\n`);
        setBusy(false);
      }
    };
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { log("[error] not connected\n"); return; }
    setBusy(true);
    ws.send(JSON.stringify(obj));
  }

  // ---------------- files ----------------

  async function refreshFiles() {
    const res = await fetch(`/api/files?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    fileList.innerHTML = "";
    data.files.forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f.path;
      if (f.path === currentFile) li.classList.add("active");
      li.addEventListener("click", () => loadFile(f.path));
      fileList.appendChild(li);
    });
  }

  async function loadFile(path) {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`);
    if (!res.ok) { editor.value = ""; return; }
    const data = await res.json();
    currentFile = path;
    currentPathInput.value = path;
    editor.value = data.content;
    [...fileList.children].forEach((li) => li.classList.toggle("active", li.textContent === path));
  }

  saveBtn.addEventListener("click", async () => {
    const path = currentPathInput.value.trim();
    if (!path) return;
    await fetch(`/api/file?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: editor.value }),
    });
    currentFile = path;
    log(`[saved ${path}]\n`);
    await refreshFiles();
  });

  newFileBtn.addEventListener("click", () => {
    const name = prompt("new file path (e.g. utils/helper.py)");
    if (!name) return;
    currentPathInput.value = name;
    editor.value = "";
    editor.focus();
  });

  deleteBtn.addEventListener("click", async () => {
    const path = currentPathInput.value.trim();
    if (!path || !confirm(`delete ${path}?`)) return;
    await fetch(`/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`, { method: "DELETE" });
    log(`[deleted ${path}]\n`);
    editor.value = "";
    await refreshFiles();
  });

  downloadBtn.addEventListener("click", () => {
    const path = currentPathInput.value.trim();
    if (!path) return;
    window.open(`/api/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`, "_blank");
  });

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`/api/upload?token=${encodeURIComponent(token)}&path=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: fd,
    });
    log(`[uploaded ${file.name}]\n`);
    await refreshFiles();
    uploadInput.value = "";
  });

  editReqsBtn.addEventListener("click", () => loadFile("requirements.txt"));

  // ---------------- run / install / shell ----------------

  runBtn.addEventListener("click", async () => {
    // auto-save current file before running
    const path = currentPathInput.value.trim();
    await fetch(`/api/file?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: editor.value }),
    });
    clearLog();
    send({ type: "run_python", file: path });
  });

  installBtn.addEventListener("click", () => {
    clearLog();
    send({ type: "install_requirements" });
  });

  shellRunBtn.addEventListener("click", () => {
    const cmd = shellInput.value.trim();
    if (!cmd) return;
    clearLog();
    send({ type: "shell", cmd });
    shellInput.value = "";
  });
  shellInput.addEventListener("keydown", (e) => { if (e.key === "Enter") shellRunBtn.click(); });

  killBtn.addEventListener("click", () => send({ type: "kill" }));

  // tab support in editor
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + "    " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
    }
  });

  boot();
})();
