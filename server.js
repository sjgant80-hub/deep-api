// ═══════════════════════════════════════════════════════════════
// DEEP API — Research Intelligence as a Service
// Ask anything. Get structured reports. Citations included.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'deep_admin_' + crypto.randomBytes(16).toString('hex');

// ─── LLM Providers ───────────────────────────────────────────
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    models: {
      planner: 'claude-haiku-4-20250414',
      researcher: 'claude-sonnet-4-20250514',
      synthesizer: 'claude-sonnet-4-20250514',
    },
    key: () => process.env.ANTHROPIC_API_KEY,
  },
  openai: {
    name: 'OpenAI GPT',
    url: 'https://api.openai.com/v1/chat/completions',
    models: {
      planner: 'gpt-4o-mini',
      researcher: 'gpt-4o',
      synthesizer: 'gpt-4o',
    },
    key: () => process.env.OPENAI_API_KEY,
  },
  google: {
    name: 'Google Gemini',
    urlBase: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: {
      planner: 'gemini-2.0-flash',
      researcher: 'gemini-2.5-flash',
      synthesizer: 'gemini-2.5-flash',
    },
    key: () => process.env.GOOGLE_API_KEY,
  },
};

function getProvider(preferred) {
  if (preferred && PROVIDERS[preferred]?.key()) return preferred;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.key()) return id;
  }
  return null;
}

// ─── LLM Call ─────────────────────────────────────────────────
async function llm(provider, model, system, user, maxTokens = 4096) {
  const p = PROVIDERS[provider];
  if (!p?.key()) throw new Error(`Provider ${provider} not available`);
  const t0 = Date.now();

  if (provider === 'anthropic') {
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': p.key(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { text: d.content[0].text, tokens: { in: d.usage?.input_tokens, out: d.usage?.output_tokens }, ms: Date.now() - t0 };
  }
  if (provider === 'openai') {
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.key()}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { text: d.choices[0].message.content, tokens: { in: d.usage?.prompt_tokens, out: d.usage?.completion_tokens }, ms: Date.now() - t0 };
  }
  if (provider === 'google') {
    const url = `${p.urlBase}${model}:generateContent?key=${p.key()}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: system + '\n\n' + user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { text: d.candidates[0].content.parts[0].text, tokens: { in: d.usageMetadata?.promptTokenCount, out: d.usageMetadata?.candidatesTokenCount }, ms: Date.now() - t0 };
  }
  throw new Error('Unknown provider');
}

// ─── Web Search (Brave Search API — free tier 2k/month) ──────
async function webSearch(query, count = 5) {
  const key = process.env.BRAVE_SEARCH_KEY;
  if (!key) return null; // graceful fallback — LLM-only mode

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const r = await fetch(url, { headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age,
    }));
  } catch { return null; }
}

// ─── Page Content Fetch ──────────────────────────────────────
async function fetchPage(url, maxChars = 8000) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'DeepAPI/1.0 Research Bot', 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    // Strip HTML tags, scripts, styles — get raw text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
    return text;
  } catch { return null; }
}

// ─── Research Engine ─────────────────────────────────────────
const tasks = new Map();

async function runResearch(taskId, query, options = {}) {
  const task = tasks.get(taskId);
  const provider = getProvider(options.provider);
  const models = PROVIDERS[provider].models;
  const depth = options.depth || 'standard'; // quick | standard | deep
  const emit = (step, detail) => {
    task.steps.push({ step, detail, t: Date.now() - task.startTime });
    task.currentStep = step;
  };

  try {
    task.status = 'planning';
    emit('planning', 'Breaking down research query...');

    // ── STEP 1: Planning Agent ──
    const planResult = await llm(provider, models.planner,
      `You are a research planning agent. Given a research query, break it into 3-6 focused sub-questions that would fully answer the query. Also identify the domain and suggest search queries.

Return ONLY valid JSON:
{
  "domain": "technology|business|science|health|finance|politics|legal|general",
  "sub_questions": ["string"],
  "search_queries": ["string"],
  "complexity": "low|medium|high",
  "estimated_sources": number
}`,
      `Research query: "${query}"\nDepth: ${depth}`
    );

    let plan;
    try {
      let j = planResult.text.trim();
      if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      plan = JSON.parse(j);
    } catch {
      plan = { domain: 'general', sub_questions: [query], search_queries: [query], complexity: 'medium', estimated_sources: 3 };
    }

    task.plan = plan;
    task.tokensUsed = { in: planResult.tokens.in || 0, out: planResult.tokens.out || 0 };
    emit('planned', `${plan.sub_questions.length} sub-questions identified in ${plan.domain} domain`);

    // ── STEP 2: Research Agent — gather information ──
    task.status = 'researching';
    const maxQueries = depth === 'quick' ? 2 : depth === 'deep' ? 6 : 4;
    const searchQueries = plan.search_queries.slice(0, maxQueries);
    const allSources = [];
    const allContent = [];

    for (let i = 0; i < searchQueries.length; i++) {
      const sq = searchQueries[i];
      emit('searching', `Searching: "${sq}" (${i + 1}/${searchQueries.length})`);

      const results = await webSearch(sq, 5);
      if (results) {
        allSources.push(...results);

        // Fetch top 2 pages per query for deep content
        const pagesToFetch = depth === 'quick' ? 1 : depth === 'deep' ? 3 : 2;
        for (let j = 0; j < Math.min(pagesToFetch, results.length); j++) {
          emit('reading', `Reading: ${results[j].title}`);
          const content = await fetchPage(results[j].url);
          if (content) {
            allContent.push({ url: results[j].url, title: results[j].title, content: content.slice(0, 4000) });
          }
        }
      }
    }

    // If no search API, use LLM knowledge directly
    if (allSources.length === 0) {
      emit('researching', 'Using AI knowledge base (no search API configured)');
    }

    // ── STEP 3: Analysis Agent — process each sub-question ──
    task.status = 'analyzing';
    const analyses = [];

    for (let i = 0; i < plan.sub_questions.length; i++) {
      const sq = plan.sub_questions[i];
      emit('analyzing', `Analyzing: "${sq}" (${i + 1}/${plan.sub_questions.length})`);

      const context = allContent.length > 0
        ? `\n\nSource material:\n${allContent.map(c => `[${c.title}](${c.url}):\n${c.content.slice(0, 2000)}`).join('\n\n---\n\n')}`
        : '';

      const analysisResult = await llm(provider, models.researcher,
        `You are a research analyst. Answer the given question thoroughly based on your knowledge${allContent.length > 0 ? ' and the provided source material' : ''}. Be specific, cite data points, and note confidence levels.

Return ONLY valid JSON:
{
  "question": "string",
  "answer": "string (detailed, 100-300 words)",
  "key_data_points": [{ "claim": "string", "value": "string", "confidence": 0.0-1.0 }],
  "sources_used": ["string (URL or 'AI knowledge')"]
}`,
        `Question: "${sq}"${context}`,
        2048
      );

      task.tokensUsed.in += analysisResult.tokens.in || 0;
      task.tokensUsed.out += analysisResult.tokens.out || 0;

      try {
        let j = analysisResult.text.trim();
        if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        analyses.push(JSON.parse(j));
      } catch {
        analyses.push({ question: sq, answer: analysisResult.text, key_data_points: [], sources_used: [] });
      }
    }

    // ── STEP 4: Synthesis Agent — compile final report ──
    task.status = 'synthesizing';
    emit('synthesizing', 'Compiling final research report...');

    const synthesisInput = analyses.map((a, i) =>
      `## Finding ${i + 1}: ${a.question}\n${a.answer}\nData points: ${JSON.stringify(a.key_data_points)}`
    ).join('\n\n');

    const sourceList = [...new Set([
      ...allSources.map(s => JSON.stringify({ url: s.url, title: s.title })),
      ...analyses.flatMap(a => a.sources_used.filter(s => s !== 'AI knowledge').map(s => JSON.stringify({ url: s, title: s })))
    ])].map(s => { try { return JSON.parse(s); } catch { return { url: s, title: s }; } });

    const synthesisResult = await llm(provider, models.synthesizer,
      `You are a research synthesis agent. Compile the provided research findings into a polished, structured report.

Return ONLY valid JSON:
{
  "title": "string (compelling report title)",
  "executive_summary": "string (2-3 sentences, the key takeaway)",
  "key_findings": ["string (5-8 bullet points, the most important findings)"],
  "sections": [{
    "heading": "string",
    "content": "string (150-300 words, well-written analysis)",
    "data_points": [{ "claim": "string", "value": "string", "confidence": 0.0-1.0 }]
  }],
  "conclusion": "string (2-3 sentences, forward-looking)",
  "limitations": ["string (what this research couldn't cover)"],
  "suggested_follow_up": ["string (next research questions)"],
  "overall_confidence": 0.0-1.0
}`,
      `Original query: "${query}"\nDomain: ${plan.domain}\n\nResearch findings:\n${synthesisInput}`,
      4096
    );

    task.tokensUsed.in += synthesisResult.tokens.in || 0;
    task.tokensUsed.out += synthesisResult.tokens.out || 0;

    let report;
    try {
      let j = synthesisResult.text.trim();
      if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      report = JSON.parse(j);
    } catch {
      report = { title: query, executive_summary: synthesisResult.text, key_findings: [], sections: [], conclusion: '', overall_confidence: 0.5 };
    }

    // ── DONE ──
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = {
      query,
      report,
      sources: sourceList.slice(0, 20),
      raw_analyses: analyses,
      meta: {
        domain: plan.domain,
        depth,
        sub_questions: plan.sub_questions.length,
        sources_consulted: allSources.length,
        pages_read: allContent.length,
        provider,
        tokens: task.tokensUsed,
        processing_time_ms: Date.now() - task.startTime,
        steps: task.steps.length,
      },
    };
    emit('completed', 'Research report ready');

  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
    emit('error', err.message);
  }
}

// ─── Fact Check Engine ───────────────────────────────────────
async function runFactCheck(taskId, claims, options = {}) {
  const task = tasks.get(taskId);
  const provider = getProvider(options.provider);
  const models = PROVIDERS[provider].models;

  try {
    task.status = 'checking';
    task.steps.push({ step: 'fact_checking', detail: `Verifying ${claims.length} claim(s)...`, t: 0 });

    const claimsList = Array.isArray(claims) ? claims : [claims];
    const results = [];

    for (const claim of claimsList) {
      // Search for evidence
      const searchResults = await webSearch(`fact check: ${claim}`, 3);
      let evidence = '';
      if (searchResults) {
        for (const sr of searchResults.slice(0, 2)) {
          const page = await fetchPage(sr.url, 3000);
          if (page) evidence += `[${sr.title}]: ${page.slice(0, 1500)}\n\n`;
        }
      }

      const result = await llm(provider, models.researcher,
        `You are a fact-checking agent. Evaluate the given claim against evidence. Be rigorous.

Return ONLY valid JSON:
{
  "claim": "string",
  "verdict": "true|mostly_true|mixed|mostly_false|false|unverifiable",
  "confidence": 0.0-1.0,
  "explanation": "string (why this verdict)",
  "supporting_evidence": ["string"],
  "contradicting_evidence": ["string"],
  "sources": ["string (URLs)"],
  "context": "string (important nuance)"
}`,
        `Claim to verify: "${claim}"${evidence ? '\n\nEvidence found:\n' + evidence : ''}`,
        1500
      );

      task.tokensUsed.in += result.tokens.in || 0;
      task.tokensUsed.out += result.tokens.out || 0;

      try {
        let j = result.text.trim();
        if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        results.push(JSON.parse(j));
      } catch {
        results.push({ claim, verdict: 'unverifiable', confidence: 0, explanation: result.text, sources: [] });
      }
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = { claims: results, meta: { provider, tokens: task.tokensUsed, processing_time_ms: Date.now() - task.startTime } };

  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
  }
}

// ─── Compare Engine ──────────────────────────────────────────
async function runCompare(taskId, entities, aspects, options = {}) {
  const task = tasks.get(taskId);
  const provider = getProvider(options.provider);
  const models = PROVIDERS[provider].models;

  try {
    task.status = 'comparing';
    task.steps.push({ step: 'comparing', detail: `Comparing ${entities.length} entities...`, t: 0 });

    // Research each entity
    const entityData = [];
    for (const entity of entities) {
      const searchResults = await webSearch(`${entity} ${aspects ? aspects.join(' ') : ''}`, 3);
      let context = '';
      if (searchResults) {
        for (const sr of searchResults.slice(0, 2)) {
          const page = await fetchPage(sr.url, 2000);
          if (page) context += page.slice(0, 1500) + '\n';
        }
      }
      entityData.push({ entity, context });
    }

    const result = await llm(provider, models.synthesizer,
      `You are a comparison analyst. Compare the given entities across the specified aspects. Be data-driven and objective.

Return ONLY valid JSON:
{
  "title": "string",
  "entities": ["string"],
  "comparison_table": [{
    "aspect": "string",
    "values": { "entity_name": { "value": "string", "score": 0-10, "notes": "string" } }
  }],
  "winner_by_aspect": { "aspect": "entity_name" },
  "overall_recommendation": "string",
  "summary": "string (2-3 sentences)",
  "confidence": 0.0-1.0
}`,
      `Compare: ${entities.join(' vs ')}\nAspects: ${aspects ? aspects.join(', ') : 'auto-detect relevant aspects'}\n\nResearch data:\n${entityData.map(e => `### ${e.entity}\n${e.context}`).join('\n\n')}`,
      3000
    );

    task.tokensUsed.in += result.tokens.in || 0;
    task.tokensUsed.out += result.tokens.out || 0;

    let parsed;
    try {
      let j = result.text.trim();
      if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      parsed = JSON.parse(j);
    } catch {
      parsed = { summary: result.text };
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = { comparison: parsed, meta: { provider, tokens: task.tokensUsed, processing_time_ms: Date.now() - task.startTime } };

  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
  }
}

// ─── API Key Store ────────────────────────────────────────────
const apiKeys = new Map();

function createKey(name, tier = 'free') {
  const key = 'deep_' + tier[0] + '_' + crypto.randomBytes(20).toString('hex');
  const record = { key, name, tier, created: new Date().toISOString(), requests: 0, active: true };
  apiKeys.set(key, record);
  return record;
}

const demoKey = createKey('demo', 'free');
console.log(`\n  Demo key: ${demoKey.key}\n`);

// ─── Express ──────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

function auth(req, res, next) {
  // RapidAPI proxy path — when deployed behind RapidAPI's marketplace
  const proxySecret = process.env.RAPIDAPI_PROXY_SECRET;
  if (proxySecret && req.headers['x-rapidapi-proxy-secret'] === proxySecret) {
    req.tier = 'rapidapi';
    req.rapidUser = req.headers['x-rapidapi-user'] || null;
    req.rapidSubscription = req.headers['x-rapidapi-subscription'] || null;
    return next();
  }
  // Direct / dev path — Bearer token or x-api-key header
  const key = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key required. Use Authorization: Bearer <key>' });
  if (key === ADMIN_KEY) { req.tier = 'admin'; return next(); }
  const record = apiKeys.get(key);
  if (!record?.active) return res.status(403).json({ error: 'Invalid API key' });
  record.requests++;
  req.tier = record.tier;
  next();
}

// ─── Routes ───────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const providers = Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([id]) => id);
  res.json({ status: 'ok', version: '1.0.0', providers, search: !!process.env.BRAVE_SEARCH_KEY, activeTasks: tasks.size });
});

// ═══ RESEARCH — the main event ═══
app.post('/v1/research', auth, async (req, res) => {
  const { query, depth, provider, webhook } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required', example: { query: 'What is the current state of quantum computing?', depth: 'standard' } });

  const prov = getProvider(provider);
  if (!prov) return res.status(503).json({ error: 'No LLM provider configured' });

  const taskId = uuidv4();
  const task = {
    id: taskId,
    type: 'research',
    query,
    status: 'queued',
    steps: [],
    currentStep: 'queued',
    startTime: Date.now(),
    tokensUsed: { in: 0, out: 0 },
    result: null,
    error: null,
  };
  tasks.set(taskId, task);

  // Run async — return task ID immediately
  runResearch(taskId, query, { depth, provider: prov }).then(() => {
    if (webhook) {
      fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task.result) }).catch(() => {});
    }
  });

  res.status(202).json({ id: taskId, status: 'queued', poll: `/v1/research/${taskId}`, stream: `/v1/research/${taskId}/stream` });
});

// Quick research — synchronous, returns immediately
app.post('/v1/research/quick', auth, async (req, res) => {
  const { query, provider } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const prov = getProvider(provider);
  if (!prov) return res.status(503).json({ error: 'No LLM provider configured' });

  const taskId = uuidv4();
  const task = { id: taskId, type: 'research', query, status: 'queued', steps: [], currentStep: 'queued', startTime: Date.now(), tokensUsed: { in: 0, out: 0 }, result: null, error: null };
  tasks.set(taskId, task);

  await runResearch(taskId, query, { depth: 'quick', provider: prov });

  if (task.status === 'completed') {
    res.json(task.result);
  } else {
    res.status(500).json({ error: task.error || 'Research failed' });
  }
});

// Poll task status
app.get('/v1/research/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const response = {
    id: task.id,
    status: task.status,
    currentStep: task.currentStep,
    steps: task.steps,
    elapsed_ms: Date.now() - task.startTime,
  };

  if (task.status === 'completed') response.result = task.result;
  if (task.status === 'failed') response.error = task.error;

  res.json(response);
});

// SSE stream — real-time progress
app.get('/v1/research/:id/stream', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastStep = 0;
  const interval = setInterval(() => {
    // Send new steps
    while (lastStep < task.steps.length) {
      res.write(`data: ${JSON.stringify({ type: 'step', ...task.steps[lastStep] })}\n\n`);
      lastStep++;
    }

    // Send status updates
    res.write(`data: ${JSON.stringify({ type: 'status', status: task.status, elapsed_ms: Date.now() - task.startTime })}\n\n`);

    // Done?
    if (task.status === 'completed') {
      res.write(`data: ${JSON.stringify({ type: 'result', result: task.result })}\n\n`);
      res.write('data: [DONE]\n\n');
      clearInterval(interval);
      res.end();
    }
    if (task.status === 'failed') {
      res.write(`data: ${JSON.stringify({ type: 'error', error: task.error })}\n\n`);
      res.write('data: [DONE]\n\n');
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

// ═══ FACT CHECK ═══
app.post('/v1/fact-check', auth, async (req, res) => {
  const { claims, provider } = req.body;
  if (!claims) return res.status(400).json({ error: 'claims is required (string or array)', example: { claims: ['The Earth is flat', 'Water boils at 100C at sea level'] } });

  const prov = getProvider(provider);
  if (!prov) return res.status(503).json({ error: 'No LLM provider configured' });

  const taskId = uuidv4();
  const task = { id: taskId, type: 'fact-check', status: 'queued', steps: [], startTime: Date.now(), tokensUsed: { in: 0, out: 0 }, result: null, error: null };
  tasks.set(taskId, task);

  await runFactCheck(taskId, claims, { provider: prov });

  if (task.status === 'completed') {
    res.json(task.result);
  } else {
    res.status(500).json({ error: task.error || 'Fact check failed' });
  }
});

// ═══ COMPARE ═══
app.post('/v1/compare', auth, async (req, res) => {
  const { entities, aspects, provider } = req.body;
  if (!entities || !Array.isArray(entities) || entities.length < 2) {
    return res.status(400).json({ error: 'entities array (min 2) required', example: { entities: ['React', 'Vue', 'Svelte'], aspects: ['performance', 'learning curve', 'ecosystem'] } });
  }

  const prov = getProvider(provider);
  if (!prov) return res.status(503).json({ error: 'No LLM provider configured' });

  const taskId = uuidv4();
  const task = { id: taskId, type: 'compare', status: 'queued', steps: [], startTime: Date.now(), tokensUsed: { in: 0, out: 0 }, result: null, error: null };
  tasks.set(taskId, task);

  await runCompare(taskId, entities, aspects, { provider: prov });

  if (task.status === 'completed') {
    res.json(task.result);
  } else {
    res.status(500).json({ error: task.error || 'Comparison failed' });
  }
});

// ═══ EXTRACT — pull structured data from any URL ═══
app.post('/v1/extract', auth, async (req, res) => {
  const { url, schema, provider } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const prov = getProvider(provider);
  if (!prov) return res.status(503).json({ error: 'No LLM provider configured' });

  try {
    const content = await fetchPage(url, 12000);
    if (!content) return res.status(422).json({ error: 'Could not fetch URL' });

    const schemaPrompt = schema ? `Extract data matching this schema: ${JSON.stringify(schema)}` : 'Extract all structured data (entities, key facts, dates, numbers, relationships).';

    const result = await llm(prov, PROVIDERS[prov].models.researcher,
      `You are a data extraction agent. Extract structured data from web page content.
Return ONLY valid JSON. ${schemaPrompt}

If no specific schema was given, return:
{
  "title": "string",
  "entities": [{ "type": "string", "name": "string", "details": "string" }],
  "key_facts": [{ "fact": "string", "value": "string" }],
  "dates": [{ "date": "string", "context": "string" }],
  "numbers": [{ "value": "string", "context": "string" }],
  "summary": "string (max 150 words)"
}`,
      `URL: ${url}\n\nPage content:\n${content}`,
      3000
    );

    let parsed;
    try {
      let j = result.text.trim();
      if (j.startsWith('```')) j = j.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      parsed = JSON.parse(j);
    } catch { parsed = { raw: result.text }; }

    res.json({ url, data: parsed, meta: { provider: prov, tokens: result.tokens, latency_ms: result.ms } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ Admin ═══
app.post('/v1/keys', auth, (req, res) => {
  if (req.tier !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const record = createKey(req.body.name || 'unnamed', req.body.tier || 'free');
  res.json({ key: record.key, name: record.name, tier: record.tier });
});

app.get('/v1/keys', auth, (req, res) => {
  if (req.tier !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({ keys: [...apiKeys.values()].map(({ key, ...r }) => r) });
});

// Landing
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ───
app.listen(PORT, () => {
  const p = Object.entries(PROVIDERS).filter(([, v]) => v.key()).map(([k]) => k);
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   DEEP API v1.0 — Research Intelligence           ║
  ╠═══════════════════════════════════════════════════╣
  ║   http://localhost:${PORT}                            ║
  ║   LLM: ${p.join(', ') || 'NONE — set API keys'}
  ║   Search: ${process.env.BRAVE_SEARCH_KEY ? 'Brave (live)' : 'off (LLM-only mode)'}
  ╚═══════════════════════════════════════════════════╝
  `);
});
