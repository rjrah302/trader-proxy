// stocks.js - FMP Proxy
import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey  = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = req.query.symbols || 'AAPL';

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${apiKey}`;
    const r   = await fetch(url);

    if (!r.ok) {
      return res.status(r.status).json({ error: 'FMP error', status: r.status });
    }

    const data = await r.json();

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(200).json({ quoteResponse: { result: [] } });
    }

    const result = data
      .filter(q => q && q.price > 0)
      .map(q => ({
        symbol:                     q.symbol,
        regularMarketPrice:         parseFloat(q.price),
        regularMarketChangePercent: parseFloat(q.changesPercentage ?? 0),
        regularMarketVolume:        parseInt(q.volume    ?? 0),
        regularMarketDayHigh:       parseFloat(q.dayHigh ?? q.price),
        regularMarketDayLow:        parseFloat(q.dayLow  ?? q.price),
        avgVolume:                  parseInt(q.avgVolume ?? q.volume ?? 0),
      }));

    return res.status(200).json({ quoteResponse: { result } });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
