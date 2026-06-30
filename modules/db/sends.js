const { query } = require('../../db');
const { logActivity } = require('./activity');

async function saveSendResult(taskId, results) {
  const insert = await query(
    `INSERT INTO send_results (task_id, success_count, failure_count, total_recipients, errors, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      results.successCount,
      results.failureCount,
      results.totalRecipients,
      JSON.stringify(results.errors || []),
      new Date(results.startTime),
      new Date(results.endTime)
    ]
  );

  const summary = `Sent ${results.successCount}/${results.totalRecipients} emails (${results.failureCount} failed)`;
  await logActivity('email_sent', insert.insertId, summary);

  return insert.insertId;
}

async function getSendResultById(id) {
  const rows = await query(`
    SELECT sr.*, t.task_name, t.subject
    FROM send_results sr
    JOIN tasks t ON t.id = sr.task_id
    WHERE sr.id = ?
  `, [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    taskId: r.task_id,
    taskName: r.task_name,
    subject: r.subject,
    successCount: r.success_count,
    failureCount: r.failure_count,
    totalRecipients: r.total_recipients,
    errors: r.errors ? (typeof r.errors === 'string' ? JSON.parse(r.errors) : r.errors) : [],
    startTime: r.started_at,
    endTime: r.ended_at
  };
}

module.exports = { saveSendResult, getSendResultById };
