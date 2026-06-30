const COLUMNS = ['name', 'email', 'company', 'website', 'niche', 'source'];

function escapeCell(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map(col => escapeCell(row[col])).join(','));
  }
  return lines.join('\n');
}

module.exports = { COLUMNS, rowsToCsv };
