const { query } = require('../db');

let schemaReady = false;

class TrialLimitError extends Error {
  constructor(message, code, status = 403, trial = null) {
    super(message);
    this.name = 'TrialLimitError';
    this.code = code;
    this.status = status;
    this.trial = trial;
  }
}

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getTrialConfig(env = process.env) {
  return {
    enabled: parseBool(env.TRIAL_ENABLED, true),
    plan: env.TRIAL_PLAN_NAME || 'trial',
    durationDays: parsePositiveInt(env.TRIAL_DURATION_DAYS, 14),
    maxSearches: parsePositiveInt(env.TRIAL_MAX_SEARCHES, 3),
    maxExportRows: parsePositiveInt(env.TRIAL_MAX_EXPORT_ROWS, 25),
    maxEmails: parsePositiveInt(env.TRIAL_MAX_EMAILS, 10)
  };
}

async function ensureTrialSchema() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS trial_usage (
      id TINYINT PRIMARY KEY,
      plan VARCHAR(50) NOT NULL DEFAULT 'trial',
      started_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      searches_used INT NOT NULL DEFAULT 0,
      export_rows_used INT NOT NULL DEFAULT 0,
      emails_sent INT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  schemaReady = true;
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function ensureTrialRow(config = getTrialConfig()) {
  await ensureTrialSchema();
  const rows = await query('SELECT * FROM trial_usage WHERE id = 1');
  if (rows.length) return rows[0];

  const startedAt = new Date();
  const expiresAt = addDays(config.durationDays);
  await query(
    `INSERT INTO trial_usage (id, plan, started_at, expires_at, searches_used, export_rows_used, emails_sent)
     VALUES (1, ?, ?, ?, 0, 0, 0)`,
    [config.plan, startedAt, expiresAt]
  );
  const inserted = await query('SELECT * FROM trial_usage WHERE id = 1');
  return inserted[0];
}

function formatTrialStatus(row, config = getTrialConfig()) {
  if (!config.enabled) {
    return {
      enabled: false,
      plan: config.plan,
      startedAt: null,
      expiresAt: null,
      expired: false,
      limits: {
        searches: config.maxSearches,
        exportRows: config.maxExportRows,
        emails: config.maxEmails
      },
      usage: { searches: 0, exportRows: 0, emails: 0 },
      remaining: { searches: null, exportRows: null, emails: null }
    };
  }

  const startedAt = row.started_at instanceof Date ? row.started_at : new Date(row.started_at);
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  const now = Date.now();
  const expired = Number.isFinite(expiresAt.getTime()) && now > expiresAt.getTime();

  return {
    enabled: true,
    plan: row.plan || config.plan,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expired,
    limits: {
      searches: config.maxSearches,
      exportRows: config.maxExportRows,
      emails: config.maxEmails
    },
    usage: {
      searches: row.searches_used || 0,
      exportRows: row.export_rows_used || 0,
      emails: row.emails_sent || 0
    },
    remaining: {
      searches: Math.max(config.maxSearches - (row.searches_used || 0), 0),
      exportRows: Math.max(config.maxExportRows - (row.export_rows_used || 0), 0),
      emails: Math.max(config.maxEmails - (row.emails_sent || 0), 0)
    }
  };
}

async function getTrialStatus() {
  const config = getTrialConfig();
  if (!config.enabled) return formatTrialStatus({}, config);
  const row = await ensureTrialRow(config);
  return formatTrialStatus(row, config);
}

function createExpiredError(trial) {
  return new TrialLimitError(
    `Free trial expired on ${new Date(trial.expiresAt).toLocaleDateString()}. Contact us to unlock Starter or Pro access.`,
    'trial_expired',
    403,
    trial
  );
}

async function assertTrialActive() {
  const trial = await getTrialStatus();
  if (trial.enabled && trial.expired) throw createExpiredError(trial);
  return trial;
}

async function assertCanUseSearch() {
  const trial = await assertTrialActive();
  if (trial.enabled && trial.remaining.searches <= 0) {
    throw new TrialLimitError(
      `Free trial search limit reached (${trial.limits.searches}). Contact us to unlock more searches.`,
      'trial_search_limit',
      403,
      trial
    );
  }
  return trial;
}

async function recordSearchUsage(count = 1) {
  const trial = await assertTrialActive();
  if (!trial.enabled || count <= 0) return trial;
  await query('UPDATE trial_usage SET searches_used = searches_used + ? WHERE id = 1', [count]);
  return getTrialStatus();
}

async function reserveExportRows(requestedCount) {
  const trial = await assertTrialActive();
  if (!trial.enabled) return { allowedRows: requestedCount, trial };

  const requested = Math.max(parseInt(requestedCount, 10) || 0, 0);
  if (requested <= 0) {
    throw new TrialLimitError('No rows selected for export.', 'trial_export_empty', 400, trial);
  }

  const allowedRows = Math.min(requested, trial.remaining.exportRows);
  if (allowedRows <= 0) {
    throw new TrialLimitError(
      `Free trial export limit reached (${trial.limits.exportRows} rows). Contact us to unlock full CSV exports.`,
      'trial_export_limit',
      403,
      trial
    );
  }

  await query('UPDATE trial_usage SET export_rows_used = export_rows_used + ? WHERE id = 1', [allowedRows]);
  return { allowedRows, trial: await getTrialStatus() };
}

async function assertCanSendEmails(recipientCount) {
  const trial = await assertTrialActive();
  if (!trial.enabled) return trial;
  const needed = Math.max(parseInt(recipientCount, 10) || 0, 0);

  if (needed <= 0) {
    throw new TrialLimitError('Task has no recipients to send.', 'trial_send_empty', 400, trial);
  }

  if (trial.remaining.emails <= 0) {
    throw new TrialLimitError(
      `Free trial email limit reached (${trial.limits.emails}). Contact us to unlock sending.`,
      'trial_email_limit',
      403,
      trial
    );
  }

  if (needed > trial.remaining.emails) {
    throw new TrialLimitError(
      `This task has ${needed} recipients, but only ${trial.remaining.emails} trial emails remain.`,
      'trial_email_task_too_large',
      403,
      trial
    );
  }

  return trial;
}

async function recordEmailsSent(count) {
  const trial = await assertTrialActive();
  if (!trial.enabled) return trial;
  const used = Math.max(parseInt(count, 10) || 0, 0);
  if (used <= 0) return trial;
  await query('UPDATE trial_usage SET emails_sent = emails_sent + ? WHERE id = 1', [used]);
  return getTrialStatus();
}

module.exports = {
  TrialLimitError,
  getTrialConfig,
  getTrialStatus,
  assertCanUseSearch,
  recordSearchUsage,
  reserveExportRows,
  assertCanSendEmails,
  recordEmailsSent
};
