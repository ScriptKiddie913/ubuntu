# SoTaNik_AI Data Lake

A powerful self-hosted web app that pools multiple storage accounts into one unified virtual data lake
per user. Each tenant signs up with their own email/password, verifies their email, and gets their own
isolated storage lake — connect multiple storage nodes and your dashboard shows their combined capacity;
upload, stream, download, and delete without ever thinking about which node an object actually lives on.
Other signed-up users never see your nodes or data objects.

Built with Node.js + Express, plain HTML/CSS/JS (no build step, enterprise light-mode UI), and **Supabase** for
auth (email/password + email verification) and metadata management.

## How it decides where files go

- Every file is placed on the node with the **most free space** first (optimal pool distribution, no needless splitting).
- If a file is bigger than any single node can hold — or bigger than `CHUNK_MAX_BYTES` — it's automatically
  **split across multiple nodes** and reassembled transparently on download. You never manage this by hand.
- `CHUNK_MAX_BYTES` (default 4GB) caps how big a single shard uploaded to one node can be, mostly to keep individual transfers resilient over network fluctuations.
- Deleting an object removes every piece from every node it touched. **Storage nodes themselves are permanent once connected** by design, since an object's shards can land on any node at any time and removing a node mid-flight risks silently orphaning shards.

## 1. Set up Supabase (auth + database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema**: open your project's **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the required tables with Row Level Security locked to `auth.uid() = user_id` on every row — one tenant's data is invisible to another, enforced by the database itself.
3. **Turn on email verification**: go to **Authentication → Providers → Email** and enable **"Confirm email."** This ensures new sign-ups receive a verification link before access.
4. **Grab your keys**: go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / public key** → `SUPABASE_ANON_KEY` (safe to expose to the browser)
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only, never expose this**)

## 2. Get the code running locally

```bash
npm install
cp .env.example .env
# edit .env: paste in your SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY,
# and generate a MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open `http://localhost:3000`, click **Create account**, sign up with an email + password, check your inbox for the verification link, then sign in. Once in, click **Connect Storage Node** to mount your storage accounts (label, email, password, and optional 2FA code) — they're saved to *your* tenant account only. The dashboard's combined capacity metrics update as soon as nodes are connected.

## 3. Deploy to Render

This repo includes `render.yaml` (Render "Blueprint"). Push it to a GitHub repo, then in Render: **New → Blueprint**, point it at the repo. You'll be prompted to paste in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (`MASTER_KEY` auto-generates).

**No persistent disk needed.** Accounts and metadata live in Supabase Postgres, not on local disk, so they survive redeploys and restarts. The data objects are stored across the connected storage nodes.

## 4. Security model

- **Auth**: sign-up/sign-in happen directly between the browser and Supabase Auth (via the anon key) — the backend never sees passwords. The browser attaches the resulting JWT as `Authorization: Bearer <token>` on every API call.
- **Per-user tenant isolation, two layers deep**: (1) the backend scopes every database query by the caller's verified user id; (2) the database itself enforces this via Row Level Security policies (`supabase/schema.sql`).
- **Node credentials**: each connected storage node's credentials are AES-256-GCM encrypted (`src/crypto.js`) before being stored, keyed by `MASTER_KEY`.
- **Privacy by design**: the dashboard's node cards show only the node identifier label and capacity metrics, never raw credentials.

## 5. Structured/searchable data lake engine

`/api/db/*` provides a lightweight structured-data store where the catalog, table rows, and search index live directly as objects on the storage lake — not in Postgres. Full endpoint documentation, chunk sizing, and scanning workflows are documented in **[API.md](./API.md)**.

## 6. Project layout

```
server.js                  Express app entry point
src/crypto.js               AES-256-GCM encrypt/decrypt for node credentials
src/supabaseClient.js        Server-side Supabase client (service role) + public config
src/db.js                    Per-user Supabase data access (nodes + file/chunk index)
src/megaAccounts.js          Storage node login/session cache + quota lookups, per user
src/placement.js             Bin-packing: decides which node(s) a file's bytes go to
src/keepAlive.js              Self-ping keep-alive
src/megaDb.js                 Structured data engine: catalog/rows/search index
src/importJobs.js             Background job tracker for large text-file imports
src/middleware/requireAuth.js  Verifies caller's Supabase JWT on every API call
src/routes/auth.js           Public Supabase config + session-status check
src/routes/accounts.js       Mount/list storage nodes (per signed-in tenant)
src/routes/files.js          Upload/list/download/delete/share objects (per signed-in tenant)
src/routes/publicShare.js    Public, unauthenticated share-link streaming
src/routes/db.js              /api/db/* — tables, search, and chunk access (see API.md)
public/                      Modern light-theme dashboard (HTML/CSS/vanilla JS + supabase-js)
supabase/schema.sql          Tables + Row Level Security policies
render.yaml                  Render Blueprint deployment spec
API.md                        /api/db/* endpoint docs
```
