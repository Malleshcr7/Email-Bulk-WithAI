const { query } = require('../../db');

async function logActivity(type, refId, summary) {
  const result = await query(
    'INSERT INTO activity_log (type, ref_id, summary) VALUES (?, ?, ?)',
    [type, refId, summary.slice(0, 512)]
  );
  return result.insertId;
}

module.exports = { logActivity };
