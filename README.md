# MegaPool

A small self-hosted web app that pools several **MEGA.nz** accounts into one virtual drive.
Point it at your 5 accounts (15GB each) and the dashboard shows ~75GB combined — upload,
download and delete without ever thinking about which account a file actually lives on.

Built with Node.js + Express, plain HTML/CSS/JS (no build step), and the unofficial
[`megajs`](https://github.com/qgustavor/mega) client library.

## How it decides where files go

- Every file is placed on the account with the **most free space** first (best use of
  the pool, no needless splitting).
- If a file is bigger than any single account can hold — or bigger than `CHUNK_MAX_BYTES`
  — it's automatically **split across multiple accounts** and reassembled transparently
  on download. You never manage this by hand.
- `CHUNK_MAX_BYTES` (default 4GB) caps how big a single piece uploaded to one account can
  be, mostly to keep individual uploads more resumable/reliable over flaky connections.
  Raise it (e.g. to something close to your smallest account's size) if you'd rather have
  fewer, bigger, whole-file uploads and don't mind longer single transfers.
- Deleting a file removes every piece from every account it touched. **Accounts
  themselves can never be removed from the dashboard once added** — there's no delete
  endpoint or button, on purpose, since a file's chunks can land on any account at any
  time and a mid-flight removal risks silently orphaning pieces of files. If an account
  genuinely has to go (compromised, etc.), that's a manual `data/db.json` edit plus
  re-uploading anything that had chunks there — deliberately not a one-click action.

## 1. Get the code running locally

```bash
npm install
cp .env.example .env
# edit .env: set ADMIN_PASSWORD, and generate MASTER_KEY / SESSION_SECRET, e.g.:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open `http://localhost:3000`, log in with `ADMIN_PASSWORD`, then click **+ Add MEGA
account** for each of your 5 accounts (label, email, password, and a 2FA code if you
have two-factor enabled on that account). The dashboard's combined bar updates as soon
as accounts are connected.

## 2. Deploy to Render

This repo includes `render.yaml` (Render "Blueprint"). Push it to a GitHub repo, then in
Render: **New → Blueprint**, point it at the repo, and Render will provision the web
service for you. You'll be prompted to fill in `ADMIN_PASSWORD` (the others
auto-generate).

**Important — persistent storage:** the actual file *bytes* live on MEGA, but MegaPool
keeps a small local `data/db.json` file that maps "this logical file = these MEGA
account(s) + these node IDs." If that file is lost, your data is still on MEGA but the
app won't know how to find/reassemble it. `render.yaml` attaches a 1GB persistent disk
mounted at `data/` for exactly this reason — don't remove it, and note persistent disks
require a paid Render plan (the free tier's filesystem is wiped on every redeploy).

If you'd rather not pay for a disk, you can adapt `src/db.js` to write to any small
external store you already have (Render's own Postgres, Supabase, etc.) — the whole
metadata layer is isolated in that one file.

## 3. A few things worth knowing

- **`megajs` is an unofficial, community-maintained client**, not MEGA's official SDK.
  It works well but can lag behind MEGA-side changes; keep it updated.
- **Rate limiting:** logging into 5 accounts and moving real traffic through MEGA's free
  tier can occasionally trip MEGA's abuse/rate-limit heuristics (temporary IP throttling,
  the odd captcha). This is more likely from a shared datacenter IP (like Render's) than
  from your home connection — if you hit it, retry after a bit.
- **Terms of service:** using multiple free accounts to add up storage beyond what MEGA
  intends for a single free account may run against MEGA's Terms of Service (most free
  cloud providers restrict this kind of pooling). Worth a read of MEGA's current ToS
  before relying on this for anything you can't afford to lose access to — consider MEGA
  Pro tiers if you want a service that officially supports the capacity you need.
- **Reliability:** this is a personal-project-grade tool, not a redundant/backed-up
  storage system — a file's pieces live on exactly one account each, with no
  replication. If an account gets suspended/locked, any file with a piece on it becomes
  unrecoverable. Don't use this as your only copy of anything important.
- **Security:** account passwords are encrypted at rest (AES-256-GCM, keyed by
  `MASTER_KEY`) but the app can decrypt them any time it runs — treat `MASTER_KEY`,
  `ADMIN_PASSWORD`, and access to the server itself as sensitive.

## Project layout

```
server.js                 Express app entry point
src/crypto.js              AES-256-GCM encrypt/decrypt for stored MEGA passwords
src/db.js                  Tiny JSON-file metadata store (accounts + file/chunk index)
src/megaAccounts.js        MEGA login/session cache + quota lookups
src/placement.js           Bin-packing: decides which account(s) a file's bytes go to
src/middleware/requireAuth.js
src/routes/auth.js         Dashboard login/logout
src/routes/accounts.js     Add/list/remove MEGA accounts
src/routes/files.js        Upload/list/download/delete files
public/                    Static dashboard (HTML/CSS/vanilla JS)
render.yaml                Render Blueprint (web service + persistent disk)
```
