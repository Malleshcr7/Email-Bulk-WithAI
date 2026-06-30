const { query } = require('../../db');
const { getNicheSearchById } = require('./niche');
const { getTaskById } = require('./tasks');
const { getSendResultById } = require('./sends');

const TYPE_MAP = {
  all: null,
  niche: 'niche_search',
  task: 'task_created',
  send: 'email_sent'
};

async function listHistory({ type = 'all', limit = 50 } = {}) {
  const dbType = TYPE_MAP[type] || null;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  let sql = 'SELECT id, type, ref_id AS refId, summary, created_at AS createdAt FROM activity_log';
  const params = [];
  if (dbType) {
    sql += ' WHERE type = ?';
    params.push(dbType);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${lim}`;

  return query(sql, params);
}

async function getHistoryDetail(type, id) {
  const refId = parseInt(id, 10);
  if (!refId) return null;

  switch (type) {
    case 'niche_search':
      return { type, data: await getNicheSearchById(refId) };
    case 'task_created':
      return { type, data: await getTaskById(refId) };
    case 'email_sent':
      return { type, data: await getSendResultById(refId) };
    default:
      return null;
  }
}

module.exports = { listHistory, getHistoryDetail };
