"""
render-pyrunner
----------------
A minimal, self-hosted "cloud IDE / sandbox" you deploy to Render's free tier.
Gives you a web UI to write Python files, manage a requirements.txt, install
dependencies, and run scripts (or raw shell commands) with output streamed
live over a WebSocket. Single global workspace, single-user, token-gated.

NOT a multi-tenant public sandbox. Keep ACCESS_TOKEN secret. Anyone with the
token can execute arbitrary code on the instance.
"""

import asyncio
import json
import os
import secrets
import shutil
import signal
import sys
import time
import uuid
from pathlib import Path

# POSIX-only, used for the interactive pty terminal. Render's runtime is Linux,
# so these are always available in production; guarded at call sites for
# local dev on non-POSIX platforms.
try:
    import pty
    import fcntl
    import termios
    import struct
    PTY_AVAILABLE = True
except ImportError:
    PTY_AVAILABLE = False

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
WORKSPACE = Path(os.environ.get("WORKSPACE_DIR", "/tmp/workspace")).resolve()
LIBS_DIR = WORKSPACE / ".pylibs"
WORKSPACE.mkdir(parents=True, exist_ok=True)
LIBS_DIR.mkdir(parents=True, exist_ok=True)

# Auto-generate a token if none is set, and print it loudly to the logs so
# the very first deploy is still usable. Always set ACCESS_TOKEN yourself
# in the Render dashboard for anything long-lived.
ACCESS_TOKEN = os.environ.get("ACCESS_TOKEN") or secrets.token_urlsafe(24)
if not os.environ.get("ACCESS_TOKEN"):
    print("=" * 70, file=sys.stderr)
    print(f"[render-pyrunner] NO ACCESS_TOKEN SET. Generated one for this run:", file=sys.stderr)
    print(f"[render-pyrunner] ACCESS_TOKEN = {ACCESS_TOKEN}", file=sys.stderr)
    print("[render-pyrunner] Set this as an env var in Render so it's stable across restarts.", file=sys.stderr)
    print("=" * 70, file=sys.stderr)

RUN_TIMEOUT = int(os.environ.get("RUN_TIMEOUT_SECONDS", "60"))
INSTALL_TIMEOUT = int(os.environ.get("INSTALL_TIMEOUT_SECONDS", "240"))
MAX_OUTPUT_CHARS = int(os.environ.get("MAX_OUTPUT_CHARS", "300000"))

# Ensure there's something to run on first boot
DEFAULT_MAIN = WORKSPACE / "main.py"
if not DEFAULT_MAIN.exists():
    DEFAULT_MAIN.write_text('print("hello from render-pyrunner")\n')
DEFAULT_REQS = WORKSPACE / "requirements.txt"
if not DEFAULT_REQS.exists():
    DEFAULT_REQS.write_text("# add your pip packages here, one per line\n")

app = FastAPI(title="render-pyrunner")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

exec_lock = asyncio.Lock()
current_proc: dict = {"proc": None}


# --------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------

def check_token(token: str):
    if not token or not secrets.compare_digest(token, ACCESS_TOKEN):
        raise HTTPException(status_code=401, detail="invalid or missing token")


# --------------------------------------------------------------------------
# Workspace / filesystem helpers
# --------------------------------------------------------------------------

def safe_path(rel_path: str) -> Path:
    """Resolve a user-supplied relative path inside WORKSPACE, blocking escape."""
    rel_path = rel_path.lstrip("/")
    p = (WORKSPACE / rel_path).resolve()
    if WORKSPACE not in p.parents and p != WORKSPACE:
        raise HTTPException(status_code=400, detail="path escapes workspace")
    return p


def list_tree(base: Path):
    items = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != ".pylibs"]
        for f in files:
            if f.startswith("."):
                continue
            full = Path(root) / f
            rel = full.relative_to(base)
            items.append({"path": str(rel), "size": full.stat().st_size})
    items.sort(key=lambda x: x["path"])
    return items


# --------------------------------------------------------------------------
# Routes: UI
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# --------------------------------------------------------------------------
# Routes: file management (REST)
# --------------------------------------------------------------------------

@app.get("/api/files")
async def api_list_files(token: str = Query(...)):
    check_token(token)
    return {"files": list_tree(WORKSPACE)}


@app.get("/api/file")
async def api_get_file(path: str, token: str = Query(...)):
    check_token(token)
    p = safe_path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        content = p.read_text(errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"could not read file: {e}")
    return {"path": path, "content": content}


@app.post("/api/file")
async def api_save_file(request: Request, token: str = Query(...)):
    check_token(token)
    body = await request.json()
    path = body.get("path")
    content = body.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="path required")
    p = safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return {"ok": True, "path": path}


@app.delete("/api/file")
async def api_delete_file(path: str, token: str = Query(...)):
    check_token(token)
    p = safe_path(path)
    if p.exists():
        p.unlink()
    return {"ok": True}


@app.post("/api/upload")
async def api_upload(token: str = Query(...), file: UploadFile = File(...), path: str = Query("")):
    check_token(token)
    target_name = path or file.filename
    p = safe_path(target_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"ok": True, "path": str(p.relative_to(WORKSPACE))}


@app.get("/api/download")
async def api_download(path: str, token: str = Query(...)):
    check_token(token)
    p = safe_path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(p), filename=p.name)


@app.get("/api/token-check")
async def api_token_check(token: str = Query(...)):
    check_token(token)
    return {"ok": True}


# --------------------------------------------------------------------------
# Execution engine (shared by websocket)
# --------------------------------------------------------------------------

def _limit_resources():
    """Best-effort resource caps applied to the child process (POSIX only)."""
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (RUN_TIMEOUT + 5, RUN_TIMEOUT + 10))
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
        resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024, 50 * 1024 * 1024))
    except Exception:
        pass


async def stream_process(ws: WebSocket, cmd: list, cwd: Path, env: dict, timeout: int, limit_res: bool = True):
    start = time.time()
    total_chars = 0
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            preexec_fn=_limit_resources if (limit_res and os.name == "posix") else None,
        )
    except FileNotFoundError as e:
        await ws.send_json({"type": "output", "data": f"[error] {e}\n"})
        await ws.send_json({"type": "done", "code": 127})
        return
    except Exception as e:
        await ws.send_json({"type": "output", "data": f"[error] failed to start process: {e}\n"})
        await ws.send_json({"type": "done", "code": 1})
        return

    current_proc["proc"] = proc

    async def pump():
        nonlocal total_chars
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode(errors="replace")
            total_chars += len(text)
            if total_chars > MAX_OUTPUT_CHARS:
                await ws.send_json({"type": "output", "data": "\n[output truncated — too much output]\n"})
                proc.kill()
                break
            await ws.send_json({"type": "output", "data": text})

    try:
        await asyncio.wait_for(pump(), timeout=timeout)
        code = await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
        try:
            code = await proc.wait()
        except Exception:
            code = -1
        elapsed = round(time.time() - start, 1)
        await ws.send_json({"type": "output", "data": f"\n[killed after {elapsed}s — timeout of {timeout}s exceeded]\n"})
    finally:
        current_proc["proc"] = None

    elapsed = round(time.time() - start, 1)
    await ws.send_json({"type": "done", "code": code, "elapsed": elapsed})


def _pip_env():
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = str(LIBS_DIR)
    return env


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    token = ws.query_params.get("token", "")
    if not token or not secrets.compare_digest(token, ACCESS_TOKEN):
        await ws.send_json({"type": "output", "data": "[error] invalid token\n"})
        await ws.close(code=4401)
        return

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")

            if mtype == "kill":
                proc = current_proc.get("proc")
                if proc and proc.returncode is None:
                    proc.kill()
                    await ws.send_json({"type": "output", "data": "\n[process killed by user]\n"})
                continue

            if exec_lock.locked():
                await ws.send_json({"type": "output", "data": "[busy] another job is already running, please wait\n"})
                continue

            async with exec_lock:
                if mtype == "install_requirements":
                    req_path = safe_path("requirements.txt")
                    if not req_path.exists() or not req_path.read_text().strip():
                        await ws.send_json({"type": "output", "data": "requirements.txt is empty, nothing to install\n"})
                        await ws.send_json({"type": "done", "code": 0})
                        continue
                    await ws.send_json({"type": "output", "data": f"$ pip install -r requirements.txt --target .pylibs\n"})
                    cmd = [sys.executable, "-m", "pip", "install", "--no-cache-dir",
                           "--target", str(LIBS_DIR), "-r", str(req_path)]
                    await stream_process(ws, cmd, WORKSPACE, _pip_env(), INSTALL_TIMEOUT, limit_res=False)

                elif mtype == "run_python":
                    file = msg.get("file", "main.py")
                    p = safe_path(file)
                    if not p.exists():
                        await ws.send_json({"type": "output", "data": f"[error] {file} not found\n"})
                        await ws.send_json({"type": "done", "code": 1})
                        continue
                    await ws.send_json({"type": "output", "data": f"$ python {file}\n"})
                    cmd = [sys.executable, "-u", str(p)]
                    await stream_process(ws, cmd, WORKSPACE, _pip_env(), RUN_TIMEOUT)

                elif mtype == "shell":
                    cmdline = msg.get("cmd", "")
                    if not cmdline.strip():
                        continue
                    await ws.send_json({"type": "output", "data": f"$ {cmdline}\n"})
                    # Run through a real shell so pipes/&&/wildcards behave as expected.
                    cmd = ["/bin/sh", "-c", cmdline]
                    await stream_process(ws, cmd, WORKSPACE, _pip_env(), RUN_TIMEOUT)

                else:
                    await ws.send_json({"type": "output", "data": f"[error] unknown message type: {mtype}\n"})

    except WebSocketDisconnect:
        pass


# --------------------------------------------------------------------------
# Interactive terminal (real pty-backed bash) — the "Ubuntu type OS" bit.
# Each browser tab that opens a terminal gets its own /ws/terminal
# connection, which forks a real bash login shell attached to a pty.
# Full readline, tab-completion, job control, vim/htop/etc all work because
# it IS a real shell, not a one-shot subprocess.
# --------------------------------------------------------------------------

@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket):
    await ws.accept()
    token = ws.query_params.get("token", "")
    if not token or not secrets.compare_digest(token, ACCESS_TOKEN):
        await ws.close(code=4401)
        return

    if not PTY_AVAILABLE:
        await ws.send_text("[error] interactive terminal requires a POSIX host (Linux/macOS). Render's runtime is fine; local Windows dev is not.\r\n")
        await ws.close()
        return

    shell = shutil.which("bash") or shutil.which("sh") or "/bin/sh"

    pid, fd = pty.fork()
    if pid == 0:
        # ---- child process: becomes the shell ----
        try:
            os.chdir(str(WORKSPACE))
        except Exception:
            pass
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["PYTHONPATH"] = str(LIBS_DIR)
        env.setdefault("PS1", r"\u@pyrunner:\w\$ ")
        try:
            os.execvpe(shell, [shell, "-l"], env)
        finally:
            os._exit(1)

    # ---- parent process: bridge the pty fd <-> websocket ----
    loop = asyncio.get_event_loop()
    out_queue: asyncio.Queue = asyncio.Queue()

    def _on_readable():
        try:
            data = os.read(fd, 4096)
        except OSError:
            data = b""
        if data:
            out_queue.put_nowait(data)
        else:
            try:
                loop.remove_reader(fd)
            except Exception:
                pass
            out_queue.put_nowait(None)

    loop.add_reader(fd, _on_readable)

    async def writer_task():
        while True:
            chunk = await out_queue.get()
            if chunk is None:
                break
            try:
                await ws.send_bytes(chunk)
            except Exception:
                break

    wtask = asyncio.create_task(writer_task())

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            text = msg.get("text")
            if text is not None:
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                ptype = payload.get("type")
                if ptype == "input":
                    data = payload.get("data", "")
                    try:
                        os.write(fd, data.encode("utf-8", errors="ignore"))
                    except OSError:
                        break
                elif ptype == "resize":
                    try:
                        cols = int(payload.get("cols", 80))
                        rows = int(payload.get("rows", 24))
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                    except Exception:
                        pass
            raw = msg.get("bytes")
            if raw is not None:
                try:
                    os.write(fd, raw)
                except OSError:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            loop.remove_reader(fd)
        except Exception:
            pass
        wtask.cancel()
        try:
            os.kill(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
