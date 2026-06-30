const { log, warn } = require('../logger');
const { buildQueries } = require('../queries');
const { searxngProvider } = require('./apis');

function getSearxngConfig(env = process.env) {
  return { url: (env.SEARXNG_URL || '').trim() };
}

function getProviders(env = process.env) {
  const { url } = getSearxngConfig(env);
  const provider = searxngProvider(url);
  return provider.isConfigured() ? [provider] : [];
}

function listConfiguredProviders(env = process.env) {
  return getProviders(env).map(p => p.name);
}

function isSearxngConfigured(env = process.env) {
  return !!getSearxngConfig(env).url;
}

async function searchWithProviders(niche, location) {
  const queries = buildQueries(niche, location);
  const providers = getProviders();
  const providerLog = [];
  let allResults = [];
  let winningProvider = null;

  if (!providers.length) {
    const msg = 'SearXNG not configured. Set SEARXNG_URL in .env';
    warn(msg);
    return {
      results: [],
      providerLog: [{ name: 'searxng', status: 'error', error: msg }],
      queriesRun: queries.length,
      winningProvider: null
    };
  }

  log(`Using SearXNG (${queries.length} queries)`);

  for (const provider of providers) {
    try {
      log(`Trying provider: ${provider.name}`);
      const { results } = await provider.search(niche, location, queries);
      providerLog.push({ name: provider.name, status: 'ok', resultCount: results.length });
      allResults = results;
      winningProvider = provider.name;
      log(`SearXNG returned ${results.length} results`);
    } catch (err) {
      providerLog.push({ name: provider.name, status: 'error', resultCount: 0, error: err.message });
      warn(`SearXNG failed: ${err.message}`);
    }
  }

  return { results: allResults, providerLog, queriesRun: queries.length, winningProvider };
}

module.exports = { searchWithProviders, getProviders, listConfiguredProviders, isSearxngConfigured };
