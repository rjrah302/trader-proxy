// stocks.js - FMP Proxy v7
import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey  = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = req.query.symbols || 'AAPL';

  const endpoints = [
    `https://financialmodelingprep.com/stable/batch-quote?symbols=${symbols}&apikey=${apiKey}`,
    `https://financialmodelingprep.com/stable/quote?symbol=${symbols}&apikey=${apiKey}`,
    `https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${apiKey}`,
  ];

  for (const url of endpoints) {
    try {
      const r    = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const text = await r.text();

      console.log(`[stocks] ${url.split('?')[0]} → ${r.status} | ${text.slice(0,120)}`);

      if (!r.ok) continue;

      let data;
      try { data = JSON.parse(text); } catch(e) { continue; }

      if (!Array.isArray(data) || data.length === 0) continue;

      const result = data
        .filter(q => q && (q.price ?? q.regularMarketPrice) > 0)
        .map(q => ({
          symbol:                     q.symbol,
          regularMarketPrice:         parseFloat(q.price ?? q.regularMarketPrice ?? 0),
          regularMarketChangePercent: parseFloat(q.changesPercentage ?? q.regularMarketChangePercent ?? 0),
          regularMarketVolume:        parseInt(q.volume ?? q.regularMarketVolume ?? 0),
          regularMarketDayHigh:       parseFloat(q.dayHigh ?? q.regularMarketDayHigh ?? q.price ?? 0),
          regularMarketDayLow:        parseFloat(q.dayLow  ?? q.regularMarketDayLow  ?? q.price ?? 0),
          avgVolume:                  parseInt(q.avgVolume ?? q.volume ?? 0),
        }));

      if (result.length === 0) continue;

      return res.status(200).json({ quoteResponse: { result } });

    } catch(e) {
      console.error(`[stocks] error: ${e.message}`);
    }
  }

  return res.status(502).json({ error: 'All FMP endpoints failed', symbols });
}
