# pyrunner

A self-hosted, single-user "cloud IDE" you deploy to Render's **free** web
service tier. Gives you:

- A dark, terminal-style web UI (file list, editor, output console)
- A `requirements.txt` you edit and install into the instance on demand
- A **RUN** button that executes the selected `.py` file and streams
  stdout/stderr live over a WebSocket
- A raw **shell** input for arbitrary commands in the same workspace
  (`ls`, `pip list`, `cat`, whatever) — basically a lightweight Ubuntu
  shell in a browser tab
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

## How execution works

- Your code and `requirements.txt` live under `WORKSPACE_DIR`
  (default `/tmp/workspace`).
- **INSTALL DEPS** runs `pip install --target .pylibs -r requirements.txt`
  inside the workspace and streams the output.
- **RUN** executes `python -u <file>` with `PYTHONPATH=.pylibs`, so
  packages you just installed are importable immediately — no venv
  activation dance.
- Both run through `asyncio.create_subprocess_exec`, with output piped
  back over the WebSocket line-by-line as it's produced, so long-running
  scripts (training loops, scrapers, etc.) show live progress instead of
  a wall of text at the end.
- A per-process resource cap is applied via `resource.setrlimit` (CPU
  time, address space, open processes, max file size) as a best-effort
  guard rail — Render's own container limits (512MB RAM on free) are the
  hard backstop.
- Only one job runs at a time (a global lock) since the free instance
  has a single small container behind it.

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
main.py              FastAPI app: auth, file API, websocket exec engine
templates/index.html UI shell
static/style.css     dark tactical styling
static/app.js         frontend logic (editor, file tree, websocket client)
requirements.txt     deps for the runner service itself
render.yaml           Render Blueprint (one-click deploy config)
```
