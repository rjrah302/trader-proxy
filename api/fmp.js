const FMP_ORIGIN = 'https://financialmodelingprep.com';
const ALLOWED_PREFIXES = [
  '/stable/',
  '/api/v3/',
  '/api/v4/',
];

function cacheSeconds(path) {
  if (path.includes('/historical-chart/') || path.includes('/quote') || path.includes('/aftermarket-quote')) return 20;
  if (path.includes('/news/') || path.includes('/earning-calendar') || path.includes('/earning_calendar')) return 300;
  if (path.includes('/historical-price') || path.includes('/profile') || path.includes('/rating') || path.includes('/price-target')) return 900;
  return 60;
}

function isOptionalEndpoint(path) {
  return path.includes('/earning-calendar')
    || path.includes('/earning_calendar')
    || path.includes('/rating/')
    || path.includes('/ratings');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const rawPath = String(req.query.path || '');
    if (!rawPath || !rawPath.startsWith('/')) {
      return res.status(400).json({ ok: false, error: 'Missing FMP path' });
    }

    const decodedPath = decodeURIComponent(rawPath);
    if (!ALLOWED_PREFIXES.some(prefix => decodedPath.startsWith(prefix))) {
      return res.status(403).json({ ok: false, error: 'Blocked FMP path' });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Missing FMP_API_KEY' });
    }

    const url = new URL(FMP_ORIGIN + decodedPath);
    url.searchParams.set('apikey', apiKey);

    const upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    const text = await upstream.text();
    const maxAge = cacheSeconds(url.pathname);

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=${Math.max(maxAge * 3, 60)}`);
    if ((upstream.status === 403 || upstream.status === 404) && isOptionalEndpoint(url.pathname)) {
      return res.status(200).json([]);
    }
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'FMP proxy error' });
  }
};
