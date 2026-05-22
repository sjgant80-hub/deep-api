# Deep API

**Research Intelligence as a Service**

Ask anything. Get structured reports with citations, confidence scores, and source trails. Fact-check claims. Compare entities. Extract data from any URL.

[![Deploy](https://img.shields.io/badge/Deploy-Railway-blueviolet)](https://railway.app)
[![API](https://img.shields.io/badge/API-RapidAPI-blue)](https://rapidapi.com)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Features

- **Research Reports** -- async and sync modes with full citations, confidence scoring, and follow-up suggestions
- **Fact-Checking** -- verify any claim with verdicts (`true`, `mostly_true`, `mixed`, `mostly_false`, `false`, `unverifiable`) backed by evidence
- **Entity Comparison** -- compare products, technologies, or concepts with structured scoring tables
- **URL Extraction** -- extract structured data from any URL using custom or auto-detected schemas
- **SSE Streaming** -- real-time progress updates via Server-Sent Events
- **Multi-LLM Backend** -- Anthropic Claude, OpenAI GPT, and Google Gemini with automatic provider fallback
- **Live Web Search** -- Brave Search API integration for grounded, up-to-date research
- **Webhook Support** -- fire-and-forget async workflows with callback delivery

---

## Quick Start

```bash
# Clone
git clone https://github.com/sjgant80-hub/deep-api.git
cd deep-api

# Install
npm install

# Configure (at minimum, one LLM provider key)
cp .env.example .env
# Edit .env with your API keys

# Run
npm start
# => http://localhost:3000
```

Development mode with auto-reload:

```bash
npm run dev
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | At least one LLM key | Anthropic Claude API key |
| `OPENAI_API_KEY` | At least one LLM key | OpenAI API key |
| `GOOGLE_API_KEY` | At least one LLM key | Google Gemini API key |
| `BRAVE_SEARCH_KEY` | No | Brave Search API key (enables live web research) |
| `ADMIN_KEY` | No | Admin key for key management endpoints |
| `PORT` | No | Server port (default: `3000`) |
| `DEFAULT_PROVIDER` | No | Preferred LLM provider: `anthropic`, `openai`, or `google` |

> At least one LLM provider key is required. Without `BRAVE_SEARCH_KEY`, the API operates in LLM-only mode using the model's built-in knowledge.

---

## Endpoints

### Core

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/research` | Yes | Start async research (returns task ID) |
| `POST` | `/v1/research/quick` | Yes | Synchronous research (returns full report) |
| `GET` | `/v1/research/:id` | No | Poll task status and results |
| `GET` | `/v1/research/:id/stream` | No | SSE stream for real-time progress |
| `POST` | `/v1/fact-check` | Yes | Verify claims with evidence and verdicts |
| `POST` | `/v1/compare` | Yes | Compare entities with scoring table |
| `POST` | `/v1/extract` | Yes | Extract structured data from a URL |

### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/keys` | Admin | Create a new API key |
| `GET` | `/v1/keys` | Admin | List all API keys |

### System

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check (providers, search status, active tasks) |

**Authentication:** Pass your API key via `Authorization: Bearer <key>` header or `x-api-key` header.

---

## Code Examples

### Quick Research (cURL)

```bash
curl -X POST http://localhost:3000/v1/research/quick \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "query": "What is the current state of quantum computing?",
    "provider": "anthropic"
  }'
```

### Quick Research (JavaScript)

```javascript
const response = await fetch("http://localhost:3000/v1/research/quick", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    query: "What is the current state of quantum computing?"
  })
});

const report = await response.json();
console.log(report.report.title);
console.log(report.report.executive_summary);
console.log(report.report.key_findings);
```

### Fact-Check (cURL)

```bash
curl -X POST http://localhost:3000/v1/fact-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "claims": [
      "The Great Wall of China is visible from space",
      "Water boils at 100C at sea level"
    ]
  }'
```

### Fact-Check (JavaScript)

```javascript
const response = await fetch("http://localhost:3000/v1/fact-check", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    claims: ["The Great Wall of China is visible from space"]
  })
});

const result = await response.json();
result.claims.forEach(c => {
  console.log(`${c.claim}: ${c.verdict} (${c.confidence})`);
  console.log(`  Reason: ${c.explanation}`);
});
```

### Async Research with SSE Streaming

```javascript
// Start the research task
const start = await fetch("http://localhost:3000/v1/research", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
  },
  body: JSON.stringify({
    query: "Compare the economic policies of the G7 nations",
    depth: "deep"
  })
});

const { id } = await start.json();

// Stream real-time progress
const events = new EventSource(`http://localhost:3000/v1/research/${id}/stream`);

events.onmessage = (event) => {
  if (event.data === "[DONE]") {
    events.close();
    return;
  }
  const data = JSON.parse(event.data);
  if (data.type === "step") console.log(`[${data.step}] ${data.detail}`);
  if (data.type === "result") console.log("Report:", data.result.report);
};
```

---

## Research Depth Modes

| Mode | Sub-questions | Search Queries | Pages per Query | Best For |
|---|---|---|---|---|
| `quick` | 3-6 | Up to 2 | 1 | Fast answers, simple lookups |
| `standard` | 3-6 | Up to 4 | 2 | Balanced depth and speed (default) |
| `deep` | 3-6 | Up to 6 | 3 | Thorough research, complex topics |

Set the depth in your request body:

```json
{ "query": "...", "depth": "deep" }
```

---

## Pricing Tiers

| Tier | Requests/month | Features |
|---|---|---|
| **Free** | 20 | All endpoints, standard depth |
| **Pro** | 200 | All endpoints, all depth modes, priority |
| **Business** | 2,000 | All endpoints, all depth modes, webhooks, priority |

API keys are created with a tier via the admin endpoint:

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "my-app", "tier": "pro" }'
```

---

## Deployment

### Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Deploy
railway login
railway init
railway up
```

Set your environment variables in the Railway dashboard. The included `Procfile` and `Dockerfile` are both supported.

### Docker

```bash
docker build -t deep-api .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e BRAVE_SEARCH_KEY=... \
  deep-api
```

### RapidAPI

The API is designed for RapidAPI distribution. See [`RAPIDAPI_LISTING.md`](RAPIDAPI_LISTING.md) for the full marketplace listing configuration, and [`rapidapi-middleware.js`](rapidapi-middleware.js) for the proxy-secret authentication layer.

---

## Project Structure

```
deep-api/
  server.js              # API server (all routes and engines)
  rapidapi-middleware.js  # RapidAPI proxy auth layer
  openapi.yaml           # OpenAPI 3.0 specification
  Dockerfile             # Container build
  Procfile               # Railway/Heroku process
  public/index.html      # Landing page
  .env.example           # Environment template
```

---

## Ecosystem

| Project | Description |
|---|---|
| [Deep API](https://github.com/sjgant80-hub/deep-api) | Research Intelligence API (this repo) |
| [Live Docs](https://sjgant80-hub.github.io/deep-api/) | Interactive API documentation |

---

<p align="center">
  <strong>Konomi Architecture</strong><br>
  Built by <a href="https://github.com/sjgant80-hub">ACG</a>
</p>
