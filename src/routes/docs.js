// ============================================================================
// SoTaNik_AI Data Lake — Interactive & Machine-Readable API Documentation
// Exposes /docs, /docs/openapi.json, /docs/llms.txt, and /docs/markdown
// Optimized for human developers and scraping by AI agents & LLMs.
// ============================================================================

const express = require('express');
const router = express.Router();

// OpenAPI 3.0 Specification for AI Agents & Automated Tool-Calling
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SoTaNik_AI Data Lake REST API',
    version: '2.4.0',
    description: 'Autonomous distributed data lake storage aggregator with encrypted sharding, chunk streaming, and programmatic scraping capabilities.',
    contact: {
      name: 'SoTaNik_AI Engineering',
      email: 'sagnik.saha.raptor@gmail.com',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Active Lake Instance',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Persistent programmatic API key for external scrapers and scripts (format: sot_live_...)',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT or API Key',
        description: 'Supabase JWT Bearer token or sot_live_... API key',
      },
    },
    schemas: {
      FileObject: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique cryptographic object ID' },
          name: { type: 'string', description: 'Filename including extension' },
          size: { type: 'integer', description: 'File size in bytes' },
          createdAt: { type: 'string', format: 'date-time' },
          chunks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                accountLabel: { type: 'string' },
                nodeId: { type: 'string' },
                index: { type: 'integer' },
                size: { type: 'integer' },
              },
            },
          },
          share: {
            type: 'object',
            nullable: true,
            properties: {
              url: { type: 'string' },
              expiresAt: { type: 'string', nullable: true },
            },
          },
        },
      },
      StorageSummary: {
        type: 'object',
        properties: {
          spaceTotal: { type: 'integer' },
          spaceUsed: { type: 'integer' },
          spaceFree: { type: 'integer' },
          accounts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                email: { type: 'string' },
                status: { type: 'string', enum: ['ok', 'error'] },
                spaceTotal: { type: 'integer' },
                spaceUsed: { type: 'integer' },
              },
            },
          },
        },
      },
      ApiKeyRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          keyPrefix: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  security: [
    { ApiKeyAuth: [] },
    { BearerAuth: [] },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Cluster Health & Liveness',
        description: 'Lightweight health endpoint for uptime pingers and Render keep-alive.',
        security: [],
        responses: {
          '200': {
            description: 'Cluster healthy',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, time: { type: 'string' } } } } },
          },
        },
      },
    },
    '/api/files': {
      get: {
        summary: 'List Ingested Objects',
        description: 'Scrapes and lists all data lake objects belonging to the authenticated tenant. Supports query filtering.',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search term' },
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Category filter (dataset, document, archive, media, code)' },
          { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Sorting order (date-desc, date-asc, size-desc, name-asc)' },
          { name: 'node', in: 'query', schema: { type: 'string' }, description: 'Filter files on a specific storage node' },
        ],
        responses: {
          '200': {
            description: 'List of files',
            content: { 'application/json': { schema: { type: 'object', properties: { files: { type: 'array', items: { $ref: '#/components/schemas/FileObject' } } } } } },
          },
        },
      },
      post: {
        summary: 'Ingest File (Auto-Sharding)',
        description: 'Uploads and shards a file across mounted storage nodes automatically.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'File uploaded and sharded successfully' },
        },
      },
    },
    '/api/files/{id}': {
      get: {
        summary: 'Get File Metadata & Shard Map',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/FileObject' } } } },
        },
      },
      delete: {
        summary: 'Delete File & Shard Chunks',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Object and physical chunks deleted' },
        },
      },
    },
    '/api/files/{id}/download': {
      get: {
        summary: 'Stream Download File (Assembled Chunks)',
        description: 'Downloads and streams the assembled file bytes on the fly. Ideal for external scraping bots.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Binary file stream',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
    '/api/files/{id}/share': {
      post: {
        summary: 'Create Public Stream Token URL',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { expiry: { type: 'string', enum: ['never', '1h', '1d', '7d', '30d'] } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Generated public link' },
        },
      },
      delete: {
        summary: 'Revoke Public Stream Token',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Share link revoked' } },
      },
    },
    '/share/{token}': {
      get: {
        summary: 'Public Stream Download Link',
        description: 'Unauthenticated streaming endpoint accessible via signed token.',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        },
      },
    },
    '/api/accounts': {
      get: {
        summary: 'Storage Nodes Topology & Quota',
        description: 'Returns total pooled capacity, free space, and status of all mounted storage nodes.',
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/StorageSummary' } } } },
        },
      },
      post: {
        summary: 'Mount Storage Node',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['label', 'email', 'password'],
                properties: {
                  label: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  secondFactorCode: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Node mounted and quota pooled' },
        },
      },
    },
    '/api/keys': {
      get: {
        summary: 'List API Keys',
        description: 'Lists all active programmatic scraping keys for the tenant.',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { keys: { type: 'array', items: { $ref: '#/components/schemas/ApiKeyRecord' } } } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Generate Programmatic API Key',
        description: 'Generates a new API key (sot_live_...). Plaintext secret is returned once.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string', description: 'Label for the key' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Key generated' },
        },
      },
    },
    '/api/keys/{id}': {
      delete: {
        summary: 'Revoke API Key',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Key revoked immediately' } },
      },
    },
    '/api/db/tables': {
      get: {
        summary: 'List Big Data Tables',
        responses: { '200': { description: 'List of tables' } },
      },
    },
    '/api/db/tables/{name}/segments': {
      get: {
        summary: 'List Table Chunks / Segments',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'List of segments' } },
      },
    },
    '/api/db/tables/{name}/segments/{index}/data': {
      get: {
        summary: 'Fetch Raw NDJSON Segment Data',
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'index', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Newline-delimited JSON stream',
            content: { 'application/x-ndjson': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/db/tables/{name}/search': {
      get: {
        summary: 'Keyword Search on Lake Table',
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Matching rows' } },
      },
    },
  },
};

// Markdown Document for Scrapers & LLM Agents
const llmMarkdownGuide = `# SoTaNik_AI Data Lake — AI Agent & Developer API Guide

> **Base URL**: \`/\`  
> **OpenAPI Specification**: \`/docs/openapi.json\`  
> **LLMs Context Specification**: \`/llms.txt\`

SoTaNik_AI Data Lake aggregates distributed cloud storage nodes into a unified, cryptographically encrypted virtual drive. Files exceeding chunk thresholds are sharded across nodes automatically and reassembled seamlessly during download streaming.

---

## 1. Authentication for AI Agents & Scrapers

Pass your programmatic API key (generated in the console sidebar or via \`POST /api/keys\`) using either of the following HTTP headers:

\`\`\`http
X-API-Key: sot_live_abcdef123456...
\`\`\`

or

\`\`\`http
Authorization: Bearer sot_live_abcdef123456...
\`\`\`

---

## 2. Core API Endpoints for AI Scrapers

### A. List Data Lake Files
\`GET /api/files\`  
Headers: \`X-API-Key: <key>\`  
Query parameters:
- \`q\`: Search keyword
- \`category\`: Filter by \`dataset\`, \`document\`, \`archive\`, \`media\`, \`code\`
- \`sort\`: \`date-desc\`, \`date-asc\`, \`size-desc\`, \`name-asc\`
- \`node\`: Filter objects hosted on a specific node label

Example cURL:
\`\`\`bash
curl -s -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files"
\`\`\`

### B. Stream / Download Assembled File
\`GET /api/files/:id/download\`  
Headers: \`X-API-Key: <key>\`  
Description: Assembles sharded pieces from nodes on the fly and streams raw file bytes directly to the caller.

Example cURL:
\`\`\`bash
curl -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files/FILE_ID/download" -o output.bin
\`\`\`

### C. Ingest New File (Auto-Sharded)
\`POST /api/files\`  
Headers: \`X-API-Key: <key>\`  
Content-Type: \`multipart/form-data\` (form field \`file\`)

Example cURL:
\`\`\`bash
curl -X POST -H "X-API-Key: sot_live_..." -F "file=@./dataset.parquet" "https://YOUR_DOMAIN/api/files"
\`\`\`

### D. Inspect File Shards
\`GET /api/files/:id\`  
Headers: \`X-API-Key: <key>\`  
Returns cryptographic file metadata, chunk counts, and storage node shard mapping.

### E. Storage Topology & Capacity Metrics
\`GET /api/accounts\`  
Headers: \`X-API-Key: <key>\`  
Returns cluster pooled capacity, free space, and list of mounted storage nodes.

### F. Big Data NDJSON Table Segments
- \`GET /api/db/tables\`: List table collections
- \`GET /api/db/tables/:name/segments\`: List 200MB chunk segments
- \`GET /api/db/tables/:name/segments/:index/data\`: Stream raw NDJSON rows
- \`GET /api/db/tables/:name/search?q=keyword\`: Query indexed tokens

### G. Public Share Link Streaming
\`GET /share/:token\`  
Unauthenticated stream download link for publicly shared objects.

---

## 3. OpenAPI 3.0 Manifest
AI agents supporting automated tool-calling or LangChain can load the full JSON specification directly:
\`\`\`
GET /docs/openapi.json
\`\`\`
`;

// ---------------- Route Handlers ----------------

// Machine-readable OpenAPI spec JSON
router.get('/openapi.json', (req, res) => {
  res.json(openApiSpec);
});
router.get('/api.json', (req, res) => {
  res.json(openApiSpec);
});

// Machine-readable llms.txt standard
router.get('/llms.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(llmMarkdownGuide);
});

// Raw markdown endpoint
router.get('/markdown', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(llmMarkdownGuide);
});
router.get('/docs.md', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(llmMarkdownGuide);
});

// Main /docs route: Content negotiation for HTML, JSON, and Markdown
router.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  const format = (req.query.format || '').toLowerCase();

  if (format === 'json' || (accept.includes('application/json') && !accept.includes('text/html'))) {
    return res.json(openApiSpec);
  }

  if (format === 'md' || format === 'markdown' || accept.includes('text/markdown')) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(llmMarkdownGuide);
  }

  // Render high-density, beautiful interactive HTML docs
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SoTaNik_AI Data Lake — API &amp; Agent Documentation</title>
  <link rel="icon" type="image/png" href="/logo.png" />
  <link rel="shortcut icon" type="image/png" href="/logo.png" />
  <link rel="apple-touch-icon" href="/logo.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    .docs-container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 30px 20px;
    }
    .docs-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--edge);
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .docs-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .docs-logo {
      width: 32px;
      height: 32px;
      object-fit: contain;
    }
    .docs-title {
      font-size: 18px;
      font-weight: 800;
      color: var(--text);
    }
    .docs-badge {
      font-size: 10px;
      font-weight: 800;
      background: var(--accent-bronze-light);
      color: var(--accent-bronze);
      border: 1px solid var(--accent-border);
      padding: 2px 6px;
      margin-left: 6px;
    }
    .docs-ai-banner {
      background: var(--bg-1);
      border: 1px solid var(--accent-border);
      padding: 14px 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .endpoint-card {
      background: var(--bg-1);
      border: 1px solid var(--edge);
      padding: 16px;
      margin-bottom: 16px;
    }
    .endpoint-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .http-method {
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      letter-spacing: 0.05em;
    }
    .method-get { background: var(--ok-light); color: var(--ok); border: 1px solid var(--ok-border); }
    .method-post { background: var(--accent-bronze-light); color: var(--accent-bronze); border: 1px solid var(--accent-border); }
    .method-delete { background: var(--danger-light); color: var(--danger); border: 1px solid var(--danger-border); }
    .endpoint-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .endpoint-desc {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }
    .code-block {
      background: var(--bg-2);
      border: 1px solid var(--edge);
      padding: 10px 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text);
      overflow-x: auto;
      white-space: pre;
    }
  </style>
</head>
<body>
  <div class="docs-container">
    <div class="docs-topbar">
      <div class="docs-brand">
        <img src="/logo.png" alt="SoTaNik_AI Logo" class="docs-logo" />
        <span class="docs-title">SoTaNik_AI Data Lake</span>
        <span class="docs-badge">API V2.4</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <a href="/docs/openapi.json" target="_blank" class="secondary btn-sm" style="text-decoration:none;">OpenAPI JSON</a>
        <a href="/docs/llms.txt" target="_blank" class="secondary btn-sm" style="text-decoration:none;">llms.txt</a>
        <a href="/" class="primary-btn btn-sm" style="text-decoration:none;">Open Console</a>
      </div>
    </div>

    <!-- AI Agent Banner -->
    <div class="docs-ai-banner">
      <div>
        <div style="font-weight: 700; font-size: 13px; color: var(--accent-bronze);">AI AGENTS &amp; WEB SCRAPERS READY</div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">
          This API supports programmatic access via <code style="font-family:'JetBrains Mono';">X-API-Key: sot_live_...</code>. LLMs and autonomous agents can ingest the raw OpenAPI 3.0 specification at <a href="/docs/openapi.json" style="color:var(--accent-bronze);">/docs/openapi.json</a> or the agent markdown standard at <a href="/docs/llms.txt" style="color:var(--accent-bronze);">/docs/llms.txt</a>.
        </div>
      </div>
      <a href="/docs/openapi.json" download class="primary-btn btn-sm" style="white-space:nowrap; text-decoration:none;">Download Spec</a>
    </div>

    <!-- Authentication -->
    <div class="endpoint-card">
      <h3 style="font-size: 14px; font-weight: 800; margin-bottom: 8px;">Authentication</h3>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
        All <code style="font-family:'JetBrains Mono';">/api/*</code> routes require an API key generated from the console sidebar. Include it as an HTTP header:
      </p>
      <div class="code-block">X-API-Key: sot_live_abcdef123456...
# or
Authorization: Bearer sot_live_abcdef123456...</div>
    </div>

    <h3 style="font-size: 15px; font-weight: 800; margin: 24px 0 12px 0;">Files &amp; Ingestion Endpoints</h3>

    <!-- Endpoint 1 -->
    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/api/files</span>
      </div>
      <div class="endpoint-desc">List all ingested data lake objects with metadata, sizes, and sharded chunk distribution. Supports <code style="font-family:'JetBrains Mono';">?q=</code>, <code style="font-family:'JetBrains Mono';">?category=</code>, and <code style="font-family:'JetBrains Mono';">?sort=</code>.</div>
      <div class="code-block">curl -s -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files"</div>
    </div>

    <!-- Endpoint 2 -->
    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/api/files/:id/download</span>
      </div>
      <div class="endpoint-desc">Streams assembled raw file bytes directly across distributed storage node chunks. Ideal for scraping scripts and data pipelines.</div>
      <div class="code-block">curl -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files/FILE_ID/download" -o downloaded_file</div>
    </div>

    <!-- Endpoint 3 -->
    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-post">POST</span>
        <span class="endpoint-path">/api/files</span>
      </div>
      <div class="endpoint-desc">Uploads and shards a file across mounted lake nodes automatically via multipart/form-data.</div>
      <div class="code-block">curl -X POST -H "X-API-Key: sot_live_..." -F "file=@./data.csv" "https://YOUR_DOMAIN/api/files"</div>
    </div>

    <!-- Endpoint 4 -->
    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/api/files/:id</span>
      </div>
      <div class="endpoint-desc">Inspects file metadata, shard counts, node assignments, and share link status.</div>
      <div class="code-block">curl -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files/FILE_ID"</div>
    </div>

    <!-- Endpoint 5 -->
    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-delete">DELETE</span>
        <span class="endpoint-path">/api/files/:id</span>
      </div>
      <div class="endpoint-desc">Deletes the file record and wipes all physical chunks sharded across cloud accounts.</div>
      <div class="code-block">curl -X DELETE -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/files/FILE_ID"</div>
    </div>

    <h3 style="font-size: 15px; font-weight: 800; margin: 24px 0 12px 0;">Cluster Topology &amp; API Keys</h3>

    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/api/accounts</span>
      </div>
      <div class="endpoint-desc">Returns aggregate lake utilization, total capacity, free space, and status of mounted storage nodes.</div>
      <div class="code-block">curl -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/accounts"</div>
    </div>

    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/api/keys</span>
      </div>
      <div class="endpoint-desc">Lists active programmatic scraping keys with last-used timestamps.</div>
      <div class="code-block">curl -H "X-API-Key: sot_live_..." "https://YOUR_DOMAIN/api/keys"</div>
    </div>

    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-post">POST</span>
        <span class="endpoint-path">/api/keys</span>
      </div>
      <div class="endpoint-desc">Generates a new programmatic API key for external bots.</div>
      <div class="code-block">curl -X POST -H "X-API-Key: sot_live_..." -H "Content-Type: application/json" -d '{"name":"Scraper Bot"}' "https://YOUR_DOMAIN/api/keys"</div>
    </div>

    <div class="endpoint-card">
      <div class="endpoint-header">
        <span class="http-method method-get">GET</span>
        <span class="endpoint-path">/health</span>
      </div>
      <div class="endpoint-desc">Lightweight cluster health status for uptime monitors.</div>
      <div class="code-block">curl -s "https://YOUR_DOMAIN/health"</div>
    </div>
  </div>
</body>
</html>`;

  res.send(html);
});

module.exports = router;
