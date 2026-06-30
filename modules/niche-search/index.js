const { buildLead, enrichLeadsWithEmails, enrichWithGemini, dedupeLeads } = require('./extractor');
const { searchWithProviders } = require('./providers');
const cache = require('./cache');
const { log, warn } = require('./logger');

async function createGeminiEnricher(apiKey, model) {
  if (!apiKey) return null;

  return async function enrichLeads(leads) {
    log(`Gemini enrichment for ${Math.min(leads.length, 20)} leads...`);
    const prompt = `Extract business contact info from these search results. Return JSON array with objects: { website, name, email, company }.
Only include email if clearly present in the data. Do not invent emails.

Data:
${JSON.stringify(leads.map(l => ({ title: l.company, website: l.website, snippet: l.source })), null, 2)}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  website: { type: 'string' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  company: { type: 'string' }
                }
              }
            }
          }
        })
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Gemini failed');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const enriched = text ? JSON.parse(text) : [];
    log(`Gemini returned ${enriched.length} enriched records`);
    return enriched;
  };
}

function buildResponse(status, message, rows, stats, extra = {}) {
  return { status, message, rows, stats, ...extra };
}

function shouldCacheResponse(response) {
  return response.stats?.returned > 0;
}

async function searchNicheLeads({ niche, location, limit = 50, geminiApiKey, geminiModel, skipCache = false }) {
  log(`=== Search started: "${niche}" in "${location}" (limit ${limit}) ===`);

  if (!skipCache) {
    const cached = cache.get(niche, location, limit);
    if (cached) {
      log('Cache hit — returning cached results');
      return buildResponse(cached.status, cached.message, cached.rows, cached.stats, {
        providers: cached.providers,
        cached: true,
        winningProvider: cached.winningProvider
      });
    }
  }

  const { results: rawResults, providerLog, queriesRun, winningProvider } =
    await searchWithProviders(niche, location);

  const allBlocked = providerLog.length > 0 && providerLog.every(p => p.status === 'blocked');
  const allFailed = rawResults.length === 0;

  if (allBlocked) {
    const msg = 'Search failed. Check SEARXNG_URL in .env and ensure JSON format is enabled on your SearXNG instance.';
    warn(msg);
    const stats = { queriesRun, rawResults: 0, uniqueLeads: 0, returned: 0, withEmail: 0, withoutEmail: 0, blockedCount: providerLog.length };
    const response = buildResponse('failure', msg, [], stats, { providers: providerLog, winningProvider: null, cached: false });
    if (shouldCacheResponse(response)) cache.set(niche, location, limit, response);
    return response;
  }

  if (allFailed) {
    const notConfigured = providerLog.some(p => p.error?.includes('not configured'));
    const msg = notConfigured
      ? 'SearXNG not configured. Set SEARXNG_URL in .env and restart server.'
      : providerLog.find(p => p.error)?.error || 'No search results found. Try a different niche/location or verify your SearXNG setup.';
    const status = notConfigured ? 'failure' : 'partial_failure';
    const stats = { queriesRun, rawResults: 0, uniqueLeads: 0, returned: 0, withEmail: 0, withoutEmail: 0, blockedCount: providerLog.filter(p => p.status === 'blocked').length };
    const response = buildResponse(status, msg, [], stats, { providers: providerLog, winningProvider: null, cached: false });
    if (shouldCacheResponse(response)) cache.set(niche, location, limit, response);
    return response;
  }

  let leads = rawResults.map(r => buildLead(r, niche));
  leads = dedupeLeads(leads);
  log(`Built ${leads.length} unique leads from ${rawResults.length} raw results (provider: ${winningProvider})`);

  const needsEmail = leads.filter(l => !l.email && l.website).length;
  log(`Email extraction: ${needsEmail} websites to scan...`);
  await enrichLeadsWithEmails(leads);
  log(`After website scan: ${leads.filter(l => l.email).length} leads with email`);

  const geminiFn = await createGeminiEnricher(geminiApiKey, geminiModel);
  if (geminiFn) {
    leads = await enrichWithGemini(leads, geminiFn);
    leads = dedupeLeads(leads);
    log(`After Gemini: ${leads.filter(l => l.email).length} leads with email`);
  }

  leads.sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0));
  const trimmed = leads.slice(0, limit);
  const withEmail = trimmed.filter(l => l.email).length;

  const stats = {
    queriesRun,
    rawResults: rawResults.length,
    uniqueLeads: leads.length,
    returned: trimmed.length,
    withEmail,
    withoutEmail: trimmed.length - withEmail,
    blockedCount: providerLog.filter(p => p.status === 'blocked').length
  };

  const hadBlockedFallback = providerLog.some(p => p.status === 'blocked') && winningProvider;
  let status = 'success';
  let message = `Found ${trimmed.length} leads via ${winningProvider} (${withEmail} with email).`;

  if (withEmail === 0 && trimmed.length > 0) {
    status = 'partial_failure';
    message = `Found ${trimmed.length} businesses but no emails. Websites were crawled — try a different niche or add more providers.`;
  } else if (hadBlockedFallback) {
    status = 'partial_failure';
    message = `Results from ${winningProvider} after earlier providers were blocked. ${withEmail} leads with email.`;
  }

  log(`=== Search complete [${status}]: ${message} ===`);

  const response = buildResponse(status, message, trimmed, stats, {
    providers: providerLog,
    winningProvider,
    cached: false
  });
  if (shouldCacheResponse(response)) cache.set(niche, location, limit, response);
  return response;
}

module.exports = { searchNicheLeads };
