let csvData = null;
let csvColumns = [];
let taskData = null;
let tasks = [];
let serverOnline = false;
let aiEnabled = false;
let trialInfo = null;
const THEME_STORAGE_KEY = 'bulk-email-theme';

let nicheRows = [];

const pages = ['overview', 'create', 'tasks', 'niche', 'results', 'history'];
const titles = {
  overview: 'Overview', create: 'Create Task', tasks: 'Tasks',
  niche: 'Niche Search', results: 'Results', history: 'History'
};
const TYPE_LABELS = { niche_search: 'Niche Search', task_created: 'Task Created', email_sent: 'Email Sent' };
const NICHE_COLUMNS = ['name', 'email', 'company', 'website', 'niche', 'source'];

const $ = id => document.getElementById(id);

function applyTheme(theme) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = resolved;
  if ($('themeToggle')) $('themeToggle').checked = resolved === 'light';
}

function loadThemePreference() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(stored === 'light' ? 'light' : 'dark');
}

function toggleTheme() {
  const nextTheme = $('themeToggle')?.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function renderTrialStatus(trial) {
  trialInfo = trial || null;

  if (!trial?.enabled) {
    $('trialStatus')?.classList.add('hidden');
    return;
  }

  const remaining = trial.remaining || {};
  const summary = `${remaining.searches} searches, ${remaining.exportRows} export rows, ${remaining.emails} emails left`;
  const meta = trial.expired
    ? `Expired on ${fmtDate(trial.expiresAt)}`
    : `Expires ${fmtDate(trial.expiresAt)}`;

  $('trialSummary').textContent = summary;
  $('trialMeta').textContent = meta;
  $('trialStatus').classList.remove('hidden');

  if ($('nicheSearchBtn')) $('nicheSearchBtn').disabled = !serverOnline || trial.expired || remaining.searches <= 0;
  if ($('nicheDownloadBtn')) $('nicheDownloadBtn').disabled = trial.expired || remaining.exportRows <= 0;
}

function showToast(msg, duration = 3001) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function pathFromPage(page) {
  return page === 'overview' ? '/overview' : `/${page}`;
}

function pageFromPath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/overview';
  const page = p.slice(1) || 'overview';
  return pages.includes(page) ? page : 'overview';
}

function navigate(page, push = true) {
  if (!pages.includes(page)) page = 'overview';
  pages.forEach(p => {
    $(`page-${p}`).classList.toggle('active', p === page);
    const nav = document.querySelector(`[data-page="${p}"]`);
    if (nav) nav.classList.toggle('active', p === page);
  });
  $('pageTitle').textContent = titles[page];
  const path = pathFromPage(page);
  if (push && window.location.pathname !== path) {
    history.pushState({ page }, '', path);
  }
  if (page === 'history') loadHistory();
}

function navigateFromUrl() {
  navigate(pageFromPath(window.location.pathname), false);
}

async function checkServer() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      serverOnline = true;
      aiEnabled = !!data.aiEnabled;
      $('serverStatus').textContent = aiEnabled ? 'Server + AI' : 'Server Online';
      $('serverStatus').className = 'status-badge online';
      if (data.aiModel) $('aiModelBadge').textContent = data.aiModel;
      $('aiGenerateBtn').disabled = !aiEnabled;
      $('aiHint').textContent = aiEnabled
        ? 'Upload CSV first so AI uses your column names as variables.'
        : 'Add GEMINI_API_KEY to .env and restart server to enable AI.';
      if ($('nicheProviderHint')) {
        $('nicheProviderHint').textContent = data.searxngEnabled
          ? `SearXNG configured: ${data.searxngUrl || 'connected'}`
          : 'Set SEARXNG_URL in .env and restart server';
      }
      renderTrialStatus(data.trial || null);
      return true;
    }
  } catch {}
  serverOnline = false;
  aiEnabled = false;
  trialInfo = null;
  $('serverStatus').textContent = 'Static Mode';
  $('serverStatus').className = 'status-badge offline';
  $('aiGenerateBtn').disabled = true;
  $('aiHint').textContent = 'Run npm run dashboard with GEMINI_API_KEY in .env to enable AI.';
  $('trialStatus')?.classList.add('hidden');
  return false;
}

async function loadTasks() {
  if (serverOnline) {
    const res = await fetch('/api/tasks');
    tasks = await res.json();
  }
  renderOverview();
  renderTasksTable();
  renderResults();
}

function renderOverview() {
  let totalSent = 0, totalFailed = 0, totalRecipients = 0;
  tasks.forEach(t => {
    totalRecipients += t.recipientCount;
    if (t.results) {
      totalSent += t.results.successCount || 0;
      totalFailed += t.results.failureCount || 0;
    }
  });

  $('statTasks').textContent = tasks.length;
  $('statSent').textContent = totalSent;
  $('statFailed').textContent = totalFailed;
  $('statRecipients').textContent = totalRecipients;

  const el = $('recentTasksTable');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state"><p>No tasks yet. Create your first email task.</p></div>';
    return;
  }

  el.innerHTML = `<table>
    <thead><tr><th>Task</th><th>Subject</th><th>Recipients</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>${tasks.slice(0, 5).map(t => `<tr>
      <td><strong>${esc(t.taskName)}</strong></td>
      <td>${esc(t.subject?.slice(0, 40) || '')}</td>
      <td>${t.recipientCount}</td>
      <td>${statusBadge(t)}</td>
      <td>${fmtDate(t.createdAt)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function statusBadge(t) {
  if (!t.hasResults) return '<span class="badge badge-pending">Pending</span>';
  const r = t.results;
  if (r.failureCount > 0) return `<span class="badge badge-danger">${r.failureCount} failed</span>`;
  return '<span class="badge badge-success">Sent</span>';
}

function renderTasksTable() {
  const el = $('tasksTable');
  const remainingEmails = trialInfo?.enabled ? trialInfo.remaining?.emails ?? 0 : null;
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state"><p>No tasks found. Create one or run the local server.</p></div>';
    return;
  }

  el.innerHTML = `<table>
    <thead><tr><th>Task</th><th>Subject</th><th>Recipients</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
    <tbody>${tasks.map(t => `<tr>
      <td><strong>${esc(t.taskName)}</strong><br><small style="color:var(--muted)">#${t.id}</small></td>
      <td>${esc(t.subject?.slice(0, 50) || '')}</td>
      <td>${t.recipientCount}</td>
      <td>${statusBadge(t)}</td>
      <td>${fmtDate(t.createdAt)}</td>
      <td><div class="table-actions">
        ${serverOnline && !t.hasResults ? `<button class="btn btn-success btn-sm" onclick="sendTask(${t.id})" ${(trialInfo?.enabled && (trialInfo.expired || remainingEmails < t.recipientCount)) ? 'disabled' : ''}>Send</button>` : ''}
        ${serverOnline ? `<button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id})">Delete</button>` : ''}
      </div></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderResults() {
  const el = $('resultsList');
  const withResults = tasks.filter(t => t.hasResults);
  if (!withResults.length) {
    el.innerHTML = '<div class="empty-state"><p>No delivery results yet.</p></div>';
    return;
  }

  el.innerHTML = withResults.map(t => {
    const r = t.results;
    const pct = r.totalRecipients ? Math.round((r.successCount / r.totalRecipients) * 100) : 0;
    return `<div class="result-card">
      <div class="result-card-header">
        <h3>${esc(t.taskName)}</h3>
        <span class="badge ${r.failureCount ? 'badge-danger' : 'badge-success'}">${pct}% success</span>
      </div>
      <div class="result-meta">
        <span>Sent: <strong>${r.successCount}</strong></span>
        <span>Failed: <strong>${r.failureCount}</strong></span>
        <span>Total: <strong>${r.totalRecipients}</strong></span>
        <span>Started: <strong>${fmtDate(r.startTime)}</strong></span>
        <span>Finished: <strong>${fmtDate(r.endTime)}</strong></span>
      </div>
      ${r.errors?.length ? `<ul class="error-list">${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return result;
}

function handleCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    complete(results) {
      if (!results.data?.length) return;
      if (!results.meta.fields.includes('email')) {
        showToast('CSV must contain an "email" column');
        event.target.value = '';
        return;
      }
      csvData = results.data.filter(r => r.email?.trim());
      csvColumns = results.meta.fields;
      displayRecipientsTable(csvData, csvColumns);
    },
    error() { showToast('Failed to parse CSV'); }
  });
}

function displayRecipientsTable(data, fields) {
  const preview = data.slice(0, 5);
  let html = '<table><thead><tr>';
  fields.forEach(f => { html += `<th>${esc(f)}</th>`; });
  html += '</tr></thead><tbody>';
  preview.forEach(row => {
    html += '<tr>';
    fields.forEach(f => { html += `<td>${esc(row[f] || '')}</td>`; });
    html += '</tr>';
  });
  if (data.length > 5) html += `<tr><td colspan="${fields.length}" style="color:var(--muted)">... ${data.length - 5} more rows</td></tr>`;
  html += '</tbody></table>';
  $('recipientsTable').innerHTML = html;
}

function showEmailPreview() {
  const subject = $('subject').value.trim();
  const template = $('template').value.trim();
  if (!subject || !template) return showToast('Fill in subject and template');
  if (!csvData?.length) return showToast('Upload a CSV file first');

  $('previewSubject').textContent = replaceTemplateVariables(subject, csvData[0]);
  $('previewBody').innerHTML = replaceTemplateVariables(template, csvData[0]);
  $('previewSection').classList.remove('hidden');
}

function buildTaskData() {
  const subject = $('subject').value.trim();
  const template = $('template').value.trim();
  const taskName = $('taskName').value.trim() || `email_task_${Date.now()}`;
  if (!subject || !template) { showToast('Fill in subject and template'); return null; }
  if (!csvData?.length) { showToast('Upload a CSV file first'); return null; }
  return {
    taskName,
    subject,
    template,
    recipients: csvData,
    createdAt: new Date().toISOString()
  };
}

async function generateWithAI() {
  if (!serverOnline || !aiEnabled) return showToast('AI requires server with GEMINI_API_KEY');
  const prompt = $('aiPrompt').value.trim();
  if (!prompt) return showToast('Describe your email campaign first');

  $('aiGenerateBtn').disabled = true;
  $('aiLoading').classList.remove('hidden');

  try {
    const res = await fetch('/api/ai/generate-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, csvColumns })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    $('taskName').value = data.taskName || '';
    $('subject').value = data.subject || '';
    $('template').value = data.template || '';
    showToast('AI task generated — review and save');
  } catch (err) {
    showToast(err.message);
  } finally {
    $('aiGenerateBtn').disabled = !aiEnabled;
    $('aiLoading').classList.add('hidden');
  }
}

async function saveTask() {
  taskData = buildTaskData();
  if (!taskData) return;

  if (serverOnline) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || 'Save failed');
    showToast(`Task saved: #${data.id}`);
    await loadTasks();
    navigate('tasks');
  } else {
    $('jsonDisplay').textContent = JSON.stringify(taskData, null, 2);
    $('jsonOutput').classList.remove('hidden');
    showToast('Task generated — download JSON to use');
  }
}

function downloadJSON() {
  if (!taskData) { taskData = buildTaskData(); if (!taskData) return; }
  const blob = new Blob([JSON.stringify(taskData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${taskData.taskName}.json`;
  a.click();
  showToast('JSON downloaded');
}

function copyJSON() {
  if (!taskData) return;
  navigator.clipboard.writeText(JSON.stringify(taskData, null, 2))
    .then(() => showToast('Copied to clipboard'));
}

async function sendTask(id) {
  if (!confirm(`Send emails for task #${id}?`)) return;
  showToast('Sending emails...');
  const res = await fetch(`/api/tasks/${id}/send`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Send failed');
  if (data.code === 0) showToast('Emails sent successfully');
  else showToast(`Send completed with errors`);
  await checkServer();
  await loadTasks();
  if (pageFromPath(window.location.pathname) === 'history') await loadHistory();
}

async function deleteTask(id) {
  if (!confirm(`Delete task #${id}?`)) return;
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  showToast('Task deleted');
  await loadTasks();
}

function nicheRowsToCsv(rows) {
  const escape = v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [NICHE_COLUMNS.join(',')];
  rows.forEach(r => lines.push(NICHE_COLUMNS.map(c => escape(r[c])).join(',')));
  return lines.join('\n');
}

function renderNicheMessage(data) {
  const el = $('nicheMessage');
  if (!data.message) { el.classList.add('hidden'); return; }
  const cls = data.status === 'success' ? 'success' : data.status === 'failure' ? 'error' : 'warning';
  const providerInfo = data.winningProvider ? ` Provider: <strong>${esc(data.winningProvider)}</strong>.` : '';
  const cached = data.cached ? ' (cached)' : '';
  el.className = `panel niche-message ${cls}`;
  el.innerHTML = `${esc(data.message)}${providerInfo}${cached}`;
  el.classList.remove('hidden');
}

function renderNicheStats(stats) {
  const el = $('nicheStats');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Queries Run</div><div class="stat-value">${stats.queriesRun || 0}</div></div>
    <div class="stat-card info"><div class="stat-label">Raw Results</div><div class="stat-value">${stats.rawResults || 0}</div></div>
    <div class="stat-card success"><div class="stat-label">With Email</div><div class="stat-value">${stats.withEmail || 0}</div></div>
    <div class="stat-card danger"><div class="stat-label">No Email</div><div class="stat-value">${stats.withoutEmail || 0}</div></div>`;
}

function renderNicheTable(rows, status) {
  const el = $('nicheResultsTable');
  if (!rows.length) {
    const msg = status === 'failure'
      ? 'SearXNG not configured or failed. Set SEARXNG_URL in .env.'
      : 'No results found. Try a different niche or location.';
    el.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
    return;
  }
  el.innerHTML = `<table>
    <thead><tr>${NICHE_COLUMNS.map(c => `<th>${c}</th>`).join('')}<th>Status</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      ${NICHE_COLUMNS.map(c => `<td>${esc(r[c] || '')}</td>`).join('')}
      <td>${r.email ? '<span class="badge badge-success">Ready</span>' : '<span class="badge badge-muted">No email</span>'}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function searchNiche() {
  if (!serverOnline) return showToast('Niche search requires npm run dashboard');
  const niche = $('nicheInput').value.trim();
  const location = $('locationInput').value.trim();
  const limit = parseInt($('nicheLimit').value, 10) || 50;
  if (!niche || !location) return showToast('Enter niche and location');

  $('nicheSearchBtn').disabled = true;
  $('nicheLoading').classList.remove('hidden');
  $('nicheResultsPanel').classList.add('hidden');

  try {
    const res = await fetch('/api/niche/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, location, limit })
    });
    const data = await res.json();
    if (!res.ok && !data.status) throw new Error(data.error || data.message || 'Search failed');

    nicheRows = data.rows || [];
    if (data.trial) renderTrialStatus(data.trial);
    renderNicheMessage(data);
    renderNicheStats(data.stats || {});
    renderNicheTable(nicheRows, data.status);
    $('nicheResultsPanel').classList.remove('hidden');

    if (data.status === 'failure') showToast(data.message);
    else if (data.status === 'partial_failure') showToast(data.message);
    else if (!data.stats?.withEmail) showToast('No emails found in results');
    else showToast(`Found ${data.stats.withEmail} leads with email`);
    if (pageFromPath(window.location.pathname) !== 'history') loadHistory();
  } catch (err) {
    showToast(err.message);
  } finally {
    $('nicheSearchBtn').disabled = false;
    $('nicheLoading').classList.add('hidden');
    await checkServer();
  }
}

function getNicheExportRows() {
  const skipNoEmail = $('nicheSkipNoEmail')?.checked;
  if (!skipNoEmail) return nicheRows;
  return nicheRows.filter(r => r.email?.trim());
}

async function downloadNicheCsv() {
  try {
    if (!nicheRows.length) return showToast('No results to download');
    const rows = getNicheExportRows();
    if (!rows.length) return showToast('No rows to export (all missing email)');
    if (!serverOnline) {
      const blob = new Blob([nicheRowsToCsv(rows)], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `niche_${$('nicheInput').value.trim() || 'leads'}_${Date.now()}.csv`;
      a.click();
      showToast(`CSV downloaded (${rows.length} rows)`);
      return;
    }

    const filename = `niche_${$('nicheInput').value.trim() || 'leads'}_${Date.now()}`;
    const res = await fetch('/api/niche/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed');
    }

    const blob = await res.blob();
    const exportedRows = parseInt(res.headers.get('X-Exported-Rows'), 10) || rows.length;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    showToast(`CSV downloaded (${exportedRows} rows)`);
    await checkServer();
  } catch (err) {
    showToast(err.message);
  }
}

function useNicheInCreateTask() {
  const rows = getNicheExportRows();
  if (!rows.length) return showToast('No rows to import');

  csvData = rows;
  csvColumns = NICHE_COLUMNS;
  displayRecipientsTable(csvData, csvColumns);
  navigate('create');
  showToast(`Imported ${rows.length} recipients into Create Task`);
}

async function loadHistory() {
  if (!serverOnline || !$('historyTable')) return;
  const type = $('historyFilter')?.value || 'all';
  try {
    const res = await fetch(`/api/history?type=${type}&limit=100`);
    const items = await res.json();
    renderHistoryTable(items);
  } catch {
    $('historyTable').innerHTML = '<div class="empty-state"><p>Failed to load history</p></div>';
  }
}

function renderHistoryTable(items) {
  const el = $('historyTable');
  if (!items.length) {
    el.innerHTML = '<div class="empty-state"><p>No activity yet.</p></div>';
    return;
  }
  el.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Type</th><th>Summary</th><th>Actions</th></tr></thead>
    <tbody>${items.map(item => `<tr>
      <td>${fmtDate(item.createdAt)}</td>
      <td><span class="badge badge-muted">${esc(TYPE_LABELS[item.type] || item.type)}</span></td>
      <td>${esc(item.summary)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewHistoryDetail('${item.type}', ${item.refId})">View</button>
      ${item.type === 'niche_search' ? `<button class="btn btn-ghost btn-sm" onclick="rerunNicheFromHistory(${item.refId})">Re-run</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}

function showModal(title, bodyHtml, actions = []) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  const actionsEl = $('modalActions');
  actionsEl.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = `btn ${a.cls || 'btn-secondary'}`;
    btn.textContent = a.label;
    btn.addEventListener('click', a.onClick);
    actionsEl.appendChild(btn);
  });
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

async function viewHistoryDetail(type, refId) {
  try {
    const res = await fetch(`/api/history/${type}/${refId}`);
    const { data } = await res.json();
    if (!data) return showToast('Not found');

    let body = '';
    if (type === 'niche_search') {
      body = `<p><strong>${esc(data.niche)}</strong> in <strong>${esc(data.location)}</strong></p>
        <p>${esc(data.message || '')}</p>
        <p>Leads: ${data.rows?.length || 0} (${data.stats?.withEmail || 0} with email)</p>
        <div class="table-wrap">${renderNicheTableHtml(data.rows || [])}</div>`;
    } else if (type === 'task_created') {
      body = `<p><strong>${esc(data.taskName)}</strong> (#${data.id})</p>
        <p>Subject: ${esc(data.subject)}</p>
        <p>Recipients: ${data.recipients?.length || 0}</p>
        <p>Created: ${fmtDate(data.createdAt)}</p>`;
    } else if (type === 'email_sent') {
      body = `<p><strong>${esc(data.taskName)}</strong></p>
        <p>Sent: ${data.successCount} / Failed: ${data.failureCount} / Total: ${data.totalRecipients}</p>
        <p>Started: ${fmtDate(data.startTime)} — Finished: ${fmtDate(data.endTime)}</p>
        ${data.errors?.length ? `<ul class="error-list">${data.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
    }

    showModal(TYPE_LABELS[type] || 'Detail', body, [{ label: 'Close', onClick: closeModal }]);
  } catch (err) {
    showToast(err.message);
  }
}

async function rerunNicheFromHistory(searchId) {
  try {
    const res = await fetch(`/api/history/niche_search/${searchId}`);
    const { data } = await res.json();
    if (!data) return showToast('Search not found');
    $('nicheInput').value = data.niche;
    $('locationInput').value = data.location;
    $('nicheLimit').value = String(data.limit || 50);
    navigate('niche');
    showToast('Form prefilled — click Search');
  } catch (err) {
    showToast(err.message);
  }
}

function renderNicheTableHtml(rows) {
  if (!rows.length) return '<p>No leads</p>';
  return `<table>
    <thead><tr>${NICHE_COLUMNS.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>
      ${NICHE_COLUMNS.map(c => `<td>${esc(r[c] || '')}</td>`).join('')}
    </tr>`).join('')}</tbody></table>`;
}

function initEventListeners() {
  document.querySelectorAll('.nav-item[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.goto));
  });
  window.addEventListener('popstate', () => navigateFromUrl());

  $('csvFile').addEventListener('change', handleCSVUpload);
  $('aiGenerateBtn').addEventListener('click', generateWithAI);
  $('previewBtn').addEventListener('click', showEmailPreview);
  $('closePreviewBtn').addEventListener('click', () => $('previewSection').classList.add('hidden'));
  $('generateBtn').addEventListener('click', saveTask);
  $('downloadBtn').addEventListener('click', downloadJSON);
  $('copyBtn').addEventListener('click', copyJSON);
  $('refreshBtn').addEventListener('click', async () => {
    await checkServer();
    await loadTasks();
    if (pageFromPath(window.location.pathname) === 'history') await loadHistory();
    showToast('Refreshed');
  });
  $('themeToggle')?.addEventListener('change', toggleTheme);
  $('nicheSearchBtn').addEventListener('click', searchNiche);
  $('nicheDownloadBtn').addEventListener('click', downloadNicheCsv);
  $('nicheUseBtn').addEventListener('click', useNicheInCreateTask);
  $('historyFilter')?.addEventListener('change', loadHistory);
  $('modalClose')?.addEventListener('click', closeModal);
  $('modal')?.addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
}

document.addEventListener('DOMContentLoaded', async () => {
  loadThemePreference();
  initEventListeners();
  await checkServer();
  await loadTasks();
  navigateFromUrl();
});
