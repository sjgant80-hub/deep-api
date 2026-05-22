# Deep API — RapidAPI Listing

## Short Description (140 chars)

Research Intelligence API. Ask anything, get cited reports. Fact-check claims, compare entities, extract data from URLs.

## Long Description

Deep API is a **Research Intelligence as a Service** platform that turns any question into a structured, fully-cited research report.

What sets Deep API apart is its **built-in fact-checking engine** — submit any claim and get a verdict (true, false, partially true, unverifiable) backed by real evidence and source citations. No other research API offers automated claim verification with transparent sourcing.

### Core Capabilities

- **Research Reports** — Ask any question, get structured findings with citations, confidence scores, and follow-up suggestions. Supports quick (sync) and deep (async) modes.
- **Fact-Check** — Verify claims against live sources. Receive verdicts with evidence trails and source links. Perfect for content moderation, journalism tools, and knowledge validation.
- **Entity Comparison** — Compare products, technologies, companies, or concepts side-by-side across any set of aspects. Returns a structured comparison table with sourced data.
- **URL Extraction** — Extract structured data from any URL using a custom schema. Turn unstructured web pages into clean, typed JSON.

### Why Deep API?

- Multi-provider AI backbone (Anthropic, OpenAI, Google) — automatic provider selection for best results
- Every claim backed by citations with source URLs
- Async processing with polling and SSE streaming for long-running research
- Webhook support for fire-and-forget workflows
- Simple REST API — no SDKs required

### Use Cases

- Automated research pipelines and knowledge bases
- Content verification and fact-checking workflows
- Competitive analysis and market research
- Data extraction and enrichment from web sources
- AI-powered Q&A systems with citation requirements

## Category

Data > Artificial Intelligence

## Keywords

- research API
- fact check API
- AI research assistant
- citation generator
- entity comparison API
- web data extraction
- claim verification
- AI research tool

## Pricing

| Plan | Price | Monthly Requests | Daily Limit | Rate (per min) |
|------|-------|-----------------|-------------|-----------------|
| BASIC | Free | 20 | 5 | 3 |
| PRO | $29/mo | 200 | 20 | 10 |
| ULTRA | $99/mo | 2,000 | 200 | 30 |
| MEGA | Custom | Unlimited | Unlimited | 300 |

## Code Examples

### Quick Research — Python

```python
import requests

url = "https://deep-api.p.rapidapi.com/v1/research/quick"

payload = {
    "query": "What are the main causes of coral reef decline?",
    "provider": "auto"
}

headers = {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": "YOUR_RAPIDAPI_KEY",
    "X-RapidAPI-Host": "deep-api.p.rapidapi.com"
}

response = requests.post(url, json=payload, headers=headers)
result = response.json()

print(result["summary"])
for finding in result["findings"]:
    print(f"\n## {finding['title']}")
    print(finding["content"])
    for cite in finding.get("citations", []):
        print(f"  - {cite['title']}: {cite['url']}")
```

### Quick Research — JavaScript

```javascript
const response = await fetch(
  "https://deep-api.p.rapidapi.com/v1/research/quick",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": "YOUR_RAPIDAPI_KEY",
      "X-RapidAPI-Host": "deep-api.p.rapidapi.com",
    },
    body: JSON.stringify({
      query: "What are the main causes of coral reef decline?",
      provider: "auto",
    }),
  }
);

const result = await response.json();
console.log(result.summary);
```

### Quick Research — cURL

```bash
curl -X POST "https://deep-api.p.rapidapi.com/v1/research/quick" \
  -H "Content-Type: application/json" \
  -H "X-RapidAPI-Key: YOUR_RAPIDAPI_KEY" \
  -H "X-RapidAPI-Host: deep-api.p.rapidapi.com" \
  -d '{
    "query": "What are the main causes of coral reef decline?",
    "provider": "auto"
  }'
```

### Fact-Check — Python

```python
import requests

url = "https://deep-api.p.rapidapi.com/v1/fact-check"

payload = {
    "claims": [
        "The Great Wall of China is visible from space",
        "Humans use only 10% of their brains"
    ],
    "provider": "auto"
}

headers = {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": "YOUR_RAPIDAPI_KEY",
    "X-RapidAPI-Host": "deep-api.p.rapidapi.com"
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()

for verdict in data["verdicts"]:
    print(f"Claim: {verdict['claim']}")
    print(f"Verdict: {verdict['verdict']} (confidence: {verdict['confidence']})")
    print(f"Explanation: {verdict['explanation']}")
    print()
```

### Fact-Check — JavaScript

```javascript
const response = await fetch(
  "https://deep-api.p.rapidapi.com/v1/fact-check",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": "YOUR_RAPIDAPI_KEY",
      "X-RapidAPI-Host": "deep-api.p.rapidapi.com",
    },
    body: JSON.stringify({
      claims: [
        "The Great Wall of China is visible from space",
        "Humans use only 10% of their brains",
      ],
      provider: "auto",
    }),
  }
);

const data = await response.json();
data.verdicts.forEach((v) => {
  console.log(`${v.claim}: ${v.verdict} (${v.confidence})`);
});
```

### Fact-Check — cURL

```bash
curl -X POST "https://deep-api.p.rapidapi.com/v1/fact-check" \
  -H "Content-Type: application/json" \
  -H "X-RapidAPI-Key: YOUR_RAPIDAPI_KEY" \
  -H "X-RapidAPI-Host: deep-api.p.rapidapi.com" \
  -d '{
    "claims": ["The Great Wall of China is visible from space"],
    "provider": "auto"
  }'
```

## Test Endpoint

Use `/v1/fact-check` as the RapidAPI test endpoint:

```
POST /v1/fact-check
Content-Type: application/json

{
  "claims": "Water boils at 100 degrees Celsius at sea level",
  "provider": "auto"
}
```

Expected response:

```json
{
  "verdicts": [
    {
      "claim": "Water boils at 100 degrees Celsius at sea level",
      "verdict": "true",
      "confidence": 0.98,
      "explanation": "Water boils at 100°C (212°F) at standard atmospheric pressure (1 atm) at sea level. This is a well-established physical constant.",
      "evidence": [
        {
          "source": "NIST Standard Reference Data",
          "url": "https://webbook.nist.gov",
          "supports": true,
          "snippet": "Boiling point of water at 1 atm: 373.15 K (100.00°C)"
        }
      ]
    }
  ],
  "checked_at": "2026-05-22T12:00:00.000Z"
}
```
