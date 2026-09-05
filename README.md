# SoTaNik_AI Data Lake

<p align="center">
  <img src="./public/logo.png" alt="SoTaNik_AI Logo" width="120" height="120" style="object-fit: contain;" />
</p>

<p align="center">
  <strong>Autonomous Multi-Node Storage Aggregation &bull; High-Density Sharding &bull; Zero Vendor Lock-in</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-Distributed_Virtual_Pool-292524?style=for-the-badge&labelColor=141312" alt="Architecture" />
  <img src="https://img.shields.io/badge/Vault-AES--256--GCM_Envelope-786148?style=for-the-badge&labelColor=141312" alt="Encryption" />
  <img src="https://img.shields.io/badge/Catalog-Supabase_Postgres_RLS-3f3935?style=for-the-badge&labelColor=141312" alt="Supabase" />
  <img src="https://img.shields.io/badge/API_Spec-OpenAPI_3.0_%2B_LLMs.txt-bba083?style=for-the-badge&labelColor=141312" alt="API Spec" />
  <img src="https://img.shields.io/badge/UI_Design-Architectural_Matte-4a6153?style=for-the-badge&labelColor=141312" alt="UI Theme" />
</p>

---

## 🏛️ System Architecture Overview

```mermaid
graph TD
    subgraph Client_and_Agent_Layer [Access & Ingestion Surface]
        UI[Architectural Web Console]
        AI[Autonomous AI Agents & Scrapers]
        CLI[cURL / Python Automation]
    end

    subgraph Security_and_Routing_Gateway [Enterprise Gateway]
        GW[Node.js / Express Gateway]
        AUTH{Auth Dispatcher}
        JWT[Supabase Bearer Token]
        APIKEY[SHA-256 Scraper API Key]
        SEC[Security Headers & Timing-Safe Admin Guard]
    end

    subgraph Core_Storage_Engine [Distributed Data Lake Engine]
        ROUTER[Placement & Bin-Packing Engine]
        SPLIT[Dynamic Sharding & Chunk Reassembly]
        VAULT[AES-256-GCM Vault Manager]
        KEEPALIVE[Render Anti-Sleep Engine]
        HEARTBEAT[Cloud Liveness Heartbeat Sweeper]
    end

    subgraph Storage_Nodes_Topology [Aggregated Physical Nodes]
        NODE1[(Storage Node Alpha)]
        NODE2[(Storage Node Beta)]
        NODE3[(Storage Node Gamma)]
        PUB[(Super-Admin Public Pool Nodes)]
    end

    subgraph Persistence_Catalog [State & Isolation Layer]
        META[(Supabase Postgres DB)]
        RLS[Forced Row Level Security]
        KEYS[(Hashed API Keys Table)]
    end

    UI --> GW
    AI --> GW
    CLI --> GW
    GW --> AUTH
    AUTH --> JWT
    AUTH --> APIKEY
    JWT --> SEC
    APIKEY --> SEC
    SEC --> ROUTER
    ROUTER --> SPLIT
    ROUTER --> VAULT
    SPLIT --> NODE1
    SPLIT --> NODE2
    SPLIT --> NODE3
    SPLIT --> PUB
    ROUTER --> META
    META --- RLS
    META --- KEYS
    KEEPALIVE -.-> GW
    HEARTBEAT -.-> Storage_Nodes_Topology
```

---

## 🧰 Technology Stack Ecosystem

| Layer | Technologies & Frameworks | Function & Responsibility |
|---|---|---|
| **Core Runtime** | `Node.js 20+` &bull; `Express 4.x` &bull; `HTTP/1.1 Streaming` | High-throughput async ingestion engine with 30-minute upload socket stability. |
| **Persistence & Auth** | `Supabase` &bull; `PostgreSQL 15` &bull; `pgcrypto` &bull; `PostgREST` | Multi-tenant auth, session verification, and catalog indexing guarded by RLS. |
| **Cryptography** | `AES-256-GCM` &bull; `PBKDF2` &bull; `SHA-256` &bull; `Constant-Time Equal` | Node credential envelope encryption and timing-safe admin authorization. |
| **Storage Pooling** | `Megajs Engine` &bull; `Greedy Bin-Packing` &bull; `Chunk Sharding` | Transparent multi-account aggregation into unified zero-fragmentation drives. |
| **Interface & UX** | `Vanilla CSS3` &bull; `HTML5 Semantic` &bull; `Plus Jakarta Sans` &bull; `JetBrains Mono` | Zero-dependency matte editorial UI, collapsible sidebar, and keyboard shortcuts. |
| **AI & Bot Discovery** | `OpenAPI 3.0.3` &bull; `LLMs.txt Standard` &bull; `RESTful JSON API` | Native content negotiation, machine-readable specifications, and agent scraping. |

---

## ⚡ Data Ingestion & Sharding Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Client as Tenant / AI Agent
    participant GW as Data Lake Gateway
    participant PM as Placement Engine
    participant Cloud as Multi-Node Storage Pool
    participant DB as Postgres Catalog

    Client->>GW: POST /api/files (Payload Stream)
    GW->>DB: Query Mounted Storage Nodes & Quota
    DB-->>GW: Node Capacities & Topology
    GW->>PM: Evaluate File Size vs Node Free Space
    alt Fits on Single Node
        PM-->>GW: Allocate Primary Node
        GW->>Cloud: Stream Object Directly
    else Exceeds Node Free Quota / Max Chunk Size
        PM-->>GW: Generate Shard Blueprint (Chunk-00, Chunk-01...)
        par Parallel Ingestion
            GW->>Cloud: Stream Chunk 1 -> Storage Node Alpha
            GW->>Cloud: Stream Chunk 2 -> Storage Node Beta
            GW->>Cloud: Stream Chunk 3 -> Storage Node Gamma
        end
    end
    Cloud-->>GW: Storage Node Acknowledgements & Remote IDs
    GW->>DB: Record Object Manifest & Shard Node Map (RLS Scoped)
    DB-->>GW: Catalog Commit Confirmed
    GW-->>Client: 201 Created (Virtual Object JSON)
```

---

## 📊 Platform Capability Matrix

| Capability | SoTaNik_AI Data Lake | Traditional Cloud Drives | Generic S3 / Object Stores |
|---|:---:|:---:|:---:|
| **Multi-Node Aggregation** | ✅ Unlimited Accounts Pooled | ❌ Single Account Locked | ⚠️ Single Account / Bucket |
| **Dynamic Auto-Sharding** | ✅ Automatic Multi-Node Slicing | ❌ Fails on File > Quota | ⚠️ Requires Manual Multipart |
| **Tenant Data Privacy** | ✅ Hardware Isolation + RLS | ❌ Platform Monitored | ⚠️ Complex IAM Policies |
| **Zero Vendor Lock-in** | ✅ Multi-Provider Virtual Lake | ❌ Proprietary Ecosystem | ❌ Vendor Specific Formats |
| **AI Agent Scraping Ready** | ✅ `/docs` + `/llms.txt` + OpenAPI | ❌ Heavy Web Login Only | ⚠️ Raw API Without Context |
| **Programmatic API Keys** | ✅ SHA-256 Scraper Keys | ❌ OAuth Refresh Complexity | ✅ IAM Access Keys |
| **Credential Storage** | ✅ AES-256-GCM Envelope Encryption | ❌ Stored by Provider | ⚠️ Plaintext IAM Secrets |
| **Inactivity Keep-Alive** | ✅ Render Anti-Sleep + Account Pings | ❌ Inactive Account Purges | ❌ N/A |
| **Super-Admin Node Allocator** | ✅ Dynamic Public Node Pooling | ❌ Rigid Workspace Plans | ❌ Cross-Account Complex |

---

## 🎨 Design Philosophy: Architectural Matte Palette

The interface is engineered around an architectural editorial aesthetic with strict sharp edges (`border-radius: 0px` across all components) and zero neon glare:

```
Warm Matte Cream Mode (Daylight Engineering):
┌─────────────────────────────────────────────────────────────┐
│  Base Canvas:       #f5f2eb   [Parchment Cream]             │
│  Containers:        #fbf9f5   [Alabaster Surface]           │
│  Borders:           #ddd6c7   [Muted Stone Edge]            │
│  Typography:        #1c1917   [Deep Obsidian Ink]           │
│  Architectural Accent: #786148 [Antique Architectural Bronze]│
└─────────────────────────────────────────────────────────────┘

Deep Obsidian / Charcoal Mode (Low-Light Command):
┌─────────────────────────────────────────────────────────────┐
│  Base Canvas:       #141312   [Deep Obsidian Void]          │
│  Containers:        #1c1a18   [Matte Charcoal Slate]        │
│  Borders:           #2e2a26   [Subtle Boundary Line]        │
│  Typography:        #f5f2eb   [Warm Cream Glyphs]           │
│  Architectural Accent: #bba083 [Champagne Bronze]           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI Agent & Automated Scraper Surface

The platform provides dedicated, self-documenting interfaces tailored for automated crawlers, LLM agents, and external scripts:

```mermaid
graph LR
    subgraph Discovery_Surface [Autonomous Discovery Endpoints]
        D1["GET /docs"]
        D2["GET /llms.txt"]
        D3["GET /openapi.json"]
    end

    subgraph Content_Negotiation [Content-Negotiated Payloads]
        C1["Accept: text/html &rarr; Interactive Dev Portal"]
        C2["Accept: text/markdown &rarr; LLM Structured Markdown Guide"]
        C3["Accept: application/json &rarr; OpenAPI 3.0 Machine Schema"]
    end

    subgraph Authentication_Options [Flexible Auth Pipeline]
        A1["Authorization: Bearer &lt;Supabase_JWT&gt;"]
        A2["X-API-Key: sot_live_... &bull; Programmatic Scrapers"]
    end

    D1 --> C1
    D1 --> C2
    D1 --> C3
    D2 --> C2
    D3 --> C3
```

### Discovery Endpoints Summary

| Endpoint | Protocol | Consumer | Payload Description |
|---|---|---|---|
| `/docs` | HTTP GET | Browsers / Agents | Content-negotiated developer portal, LLM guide, or OpenAPI schema. |
| `/docs/llms.txt` | HTTP GET | AI Agents & LLMs | Structured markdown context guide following the `llms.txt` standard. |
| `/docs/openapi.json` | HTTP GET | Automated Tools | Full OpenAPI 3.0.3 machine-readable schema for client generation. |
| `/api/files` | REST GET/POST | Tenants & Scrapers | List pool objects, filter by type, or ingest high-capacity payloads. |
| `/api/files/:id/download` | REST GET | Tenants & Scrapers | Direct transparent streaming download with automated chunk reassembly. |
| `/share/:token` | HTTP GET | Public Consumers | Unauthenticated signed token stream endpoint with time expiration. |
| `/api/keys` | REST GET/POST/DEL | Tenant Admins | Provision, list, and revoke cryptographically hashed scraper API keys. |

---

## 🛡️ Enterprise Security & Defense-in-Depth

```mermaid
flowchart TD
    subgraph Identity_Defense [Identity & Access Enforcement]
        direction TB
        A[Incoming Request] --> B{Bearer JWT or API Key?}
        B -->|Supabase JWT| C[Cryptographic Signature Verification]
        B -->|X-API-Key| D[Constant-Time SHA-256 Hash Verification]
        C --> E[Verify Email Confirmed At]
        D --> F[Check Key Active & Update Last Used]
    end

    subgraph Database_Defense [Database-Level Enforcement]
        E --> G[Row Level Security Filter]
        F --> G
        G --> H[(PostgreSQL RLS: auth.uid = user_id)]
    end

    subgraph Storage_Defense [Storage-Level Encryption]
        H --> I[AES-256-GCM Vault Lookup]
        I --> J[Decrypted In-Memory Only During Transfer]
        J --> K[Encrypted Storage Nodes]
    end

    subgraph Admin_Defense [Super-Admin Protected Vault]
        L[Admin Operations] --> M[Unicode NFKC Normalization]
        M --> N[Timing-Safe Equality Comparison]
        N --> O[UUID Strict RFC 4122 Format Check]
        O --> P[Anti-Self-Deletion Shield]
    end
```

---

## 📋 Comprehensive Feature Scorecard

| Category | UI & Platform Features Included |
|---|---|
| **Storage Management** | Multi-Account Storage Pooling &bull; Greedy Load-Balancing &bull; Automatic Chunk Slicing &bull; Public Stream Share Tokens with Expiration &bull; Batch Ingestion Dropstrip &bull; Instant Shard Inspector Modal |
| **Catalog & Navigation** | Real-Time Live Search (`/`) &bull; Category Filter Pills (Datasets, Docs, Media, Archives, Code) &bull; Multi-Column Sorting &bull; Table vs. Technical Grid View (`V`) &bull; 1-Click JSON Lake Manifest Export |
| **Security & Privacy** | AES-256-GCM Master Key Envelope Encryption &bull; Supabase Row Level Security &bull; Timing-Safe Constant-Time Admin Checks &bull; Unicode Anti-Spoofing &bull; IP-Based Sliding Window Rate Limiting |
| **Automations & Anti-Sleep** | Render Container Self-Ping Keep-Alive (`src/keepAlive.js`) &bull; 24-Hour Cloud Storage Account Anti-Deactivation Heartbeat (`src/cloudHeartbeat.js`) |
| **Automation & Scrapers** | Programmatic Scraper API Keys (`sot_live_...`) &bull; Content-Negotiated `/docs` Portal &bull; `/llms.txt` Agent Context Standard &bull; Machine-Readable OpenAPI 3.0.3 Specification |
| **Super-Admin Console** | Dedicated Control Panel for Master Admin &bull; Full Tenant Account & Cloud Physical Chunk Purge &bull; Public Storage Node Pool &bull; Manual Tenant Storage Allocation &bull; Manual Heartbeat Trigger |
| **Layout & Ergonomics** | Collapsible Infrastructure Sidebar (`B`) &bull; 2x2 Mini Telemetry Matrix &bull; Real-time Cluster Load Advisor &bull; Global Keyboard Navigation (`?`) &bull; Dual Warm Matte Cream / Deep Obsidian Themes (`M`) |

---

<p align="center">
  <strong>SoTaNik_AI Data Lake &bull; Architectural Data Lake Infrastructure</strong>
</p>
