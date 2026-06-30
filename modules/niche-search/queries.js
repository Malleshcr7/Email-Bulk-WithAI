const QUERY_TEMPLATES = [
  '{niche} in {location}',
  'best {niche} in {location}',
  '{niche} near {location}',
  '{niche} {location} official website',
  '{niche} clinics {location}'
];

function buildQueries(niche, location) {
  return QUERY_TEMPLATES.map(t =>
    t.replace('{niche}', niche).replace('{location}', location)
  );
}

module.exports = { QUERY_TEMPLATES, buildQueries };
