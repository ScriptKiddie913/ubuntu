(() => {
  const authScreen = document.getElementById("auth-screen");
  const app = document.getElementById("app");
  const tokenInput = document.getElementById("token-input");
  const tokenSubmit = document.getElementById("token-submit");
  const authError = document.getElementById("auth-error");
  const logoutBtn = document.getElementById("logout-btn");

  const connDot = document.getElementById("conn-dot");
  const connLabel = document.getElementById("conn-label");

  const tabTerminalBtn = document.getElementById("tab-terminal-btn");
  const tabEditorBtn = document.getElementById("tab-editor-btn");
  const viewTerminal = document.getElementById("view-terminal");
  const viewEditor = document.getElementById("view-editor");

  const termTabList = document.getElementById("term-tab-list");
  const termPanes = document.getElementById("term-panes");
  const newTermBtn = document.getElementById("new-term-btn");

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
  const killBtn = document.getElementById("kill-btn");

  const runOutput = document.getElementById("run-output");

  let token = localStorage.getItem("pyrunner_token") || "";
  let runWs = null;
  let currentFile = "main.py";

  function log(text) {
    runOutput.textContent += text;
    runOutput.scrollTop = runOutput.scrollHeight;
  }
  function clearLog() { runOutput.textContent = ""; }

  function setConn(state) {
    connDot.className = "dot " + (state === "on" ? "dot-on" : state === "busy" ? "dot-busy" : "dot-off");
    connLabel.textContent = state === "on" ? "connected" : state === "busy" ? "running..." : "disconnected";
  }

  // ---------------- view tab switching ----------------

  function showTerminalView() {
    viewTerminal.classList.remove("hidden");
    viewEditor.classList.add("hidden");
    tabTerminalBtn.classList.add("active");
    tabEditorBtn.classList.remove("active");
    const active = terminals.find((t) => t.id === activeTermId);
    if (active) { active.fitAddon.fit(); active.term.focus(); }
  }
  function showEditorView() {
    viewEditor.classList.remove("hidden");
    viewTerminal.classList.add("hidden");
    tabEditorBtn.classList.add("active");
    tabTerminalBtn.classList.remove("active");
  }
  tabTerminalBtn.addEventListener("click", showTerminalView);
  tabEditorBtn.addEventListener("click", showEditorView);

  // ---------------- auth ----------------

  async function tryToken(t) {
    const res = await fetch(`/api/token-check?token=${encodeURIComponent(t)}`);
    return res.ok;
  }

  async function boot() {
    if (token && await tryToken(token)) {
      enterApp();
    }
  }

  async function enterApp() {
    authScreen.classList.add("hidden");
    app.classList.remove("hidden");
    connectRunWs();
    await refreshFiles();
    await loadFile("main.py");
    openTerminal();
  }

  tokenSubmit.addEventListener("click", async () => {
    const t = tokenInput.value.trim();
    if (!t) return;
    authError.textContent = "checking...";
    if (await tryToken(t)) {
      token = t;
      localStorage.setItem("pyrunner_token", token);
      authError.textContent = "";
      enterApp();
    } else {
      authError.textContent = "invalid token";
    }
  });
  tokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tokenSubmit.click(); });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("pyrunner_token");
    location.reload();
  });

  // ---------------- run/install websocket (editor panel) ----------------

  function connectRunWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    runWs = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    runWs.onopen = () => setConn("on");
    runWs.onclose = () => { setConn("off"); setTimeout(connectRunWs, 2000); };
    runWs.onerror = () => setConn("off");
    runWs.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "output") {
        log(msg.data);
      } else if (msg.type === "done") {
        log(`\n[exit code ${msg.code}${msg.elapsed !== undefined ? ", " + msg.elapsed + "s" : ""}]\n`);
        setConn("on");
      }
    };
  }

  function sendRun(obj) {
    if (!runWs || runWs.readyState !== WebSocket.OPEN) { log("[error] not connected\n"); return; }
    setConn("busy");
    runWs.send(JSON.stringify(obj));
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
      li.addEventListener("click", () => { loadFile(f.path); showEditorView(); });
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
    showEditorView();
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

  editReqsBtn.addEventListener("click", () => { loadFile("requirements.txt"); showEditorView(); });

  runBtn.addEventListener("click", async () => {
    const path = currentPathInput.value.trim();
    await fetch(`/api/file?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: editor.value }),
    });
    clearLog();
    sendRun({ type: "run_python", file: path });
  });

  installBtn.addEventListener("click", () => {
    clearLog();
    sendRun({ type: "install_requirements" });
  });

  killBtn.addEventListener("click", () => sendRun({ type: "kill" }));

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + "    " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
    }
  });

  // ---------------- interactive terminal (xterm.js + pty over websocket) ----------------

  const terminals = []; // { id, term, fitAddon, ws, tabEl, paneEl }
  let activeTermId = null;
  let termCounter = 0;

  function openTerminal() {
    const id = ++termCounter;

    const tabEl = document.createElement("div");
    tabEl.className = "term-tab";
    tabEl.innerHTML = `<span class="term-tab-label">term ${id}</span><span class="term-tab-close">✕</span>`;
    tabEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("term-tab-close")) {
        closeTerminal(id);
      } else {
        activateTerminal(id);
      }
    });
    termTabList.appendChild(tabEl);

    const paneEl = document.createElement("div");
    paneEl.className = "term-pane";
    termPanes.appendChild(paneEl);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#000000",
        foreground: "#d8d8dc",
        cursor: "#00e08a",
        selectionBackground: "#2a2a2e",
      },
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(paneEl);

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      fitAddon.fit();
      sendResize();
    };
    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(evt.data));
      } else {
        term.write(evt.data);
      }
    };
    ws.onclose = () => term.write("\r\n\x1b[31m[terminal session ended]\x1b[0m\r\n");

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    function sendResize() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }
    term.onResize(sendResize);

    const entry = { id, term, fitAddon, ws, tabEl, paneEl };
    terminals.push(entry);
    activateTerminal(id);
  }

  function activateTerminal(id) {
    activeTermId = id;
    terminals.forEach((t) => {
      const isActive = t.id === id;
      t.tabEl.classList.toggle("active", isActive);
      t.paneEl.classList.toggle("active", isActive);
      if (isActive) {
        setTimeout(() => { t.fitAddon.fit(); t.term.focus(); }, 0);
      }
    });
  }

  function closeTerminal(id) {
    const idx = terminals.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const entry = terminals[idx];
    try { entry.ws.close(); } catch (e) {}
    entry.term.dispose();
    entry.tabEl.remove();
    entry.paneEl.remove();
    terminals.splice(idx, 1);
    if (terminals.length === 0) {
      openTerminal();
    } else if (activeTermId === id) {
      activateTerminal(terminals[terminals.length - 1].id);
    }
  }

  newTermBtn.addEventListener("click", openTerminal);

  window.addEventListener("resize", () => {
    const active = terminals.find((t) => t.id === activeTermId);
    if (active) active.fitAddon.fit();
  });

  boot();
})();
