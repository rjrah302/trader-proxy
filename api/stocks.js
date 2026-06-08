// v3 - FMP API fixed
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.FMP_API_KEY || '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
  const symbols = req.query.symbols || 'AAPL,NVDA,MSFT,TSLA,AMZN,GOOGL,META,PLTR,AMD,JPM,NFLX,BABA';

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    // FMP قد يرجع array أو object - نتعامل مع الحالتين
    const arr = Array.isArray(data) ? data : [];

    const result = {
      quoteResponse: {
        result: arr.map(q => ({
          symbol: q.symbol,
          regularMarketPrice: q.price,
          regularMarketChangePercent: q.changesPercentage,
          regularMarketVolume: q.volume,
          regularMarketDayHigh: q.dayHigh,
          regularMarketDayLow: q.dayLow
        }))
      }
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
