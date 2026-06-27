const FMP_ORIGIN = 'https://financialmodelingprep.com';

function normalizeQuote(q) {
  const price = parseFloat(q?.price);
  if (!q?.symbol || !(price > 0)) return null;
  return {
    symbol: q.symbol,
    regularMarketPrice: price,
    regularMarketChangePercent: parseFloat(q.changePercentage ?? q.changesPercentage ?? q.change ?? 0),
    regularMarketVolume: parseInt(q.volume ?? 0),
    regularMarketDayHigh: parseFloat(q.dayHigh ?? q.high ?? price),
    regularMarketDayLow: parseFloat(q.dayLow ?? q.low ?? price),
    avgVolume: parseInt(q.avgVolume ?? q.averageVolume ?? q.volume ?? 0),
  };
}

function calcTrend(spyChange, qqqChange) {
  if (spyChange == null || qqqChange == null) return null;
  const avg = (spyChange + qqqChange) / 2;
  return avg >= 0.3 ? 'bullish' : avg <= -1.5 ? 'bearish' : 'neutral';
}

async function fetchQuoteBatch(symbols, apiKey) {
  const all = [];
  const BATCH = 50;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH).join(',');
    const url = new URL(FMP_ORIGIN + '/stable/quote');
    url.searchParams.set('symbol', batch);
    url.searchParams.set('apikey', apiKey);

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) continue;
    const data = await r.json().catch(() => null);
    if (Array.isArray(data)) all.push(...data.map(normalizeQuote).filter(Boolean));
  }

  return all;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');

  try {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Missing FMP_API_KEY' });
    }

    const rawSymbols = String(req.query.symbols || '')
      .split(',')
      .map(s => s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, ''))
      .filter(Boolean);

    const symbols = [...new Set([...rawSymbols, 'SPY', 'QQQ'])];
    if (!symbols.length) {
      return res.status(400).json({ ok: false, error: 'Missing symbols' });
    }

    const quotes = await fetchQuoteBatch(symbols, apiKey);
    const bySymbol = Object.fromEntries(quotes.map(q => [q.symbol, q]));
    const spyChange = bySymbol.SPY?.regularMarketChangePercent ?? null;
    const qqqChange = bySymbol.QQQ?.regularMarketChangePercent ?? null;

    return res.status(200).json({
      ok: true,
      time: new Date().toISOString(),
      market: {
        spyChange,
        qqqChange,
        trend: calcTrend(spyChange, qqqChange),
      },
      quoteResponse: {
        result: rawSymbols.map(sym => bySymbol[sym]).filter(Boolean),
      },
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'Snapshot error' });
  }
};
