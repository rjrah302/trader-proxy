// v4 - FMP stable API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = req.query.symbols || 'AAPL,NVDA,MSFT,TSLA,AMZN,GOOGL,META,PLTR,AMD,JPM,NFLX,BABA';
  const symbolArray = symbols.split(',');

  try {
    const results = await Promise.all(
      symbolArray.map(async (sym) => {
        const url = `https://financialmodelingprep.com/stable/quote?symbol=${sym.trim()}&apikey=${apiKey}`;
        const r = await fetch(url);
        const d = await r.json();
        const q = Array.isArray(d) ? d[0] : d;
        if (!q || !q.price) return null;
        return {
          symbol: q.symbol,
          regularMarketPrice: q.price,
          regularMarketChangePercent: q.changesPercentage,
          regularMarketVolume: q.volume,
          regularMarketDayHigh: q.dayHigh,
          regularMarketDayLow: q.dayLow
        };
      })
    );

    res.status(200).json({
      quoteResponse: {
        result: results.filter(Boolean)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
