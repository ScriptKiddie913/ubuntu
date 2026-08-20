# MegaPool

A small self-hosted web app that pools several **MEGA.nz** accounts into one virtual drive
per user. Each person signs up with their own email/password, verifies their email, and
gets their own pool — point your account at 5 MEGA accounts (15GB each) and your dashboard
shows ~75GB combined; upload, download and delete without ever thinking about which
account a file actually lives on. Other signed-up users never see your accounts or files.

Built with Node.js + Express, plain HTML/CSS/JS (no build step), the unofficial
[`megajs`](https://github.com/qgustavor/mega) client library, and **Supabase** for
auth (email/password + email verification) and the metadata database.

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
  genuinely has to go (compromised, etc.), that's a manual row edit in Supabase's table
  editor plus re-uploading anything that had chunks there — deliberately not a one-click
  action.

## 1. Set up Supabase (auth + database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema**: open your project's **SQL Editor → New query**, paste the contents
   of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the
   `mega_accounts` and `pool_files` tables with Row Level Security locked to
   `auth.uid() = user_id` on every row — one user's data is invisible to another, enforced
   by the database itself, not just app logic.
3. **Turn on email verification**: go to **Authentication → Providers → Email** and
   enable **"Confirm email."** This is what makes new sign-ups actually receive a
   verification link and blocks sign-in until they click it (MegaPool's own backend also
   enforces this — see `src/middleware/requireAuth.js` — but the Supabase setting is what
   sends the email in the first place).
4. **Grab your keys**: go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / public key** → `SUPABASE_ANON_KEY` (safe to expose to the browser)
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only, never expose
     this** — it bypasses Row Level Security, which is why only the backend uses it)

## 2. Get the code running locally

```bash
npm install
cp .env.example .env
# edit .env: paste in your SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY,
# and generate a MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open `http://localhost:3000`, click **Create account**, sign up with an email + password,
check your inbox for the verification link, then sign in. Once in, click **+ Add MEGA
account** for each of your MEGA accounts (label, email, password, and a 2FA code if you
have two-factor enabled on that account) — they're saved to *your* account only. The
dashboard's combined bar updates as soon as accounts are connected.

## 3. Deploy to Render

This repo includes `render.yaml` (Render "Blueprint"). Push it to a GitHub repo, then in
Render: **New → Blueprint**, point it at the repo. You'll be prompted to paste in
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (`MASTER_KEY`
auto-generates).

**No persistent disk needed.** Accounts and files now live in Supabase Postgres, not on
local disk, so they already survive redeploys, restarts, and even deleting/recreating the
Render service — the data lives entirely in your Supabase project, independent of Render.
The only two things that would ever affect access to existing data are: deleting the
Supabase project itself, or changing `MASTER_KEY` (which decrypts stored MEGA passwords)
— don't change it once you have real accounts saved.

## 4. Security model

- **Auth**: sign-up/sign-in happen directly between the browser and Supabase Auth (via the
  anon key) — the backend never sees passwords. The browser then attaches the resulting
  Supabase JWT as `Authorization: Bearer <token>` on every API call; the backend verifies
  it fresh on each request (`src/middleware/requireAuth.js`) and rejects unverified emails.
- **Per-user isolation, two layers deep**: (1) the backend scopes every database query by
  the caller's verified user id, by hand; (2) the database itself also enforces this via
  Row Level Security policies (`supabase/schema.sql`), so even a direct query using the
  anon key can never return another user's rows. The `service_role` key (which does bypass
  RLS) never leaves the server.
- **MEGA credentials**: each connected MEGA account's password is AES-256-GCM encrypted
  (`src/crypto.js`) before it's stored in Supabase, keyed by `MASTER_KEY` — a second,
  independent secret. Someone with raw database access alone still can't read the
  plaintext MEGA passwords without also having `MASTER_KEY`.
- **No emails shown in the UI**: the dashboard's account cards show only the label and
  usage bar, never the underlying MEGA account email, even to the owning user.

## 5. A few things worth knowing

- **`megajs` is an unofficial, community-maintained client**, not MEGA's official SDK.
  It works well but can lag behind MEGA-side changes; keep it updated.
- **Rate limiting:** logging into several accounts and moving real traffic through MEGA's
  free tier can occasionally trip MEGA's abuse/rate-limit heuristics (temporary IP
  throttling, the odd captcha). This is more likely from a shared datacenter IP (like
  Render's) than from your home connection — if you hit it, retry after a bit.
- **Terms of service:** using multiple free accounts to add up storage beyond what MEGA
  intends for a single free account may run against MEGA's Terms of Service (most free
  cloud providers restrict this kind of pooling). Worth a read of MEGA's current ToS
  before relying on this for anything you can't afford to lose access to — consider MEGA
  Pro tiers if you want a service that officially supports the capacity you need.
- **Reliability:** this is a personal-project-grade tool, not a redundant/backed-up
  storage system — a file's pieces live on exactly one account each, with no
  replication. If an account gets suspended/locked, any file with a piece on it becomes
  unrecoverable. Don't use this as your only copy of anything important.

## Project layout

```
server.js                  Express app entry point
src/crypto.js               AES-256-GCM encrypt/decrypt for stored MEGA passwords
src/supabaseClient.js        Server-side Supabase client (service role) + public config
src/db.js                    Per-user Supabase data access (accounts + file/chunk index)
src/megaAccounts.js          MEGA login/session cache + quota lookups, per user
src/placement.js             Bin-packing: decides which account(s) a file's bytes go to
src/middleware/requireAuth.js  Verifies the caller's Supabase JWT on every API call
src/routes/auth.js           Public Supabase config + session-status check
src/routes/accounts.js       Add/list MEGA accounts (per signed-in user)
src/routes/files.js          Upload/list/download/delete/share files (per signed-in user)
src/routes/publicShare.js    Public, unauthenticated share-link downloads
public/                      Static dashboard (HTML/CSS/vanilla JS + supabase-js)
supabase/schema.sql          Tables + Row Level Security policies — run once in Supabase
render.yaml                  Render Blueprint (web service, no disk needed anymore)
```
