const { query } = require('../../db');
const { logActivity } = require('./activity');

async function saveNicheSearch(result, { niche, location, limit }) {
  const insert = await query(
    `INSERT INTO niche_searches (niche, location, result_limit, status, message, winning_provider, stats)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      niche,
      location,
      limit,
      result.status,
      result.message || '',
      result.winningProvider || null,
      JSON.stringify(result.stats || {})
    ]
  );
  const searchId = insert.insertId;

  for (const row of result.rows || []) {
    await query(
      `INSERT INTO niche_leads (search_id, name, email, company, website, niche, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [searchId, row.name || '', row.email || '', row.company || '', row.website || '', row.niche || niche, row.source || '']
    );
  }

  const withEmail = result.stats?.withEmail || 0;
  const summary = `${niche} in ${location} — ${withEmail} with email`;
  await logActivity('niche_search', searchId, summary);

  return searchId;
}

async function getNicheSearchById(id) {
  const rows = await query('SELECT * FROM niche_searches WHERE id = ?', [id]);
  if (!rows.length) return null;
  const s = rows[0];
  const leads = await query('SELECT name, email, company, website, niche, source FROM niche_leads WHERE search_id = ?', [id]);
  return {
    id: s.id,
    niche: s.niche,
    location: s.location,
    limit: s.result_limit,
    status: s.status,
    message: s.message,
    winningProvider: s.winning_provider,
    stats: s.stats ? (typeof s.stats === 'string' ? JSON.parse(s.stats) : s.stats) : {},
    createdAt: s.created_at,
    rows: leads
  };
}

module.exports = { saveNicheSearch, getNicheSearchById };
