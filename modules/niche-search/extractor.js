const { log } = require('./logger');
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_EMAIL_DOMAINS = ['example.com', 'sentry.io', 'wixpress.com', 'schema.org', 'duckduckgo.com', 'google.com', 'facebook.com', 'twitter.com'];

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function getDomain(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isValidEmail(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1];
  if (!domain || SKIP_EMAIL_DOMAINS.some(d => domain.endsWith(d))) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(lower)) return false;
  return true;
}

function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  return [...new Set(matches.filter(isValidEmail))];
}

function parseCompanyFromTitle(title, domain) {
  if (!title) return domain || '';
  const generic = /^(contact\s*us|home|about|welcome)$/i;
  let company = title
    .replace(/\s*[-|–—]\s*.+$/, '')
    .replace(/\s*\|\s*.+$/, '')
    .trim();
  if (generic.test(company) && domain) {
    company = domain.replace(/\.\w+$/, '').replace(/[-_]/g, ' ');
  }
  if (company.length > 80) company = company.slice(0, 80);
  return company || domain;
}

function parseNameFromTitle(title, company) {
  const contactMatch = title.match(/(?:contact|dr\.?|mr\.?|ms\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (contactMatch) return contactMatch[1];
  return company;
}

function buildLead(result, niche) {
  const website = normalizeUrl(result.url);
  const domain = getDomain(website);
  const company = parseCompanyFromTitle(result.title, domain);
  const snippetEmails = extractEmails(`${result.title} ${result.description}`);
  const email = snippetEmails[0] || '';

  return {
    name: parseNameFromTitle(result.title, company),
    email,
    company,
    website,
    niche,
    source: result.source,
    _domain: domain
  };
}

const domainLastFetch = new Map();
const FETCH_TIMEOUT = 8000;
const MAX_CONCURRENT = 5;

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BulkEmailBot/1.0)' },
      redirect: 'follow'
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEmailFromWebsite(website) {
  const domain = getDomain(website);
  if (!domain) return '';

  const last = domainLastFetch.get(domain) || 0;
  const wait = Math.max(0, 1000 - (Date.now() - last));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  domainLastFetch.set(domain, Date.now());

  const base = website.replace(/\/$/, '');
  const paths = ['', '/contact', '/contact-us', '/about', '/about-us'];
  for (const path of paths) {
    const html = await fetchPage(`${base}${path}`);
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (mailto && isValidEmail(mailto[1])) return mailto[1];
    const emails = extractEmails(html);
    if (emails.length) return emails[0];
  }
  return '';
}

async function enrichLeadsWithEmails(leads) {
  const needsEmail = leads.filter(l => !l.email && l.website);
  if (!needsEmail.length) return leads;
  let found = 0;
  const queue = [...needsEmail];
  const workers = Array.from({ length: MAX_CONCURRENT }, async () => {
    while (queue.length) {
      const lead = queue.shift();
      lead.email = await fetchEmailFromWebsite(lead.website);
      if (lead.email) {
        found++;
        log(`  found email ${lead.email} @ ${lead.website}`);
      }
    }
  });
  await Promise.all(workers);
  log(`Website scan complete: ${found}/${needsEmail.length} emails found`);
  return leads;
}

async function enrichWithGemini(leads, geminiFn) {
  if (!geminiFn) return leads;
  const toEnrich = leads.filter(l => !l.email && l.company);
  if (!toEnrich.length) return leads;

  try {
    const enriched = await geminiFn(toEnrich.slice(0, 20));
    for (const item of enriched) {
      const lead = leads.find(l => l.website === item.website || l.company === item.company);
      if (lead && item.email && isValidEmail(item.email)) {
        lead.email = item.email;
        if (item.name) lead.name = item.name;
        if (item.company) lead.company = item.company;
      }
    }
  } catch (err) {
    console.error('Gemini enrichment failed:', err.message);
  }
  return leads;
}

function dedupeLeads(leads) {
  const seen = new Set();
  const out = [];
  for (const lead of leads) {
    const key = lead.email
      ? lead.email.toLowerCase()
      : `${lead._domain || lead.website}|${lead.company}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { _domain, ...clean } = lead;
    out.push(clean);
  }
  return out;
}

module.exports = {
  buildLead,
  enrichLeadsWithEmails,
  enrichWithGemini,
  dedupeLeads,
  isValidEmail
};
