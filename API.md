# MegaPool Database API — chunk access for external scanning

This documents the `/api/db/*` endpoints, specifically the ones meant for an
**external server** to pull raw data chunks and scan/index/search them itself,
instead of relying on MegaPool's own (basic) built-in keyword search.

Everything these endpoints serve — table data, the inverted index files, the
catalog — lives on MEGA. Nothing here reads from or depends on a Postgres
table; Supabase is only involved in verifying who's making the request (the
same auth used everywhere else in the app).

## Base URL

```
https://<your-megapool-deployment>
```

## Authentication

Every `/api/db/*` request requires:

```
Authorization: Bearer <supabase access token>
```

This is the same JWT the browser gets from Supabase Auth after sign-in. For a
script/server calling these endpoints (not a browser), sign in the same way
using [supabase-js](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
or a direct call to Supabase's auth API with a dedicated account's email/password:

```bash
curl -X POST 'https://YOUR-PROJECT-REF.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

The response's `access_token` is what you pass as the Bearer token below.
**It expires** (Supabase's default is 1 hour) — the response also includes a
`refresh_token`; use Supabase's token refresh endpoint to get a new
`access_token` without re-sending the password each time. A long-running
external scanner should refresh proactively rather than wait for a 401.

## Chunk sizing — the important part

Table data is stored as **segments**, not one giant object. Each segment is
capped at **`DB_SEGMENT_MAX_BYTES`, default 200MB** (set as an env var on the
MegaPool server — call `GET /api/db/tables/:name/segments` and read
`segmentMaxBytes` in the response rather than hardcoding 200MB, in case it's
been configured differently on the deployment you're talking to). The **last**
segment of a table is very likely smaller than the cap — always trust each
segment's own `dataBytes`, don't assume every segment is exactly the cap size.

Each segment's raw data is **newline-delimited JSON (NDJSON/JSONL)** — one JSON
object per line, one line per row. For a plain text-file import, each row
looks like `{"text": "<the original line>"}`. For rows inserted via the
manual insert endpoint, it's whatever object shape you inserted.

There is no byte-range/partial-download support — you always fetch a segment's
full content (up to the cap), not an arbitrary slice of it.

## Endpoints

### `GET /api/db/tables`
List your tables.

```json
{ "tables": [ { "name": "logs", "rowCount": 1204551, "segmentCount": 41, "totalBytes": 8218510223, "createdAt": "..." } ] }
```

### `GET /api/db/tables/:name/segments`
List a table's segments — this is your starting point for a scan: iterate this
list, then fetch each segment's data.

```json
{
  "segmentMaxBytes": 209715200,
  "segments": [
    { "index": 0, "rowCount": 30000, "dataBytes": 209715200, "createdAt": "..." },
    { "index": 1, "rowCount": 30000, "dataBytes": 209715200, "createdAt": "..." },
    { "index": 2, "rowCount": 4210,  "dataBytes": 29498112,  "createdAt": "..." }
  ]
}
```

### `GET /api/db/tables/:name/segments/:index/data`
Downloads segment `:index`'s raw NDJSON content (`application/x-ndjson`).
`Content-Length` and `X-Row-Count` headers are set so you know what to expect
before/while reading the body.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://your-deployment/api/db/tables/logs/segments/0/data" \
  -o segment-0.jsonl
```

### `GET /api/db/tables/:name/segments/:index/index`
Downloads segment `:index`'s prebuilt inverted index (`token -> [[byteOffset,
byteLength], ...]` into that same segment's data). Useful if you'd rather
reuse MegaPool's own tokenization than rebuild your own from scratch — the
offsets are byte offsets into the exact file `.../data` returns for that same
segment index.

### A full scan, end to end

```bash
TOKEN="..."           # from the auth step above
BASE="https://your-deployment"
TABLE="logs"

# 1. How many segments, how big is each?
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/db/tables/$TABLE/segments" \
  | jq -r '.segments[].index' | while read -r i; do
    # 2. Pull each one
    curl -s -H "Authorization: Bearer $TOKEN" \
      "$BASE/api/db/tables/$TABLE/segments/$i/data" -o "segment-$i.jsonl"
    # 3. Scan it however you like (grep, your own indexer, load into Elasticsearch, etc.)
    grep -l "needle" "segment-$i.jsonl"
  done
```

Segments are independent of each other — fine to fetch several in parallel if
your scanning server has the bandwidth for it.

## Other `/api/db` endpoints (not chunk-related, listed for completeness)

- `POST /api/db/tables` `{ "name": "logs" }` — create a table
- `DELETE /api/db/tables/:name` — delete a table and all its MEGA data
- `POST /api/db/tables/:name/rows` `{ "rows": [ {...}, {...} ] }` — insert a small batch of rows directly
- `POST /api/db/tables/:name/import` — multipart file upload (field name `file`), one row per line; starts a background job, returns `{ "jobId": "..." }` immediately (does not wait for the import to finish — large files can take a long time)
- `GET /api/db/import-jobs/:jobId` — poll an import job's status: `{ "status": "running"|"done"|"error", "rowsProcessed": N, "segmentsWritten": N, "error": null|"..." }`
- `GET /api/db/tables/:name/search?q=keyword&limit=50` — MegaPool's own basic built-in keyword search (exact/prefix token match), if you don't need to run your own external scan at all
