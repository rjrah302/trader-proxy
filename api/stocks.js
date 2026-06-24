// stocks.js - FMP Proxy
const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey  = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = (req.query.symbols || 'AAPL').split(',').map(s => s.trim()).filter(Boolean);

  const BATCH = 10;
  const all = [];

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const fetches = batch.map(async sym => {
      try {
        const r = await fetch(
          `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return null;
        const data = await r.json();
        const q = Array.isArray(data) && data[0];
        if (!q || !q.price) return null;
        return {
          symbol:                     q.symbol,
          regularMarketPrice:         parseFloat(q.price),
          regularMarketChangePercent: parseFloat(q.changePercentage || 0),
          regularMarketVolume:        parseInt(q.volume    || 0),
          regularMarketDayHigh:       parseFloat(q.dayHigh || q.price),
          regularMarketDayLow:        parseFloat(q.dayLow  || q.price),
          avgVolume:                  parseInt(q.avgVolume ?? q.averageVolume ?? q.volume ?? 0),
        };
      } catch(e) { return null; }
    });

    const results = await Promise.all(fetches);
    all.push(...results.filter(Boolean));
  }

  return res.status(200).json({ quoteResponse: { result: all } });
}
