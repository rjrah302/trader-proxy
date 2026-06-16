// stocks.js - FMP Proxy
import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey  = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = (req.query.symbols || 'AAPL').split(',').map(s => s.trim()).filter(Boolean);

  try {
    const results = await Promise.all(
      symbols.map(async sym => {
        try {
          const r = await fetch(
            `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${apiKey}`
          );
          if (!r.ok) return null;
          const data = await r.json();
          const q = Array.isArray(data) && data[0];
          if (!q || !q.price) return null;
          return {
            symbol:                     q.symbol,
            regularMarketPrice:         parseFloat(q.price),
            regularMarketChangePercent: parseFloat(q.changePercentage || q.changesPercentage || 0),
            regularMarketVolume:        parseInt(q.volume    || 0),
            regularMarketDayHigh:       parseFloat(q.dayHigh || q.price),
            regularMarketDayLow:        parseFloat(q.dayLow  || q.price),
            avgVolume:                  parseInt(q.volume    || 0),
          };
        } catch(e) { return null; }
      })
    );

    const result = results.filter(Boolean);
    return res.status(200).json({ quoteResponse: { result } });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
