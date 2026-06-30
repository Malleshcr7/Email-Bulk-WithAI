require('dotenv').config();
const express = require('express');
const path = require('path');

const { initPool, ping } = require('./db');
const { searchNicheLeads } = require('./modules/niche-search');
const { rowsToCsv } = require('./modules/niche-search/csv');
const { listConfiguredProviders, isSearxngConfigured } = require('./modules/niche-search/providers');
const { listTasks, getTaskById, createTask, deleteTask } = require('./modules/db/tasks');
const { saveSendResult } = require('./modules/db/sends');
const { saveNicheSearch } = require('./modules/db/niche');
const { listHistory, getHistoryDetail } = require('./modules/db/history');
const { sendTaskEmails } = require('./modules/email-sender');
const {
  TrialLimitError,
  getTrialStatus,
  assertCanUseSearch,
  recordSearchUsage,
  reserveExportRows,
  assertCanSendEmails,
  recordEmailsSent
} = require('./modules/trial');

const app = express();
const PORT = process.env.PORT || 3001;
const DOCS_DIR = path.join(__dirname, 'docs');
const INDEX_HTML = path.join(DOCS_DIR, 'index.html');
const SPA_ROUTES = ['/overview', '/create', '/tasks', '/niche', '/results', '/history'];

app.use(express.json({ limit: '10mb' }));

const GEMINI_MODEL = 'gemini-2.5-flash';

async function generateTaskWithGemini(prompt, csvColumns = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured in .env');

  const columnsHint = csvColumns.length
    ? `Use these CSV column names as template variables: ${csvColumns.join(', ')}. Always include {{email}}.`
    : 'Use {{name}}, {{email}}, {{company}} as default variables.';

  const systemPrompt = `You create bulk email tasks for a mail merge system.
Return JSON with: taskName (snake_case), subject (with {{variables}}), template (HTML email body with inline CSS and {{variables}}).
${columnsHint}
Use professional, responsive HTML. Keep subject under 80 chars.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nUser request: ${prompt}` }] }],
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              taskName: { type: 'string' },
              subject: { type: 'string' },
              template: { type: 'string' }
            },
            required: ['taskName', 'subject', 'template']
          }
        }
      })
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gemini API request failed');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return JSON.parse(text);
}

function sendTrialError(res, err) {
  return res.status(err.status || 403).json({
    error: err.message,
    code: err.code || 'trial_limit',
    trial: err.trial || null
  });
}

app.get('/api/health', async (req, res) => {
  const trial = await getTrialStatus();
  res.json({
    ok: true,
    dbConnected: await ping(),
    aiEnabled: !!process.env.GEMINI_API_KEY,
    aiModel: GEMINI_MODEL,
    searchProviders: listConfiguredProviders(),
    searxngEnabled: isSearxngConfigured(),
    searxngUrl: process.env.SEARXNG_URL || null,
    trial
  });
});

app.get('/api/tasks', async (req, res) => {
  try {
    res.json(await listTasks());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await getTaskById(parseInt(req.params.id, 10));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { taskName, subject, template, recipients } = req.body;
    if (!subject || !template || !recipients?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const task = await createTask({ taskName, subject, template, recipients });
    res.json({ id: task.id, taskData: task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await deleteTask(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/send', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = await getTaskById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await assertCanSendEmails(task.recipients?.length || 0);

    const results = await sendTaskEmails(task);
    const sendId = await saveSendResult(taskId, results);
    const trial = await recordEmailsSent(results.successCount + results.failureCount);
    const code = results.failureCount === 0 ? 0 : 1;
    res.json({ code, results, sendId, trial });
  } catch (err) {
    if (err instanceof TrialLimitError) return sendTrialError(res, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/niche/search', async (req, res) => {
  const { niche, location, limit } = req.body;
  console.log(`\n[${new Date().toISOString()}] POST /api/niche/search — niche="${niche}" location="${location}" limit=${limit || 50}`);
  try {
    if (!niche?.trim() || !location?.trim()) {
      return res.status(400).json({ error: 'Niche and location are required' });
    }
    await assertCanUseSearch();
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const result = await searchNicheLeads({
      niche: niche.trim(),
      location: location.trim(),
      limit: lim,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: GEMINI_MODEL
    });
    result.trial = await recordSearchUsage(1);

    try {
      await saveNicheSearch(result, { niche: niche.trim(), location: location.trim(), limit: lim });
    } catch (dbErr) {
      console.error('Failed to persist niche search:', dbErr.message);
    }

    console.log(`[${new Date().toISOString()}] /api/niche/search done — status=${result.status} rows=${result.stats?.returned || 0}\n`);
    const code = result.status === 'failure' ? 503 : 200;
    res.status(code).json(result);
  } catch (err) {
    if (err instanceof TrialLimitError) return sendTrialError(res, err);
    console.error(`[${new Date().toISOString()}] /api/niche/search failed — ${err.message}\n`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/niche/export', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const filenameBase = (req.body?.filename || 'niche_leads').replace(/[^a-zA-Z0-9_-]/g, '_');
    const { allowedRows, trial } = await reserveExportRows(rows.length);
    const exportRows = rows.slice(0, allowedRows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    res.setHeader('X-Exported-Rows', String(exportRows.length));
    res.setHeader('X-Trial-Export-Remaining', String(trial.remaining.exportRows));
    res.send(rowsToCsv(exportRows));
  } catch (err) {
    if (err instanceof TrialLimitError) return sendTrialError(res, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/generate-task', async (req, res) => {
  try {
    const { prompt, csvColumns } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
    res.json(await generateTaskWithGemini(prompt.trim(), csvColumns || []));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const items = await listHistory({ type: req.query.type || 'all', limit: req.query.limit });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:type/:id', async (req, res) => {
  try {
    const detail = await getHistoryDetail(req.params.type, req.params.id);
    if (!detail?.data) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.redirect('/overview'));
SPA_ROUTES.forEach(route => {
  app.get(route, (req, res) => res.sendFile(INDEX_HTML));
});

app.use(express.static(DOCS_DIR));

async function start() {
  try {
    await initPool();
    console.log('MySQL connected');
  } catch (err) {
    console.error('MySQL connection failed:', err.message);
    console.error('Set DB_* in .env and run: npm run db:init');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

start();
