const { log } = require('../logger');
const { SearchProviderError } = require('../errors');

const SEARXNG_TIMEOUT_MS = 10000;

function mapResults(items, source) {
  return (items || []).map(r => ({
    title: r.title || '',
    description: r.content || '',
    url: r.url || '',
    source
  })).filter(r => r.url && r.title);
}

function friendlyError(status, data) {
  if (status === 403) {
    return 'JSON format disabled on SearXNG instance — enable json in settings.yml search.formats';
  }
  if (data?.error) return data.error;
  return `SearXNG request failed (HTTP ${status})`;
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function buildCandidateBaseUrls(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const candidates = [normalizeBaseUrl(url.toString())];

    // In local development, SearXNG is often exposed via a different loopback
    // alias than the one configured in .env.
    if (url.hostname === 'localhost') {
      const hostnames = ['127.0.0.1', '[::1]', 'host.docker.internal', 'gateway.docker.internal'];
      for (const hostname of hostnames) {
        const candidate = new URL(url.toString());
        candidate.hostname = hostname;
        candidates.push(normalizeBaseUrl(candidate.toString()));
      }
    }

    return [...new Set(candidates)];
  } catch {
    return [normalizeBaseUrl(baseUrl)].filter(Boolean);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARXNG_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new SearchProviderError('searxng', `Invalid JSON response from SearXNG (HTTP ${res.status})`);
    }
    return { ok: res.ok, data, status: res.status };
  } catch (err) {
    if (err instanceof SearchProviderError) throw err;
    if (err.name === 'AbortError') {
      throw new SearchProviderError('searxng', `SearXNG request timed out after ${SEARXNG_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearxngQuery(baseUrl, query, pageno = 1) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    pageno: String(pageno)
  });

  const candidates = buildCandidateBaseUrls(baseUrl);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidateBaseUrl = candidates[i];
    const requestUrl = `${candidateBaseUrl}/search?${params}`;

    try {
      if (i > 0) log(`[SearXNG] primary request failed, retrying via ${candidateBaseUrl}`);
      return await fetchJson(requestUrl);
    } catch (err) {
      if (err instanceof SearchProviderError) throw err;
      lastError = err;
    }
  }

  throw new SearchProviderError(
    'searxng',
    `Unable to connect to SearXNG. Tried: ${candidates.join(', ')}. Check that the service is running and reachable from this app.${lastError?.message ? ` Last error: ${lastError.message}` : ''}`
  );
}

function searxngProvider(baseUrl) {
  const url = normalizeBaseUrl(baseUrl);

  return {
    name: 'searxng',
    isConfigured: () => !!url,
    async search(niche, location, queries) {
      const allResults = [];
      const seen = new Set();

      log(`[SearXNG] using ${url}`);

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        log(`[SearXNG] query ${i + 1}/${queries.length}: "${query}"`);

        const { ok, data, status } = await fetchSearxngQuery(url, query);
        if (!ok) throw new SearchProviderError('searxng', friendlyError(status, data));

        const batch = mapResults(data.results, `searxng:${query}`);
        log(`[SearXNG]   → ${batch.length} results`);

        for (const r of batch) {
          const key = r.url.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          allResults.push(r);
        }

        if (i < queries.length - 1) await new Promise(r => setTimeout(r, 300));
      }

      log(`[SearXNG] total unique results: ${allResults.length}`);
      return { results: allResults };
    }
  };
}

module.exports = { searxngProvider };
