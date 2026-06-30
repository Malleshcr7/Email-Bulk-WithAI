const { query } = require('../../db');
const { logActivity } = require('./activity');

const KNOWN_FIELDS = new Set(['name', 'email', 'company']);

function splitRecipient(r) {
  const extra = {};
  for (const [k, v] of Object.entries(r)) {
    if (!KNOWN_FIELDS.has(k)) extra[k] = v;
  }
  return {
    name: r.name || '',
    email: r.email || '',
    company: r.company || '',
    extra: Object.keys(extra).length ? JSON.stringify(extra) : null
  };
}

function mergeRecipient(row) {
  const base = { name: row.name, email: row.email, company: row.company };
  if (row.extra) {
    const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
    Object.assign(base, extra);
  }
  return base;
}

async function listTasks() {
  const tasks = await query(`
    SELECT t.id, t.task_name AS taskName, t.subject, t.created_at AS createdAt,
      (SELECT COUNT(*) FROM recipients r WHERE r.task_id = t.id) AS recipientCount,
      sr.id AS sendResultId, sr.success_count AS successCount, sr.failure_count AS failureCount,
      sr.total_recipients AS totalRecipients, sr.errors, sr.started_at AS startTime, sr.ended_at AS endTime
    FROM tasks t
    LEFT JOIN send_results sr ON sr.task_id = t.id
      AND sr.id = (SELECT MAX(sr2.id) FROM send_results sr2 WHERE sr2.task_id = t.id)
    ORDER BY t.created_at DESC
  `);

  return tasks.map(t => {
    const hasResults = !!t.sendResultId;
    let results = null;
    if (hasResults) {
      results = {
        successCount: t.successCount,
        failureCount: t.failureCount,
        totalRecipients: t.totalRecipients,
        errors: t.errors ? (typeof t.errors === 'string' ? JSON.parse(t.errors) : t.errors) : [],
        startTime: t.startTime,
        endTime: t.endTime
      };
    }
    return {
      id: t.id,
      taskName: t.taskName,
      subject: t.subject,
      recipientCount: t.recipientCount,
      createdAt: t.createdAt,
      hasResults,
      results
    };
  });
}

async function getTaskById(id) {
  const rows = await query('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!rows.length) return null;
  const task = rows[0];
  const recipients = await query('SELECT name, email, company, extra FROM recipients WHERE task_id = ?', [id]);
  return {
    id: task.id,
    taskName: task.task_name,
    subject: task.subject,
    template: task.template,
    createdAt: task.created_at,
    recipients: recipients.map(mergeRecipient)
  };
}

async function createTask({ taskName, subject, template, recipients }) {
  const name = (taskName || `email_task_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const result = await query(
    'INSERT INTO tasks (task_name, subject, template) VALUES (?, ?, ?)',
    [name, subject, template]
  );
  const taskId = result.insertId;

  for (const r of recipients) {
    const rec = splitRecipient(r);
    await query(
      'INSERT INTO recipients (task_id, name, email, company, extra) VALUES (?, ?, ?, ?, ?)',
      [taskId, rec.name, rec.email, rec.company, rec.extra]
    );
  }

  const summary = `Task ${name} created (${recipients.length} recipients)`;
  await logActivity('task_created', taskId, summary);

  return { id: taskId, taskName: name, subject, template, recipients, createdAt: new Date().toISOString() };
}

async function deleteTask(id) {
  await query('DELETE FROM tasks WHERE id = ?', [id]);
}

module.exports = { listTasks, getTaskById, createTask, deleteTask, mergeRecipient };
