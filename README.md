# pyrunner

A self-hosted, single-user "cloud IDE" you deploy to Render's **free** web
service tier. Gives you:

- **A real interactive terminal** — an actual `bash -l` login shell running
  in a pty on the container, rendered in-browser with `xterm.js`. Full
  readline, tab-completion, `Ctrl+C`, `vim`, `htop`, `cd` that persists,
  command history — it behaves like SSH'ing into a real Ubuntu box, because
  it is one. Open multiple terminal tabs at once.
- A dark, tactical file editor (file list, textarea editor, save/run/delete)
- A `requirements.txt` you edit and install into the instance on demand
- An **INSTALL DEPS** + **RUN** flow that streams `pip install` and script
  output live over a WebSocket, separate from the terminal
- Token-gated access (single shared token, not multi-tenant)

It is intentionally minimal: one FastAPI process, one workspace directory,
no database, no build step beyond `pip install`.

## Deploy to Render (free tier)

**Option A — Blueprint (recommended)**

1. Push this folder to a GitHub repo (e.g. under `ScriptKiddie913`).
2. In the Render dashboard: **New → Blueprint**, point it at the repo.
   Render reads `render.yaml` and provisions the service automatically,
   including a random `ACCESS_TOKEN`.
3. Once deployed, go to the service's **Environment** tab to see the
   generated `ACCESS_TOKEN` (or set your own).
4. Open the service URL, paste the token, and you're in.

**Option B — Manual**

1. New → Web Service → connect the repo.
2. Runtime: Python 3. Build command: `pip install -r requirements.txt`.
   Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
3. Plan: **Free**.
4. Add an environment variable `ACCESS_TOKEN` set to a strong random
   value (e.g. `openssl rand -hex 24`). If you skip this, the app
   generates one on boot and prints it to the Render logs — check
   **Logs** right after the first deploy.
5. Deploy.

## Local dev

```bash
pip install -r requirements.txt
export ACCESS_TOKEN=devtoken
uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000`, paste `devtoken`.

## How it works

**Terminal tab** — each tab you open makes a new `/ws/terminal` WebSocket
connection. The server calls `pty.fork()`, the child execs `bash -l` inside
`WORKSPACE_DIR`, and the parent bridges the pty file descriptor to the
WebSocket as raw bytes in both directions (keystrokes in, terminal output
out), including `SIGWINCH`-style resize via `TIOCSWINSZ` when you resize
the browser window. Closing the tab sends `SIGHUP` to the shell and cleans
up the fd — no orphaned processes. This is the same technique tools like
`ttyd`, `gotty`, and Jupyter's `terminado` use.

**Editor tab** — separate, simpler flow over `/ws`:
- Your code and `requirements.txt` live under `WORKSPACE_DIR`
  (default `/tmp/workspace`).
- **INSTALL DEPS** runs `pip install --target .pylibs -r requirements.txt`
  and streams the output.
- **RUN** executes `python -u <file>` with `PYTHONPATH=.pylibs`, so
  packages you just installed are importable immediately — no venv
  activation dance.
- Output streams back line-by-line via `asyncio.create_subprocess_exec`,
  so long-running scripts show live progress instead of a wall of text
  at the end.
- A per-process resource cap is applied via `resource.setrlimit` (CPU
  time, address space, open processes, max file size) as a best-effort
  guard rail on `RUN`/`INSTALL DEPS` jobs — Render's own container limits
  (512MB RAM on free) are the hard backstop. The interactive terminal is
  *not* resource-capped the same way, since you're driving it directly.
- Only one `RUN`/`INSTALL DEPS` job runs at a time (a global lock); the
  terminal tabs run independently of that lock and of each other.

## About `apt-get` / installing system packages

Render's free web service containers run as a **non-root** user at
runtime, so `sudo apt install` in the terminal won't work — this mirrors
a real locked-down Ubuntu box, not a bug. Two ways around it if you need
system-level packages:

1. **Language-level packages**: most things you'd reach for (numpy, torch,
   ffmpeg-python wrappers, etc.) install fine via `pip` in `requirements.txt`
   without needing `apt`.
2. **True system packages**: switch the Render service's runtime from
   Python to **Docker**, and write a `Dockerfile` that does `apt-get install`
   at *build* time (which does run as root, since it's building the image).
   Render still deploys it as a normal free web service — same `render.yaml`
   shape, just `runtime: docker` instead of `runtime: python` and a
   `dockerfilePath`. Ask if you want a Dockerfile variant of this project
   scaffolded out.

## Known limitations of Render's free tier (by design, not bugs)

- **Ephemeral disk.** `/tmp/workspace` is wiped on every redeploy and on
  restarts triggered by inactivity. Treat this as a scratch sandbox, not
  storage — download anything you want to keep via the DL button, or
  `git push` it out from the shell input.
- **Spins down after ~15 min idle**, then takes 30–60s to cold-start on
  the next request. Fine for personal/dev use, not for anything that
  needs to always be warm.
- **512MB RAM / shared CPU.** Heavy installs (torch, etc.) may OOM or
  time out — bump `INSTALL_TIMEOUT_SECONDS` if needed, but the RAM
  ceiling is Render's, not configurable on free.
- **No true sandboxing/isolation** beyond the container Render already
  gives you and the resource caps above — this is a personal tool
  gated by your token, not a multi-tenant playground. Don't publish
  the URL/token.

## Security notes

- Keep `ACCESS_TOKEN` secret — it's the only thing standing between the
  internet and arbitrary code execution on your instance.
- Rotate it any time by changing the env var in Render and redeploying.
- If you want IP allowlisting on top of the token, put it behind
  Render's paid static-IP/private-networking features, or a Cloudflare
  Access app in front of the service URL.

## File layout

```
main.py              FastAPI app: auth, file API, run/install websocket,
                      pty-backed terminal websocket
templates/index.html UI shell (terminal + editor tabs)
static/style.css     dark tactical styling
static/app.js        frontend logic: xterm.js terminal manager, file tree,
                      editor run/install websocket client
requirements.txt     deps for the runner service itself
render.yaml           Render Blueprint (one-click deploy config)
```
