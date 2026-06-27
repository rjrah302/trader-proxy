// ================================================================
// telegram.js â€” RamiMarketX Bot v2
// ================================================================
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');
const RamiAnalysis                       = require('../public/sharedAnalysis.js');

// â”€â”€ Firebase
let db;
function getDB() {
  if (!db) {
    if (!getApps().length) {
      const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
      initializeApp({ credential: cert(sa) });
    }
    db = getFirestore();
  }
  return db;
}

// â”€â”€ Constants
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6195578236';
const FMP_KEY    = process.env.FMP_API_KEY;
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TELEGRAM HELPERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function tgSend(text, chatId = TG_CHAT_ID) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('tgSend:', e.message); }
}

// Ø¥Ø±Ø³Ø§Ù„ Ø±Ø³Ø§Ù„Ø© Ù…Ø¹ Ø£Ø²Ø±Ø§Ø± Inline
async function tgSendButtons(text, buttons, chatId = TG_CHAT_ID) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:      chatId,
        text,
        parse_mode:   'HTML',
        reply_markup: { inline_keyboard: buttons },
      }),
    });
  } catch (e) { console.error('tgSendButtons:', e.message); }
}

// ØªØ¹Ø¯ÙŠÙ„ Ø±Ø³Ø§Ù„Ø© Ù…ÙˆØ¬ÙˆØ¯Ø© (Ù„Ø¥Ø²Ø§Ù„Ø© Ø§Ù„Ø£Ø²Ø±Ø§Ø± Ø¨Ø¹Ø¯ Ø§Ù„Ø¶ØºØ·)
async function tgEditButtons(chatId, messageId, text) {
  try {
    await fetch(`${TG_API}/editMessageText`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch (e) {}
}

// Ø§Ù„Ø±Ø¯ Ø¹Ù„Ù‰ callback_query
async function tgAnswerCallback(callbackId, text = '') {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ callback_query_id: callbackId, text }),
    });
  } catch (e) {}
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• FIREBASE HELPERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function fbGet(doc) {
  try {
    const s = await getDB().collection('bot').doc(doc).get();
    return s.exists ? s.data() : {};
  } catch (e) { return {}; }
}

async function fbSet(doc, data) {
  try {
    await getDB().collection('bot').doc(doc).set(data, { merge: true });
  } catch (e) { console.error('fbSet:', e.message); }
}

// â”€â”€ Ù‚Ø±Ø§Ø¡Ø© Ø³Ø¬Ù„ Ø§Ù„ØªÙˆØµÙŠØ§Øª Ù…Ù† users/default (Ø§Ù„Ø£Ø¯Ø§Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©)
async function fbGetHistory() {
  try {
    const s = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('rec_history').get();
    return s.exists ? (s.data().records || []) : [];
  } catch (e) { return []; }
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• FMP HELPERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function getStock(sym) {
  try {
    sym = String(sym || '').toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, '');
    const variants = [...new Set([sym, sym.replace('.', '-'), sym.replace('-', '.')])].filter(Boolean);

    let quote = null;
    let history = [];

    for (const s of variants) {
      try {
        const q = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(s)}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        quote = Array.isArray(q) ? q[0] : (q?.symbol ? q : null);
        if (quote?.price) break;
      } catch(e) {}
      try {
        const q2 = await fetch(`https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(s)}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        quote = Array.isArray(q2) ? q2[0] : (q2?.symbol ? q2 : null);
        if (quote?.price) break;
      } catch(e) {}
    }

    const histSym = quote?.symbol || variants[0];
    try {
      const h = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(histSym)}&limit=120&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
      history = Array.isArray(h) ? h : [];
    } catch(e) {}
    if (!history.length) {
      try {
        const h2 = await fetch(`https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(histSym)}?timeseries=120&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        history = Array.isArray(h2) ? h2 : (Array.isArray(h2?.historical) ? h2.historical : []);
      } catch(e) {}
    }

    const closes   = history.map(d => d.close).reverse();
    const highs    = history.map(d => d.high  || d.close).reverse();
    const lows     = history.map(d => d.low   || d.close).reverse();
    const dates    = history.map(d => d.date).reverse();
    return { quote, closes, highs, lows, dates };
  } catch (e) { return null; }
}

// Ø¬Ù„Ø¨ Ø£Ø³Ø¹Ø§Ø± Ù…ØªØ¹Ø¯Ø¯Ø© Ø¯ÙØ¹Ø© ÙˆØ§Ø­Ø¯Ø©
async function getMultipleStocks(symbols) {
  const results = {};
  const BATCH   = 8;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    await Promise.all(batch.map(async sym => {
      const d = await getStock(sym);
      if (d) results[sym] = d;
    }));
  }
  return results;
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TECHNICAL INDICATORS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
function calcEMA(arr, p) {
  if (!arr || arr.length < p) return null;
  const k = 2 / (p + 1);
  let ema  = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes) {
  if (!closes || closes.length < 15) return null;
  const diffs  = closes.slice(-15).map((v, i, a) => i > 0 ? v - a[i - 1] : 0).slice(1);
  let ag = diffs.map(x => x > 0 ? x : 0).reduce((a, b) => a + b, 0) / 14;
  let al = diffs.map(x => x < 0 ? -x : 0).reduce((a, b) => a + b, 0) / 14;
  return al === 0 ? 100 : +(100 - (100 / (1 + ag / al))).toFixed(1);
}

function calcMACD(closes) {
  if (!closes || closes.length < 35) return { hist: null, dir: null, signal: null };
  const e12 = calcEMA(closes, 12);
  const e26 = calcEMA(closes, 26);
  if (!e12 || !e26) return { hist: null, dir: null, signal: null };

  const macdArr = [];
  for (let j = 26; j <= closes.length; j++) {
    const sl = closes.slice(0, j);
    const a  = calcEMA(sl, 12), b = calcEMA(sl, 26);
    if (a && b) macdArr.push(a - b);
  }
  const sig = calcEMA(macdArr, 9);
  if (!sig) return { hist: null, dir: null, signal: null };

  const hist     = (e12 - e26) - sig;
  const prevArr  = macdArr.slice(0, -1);
  const prevSig  = calcEMA(prevArr, 9);
  const prevHist = prevArr.length ? prevArr[prevArr.length - 1] - prevSig : null;
  const dir      = prevHist != null ? (Math.abs(hist) > Math.abs(prevHist) ? 'expanding' : 'contracting') : null;

  return { hist: +hist.toFixed(3), dir, signal: +sig.toFixed(3), macdLine: +(e12 - e26).toFixed(3) };
}

function calcWeeklyTrend(closes) {
  if (!closes || closes.length < 10) return null;
  const weeks = [];
  for (let i = 0; i < closes.length; i += 5) {
    const w = closes.slice(i, i + 5);
    if (w.length > 0) weeks.push(w[w.length - 1]);
  }
  if (weeks.length < 3) return null;
  return weeks[weeks.length - 1] > weeks[weeks.length - 2] ? 'bullish' : 'bearish';
}

function calcSupRes(closes, highs, lows, price) {
  if (!closes || closes.length < 20) return { support: null, resistance: null };

  // Ù†ÙØ³ Ø®ÙˆØ§Ø±Ø²Ù…ÙŠØ© Ø§Ù„Ø£Ø¯Ø§Ø© â€” Ù‚Ù…Ù… ÙˆÙ‚ÙŠØ¹Ø§Ù† Ø­Ù‚ÙŠÙ‚ÙŠØ© Ù…Ø¹ clusters
  const h = highs && highs.length >= closes.length ? highs : closes;
  const l = lows  && lows.length  >= closes.length ? lows  : closes;

  const tolerance = price * 0.015;
  const levels = [];

  for (let j = 1; j < h.length - 1; j++) {
    if (h[j] >= h[j-1] && h[j] >= h[j+1]) levels.push({ price: h[j], type: 'resistance' });
    if (l[j] <= l[j-1] && l[j] <= l[j+1]) levels.push({ price: l[j], type: 'support' });
  }

  const clusters = [];
  levels.forEach(lv => {
    const ex = clusters.find(c => Math.abs(c.price - lv.price) <= tolerance);
    if (ex) { ex.touches++; ex.price = (ex.price + lv.price) / 2; }
    else clusters.push({ price: lv.price, type: lv.type, touches: 1 });
  });

  const strong     = clusters.filter(c => c.touches >= 2);
  const resistance = strong.filter(c => c.price > price).sort((a, b) => a.price - b.price)[0]?.price
    ?? +Math.max(...h.slice(-20)).toFixed(2);
  const support    = strong.filter(c => c.price < price).sort((a, b) => b.price - a.price)[0]?.price
    ?? +Math.min(...l.slice(-60)).toFixed(2); // â† 60 ÙŠÙˆÙ… Ù„Ù„Ù€ fallback

  return { support: +support.toFixed(2), resistance: +resistance.toFixed(2) };
}

function calcATR(closes) {
  if (!closes || closes.length < 15) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.abs(closes[i] - closes[i - 1]));
  }
  const atr    = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const price  = closes[closes.length - 1];
  return price > 0 ? +(atr / price * 100).toFixed(2) : null;
}

function calcGreenCandles(closes) {
  if (!closes || closes.length < 5) return 0;
  const last = closes.slice(-5);
  let green  = 0;
  for (let i = 1; i < last.length; i++) if (last[i] > last[i - 1]) green++;
  return green;
}

// â”€â”€ ØªØ­Ù„ÙŠÙ„ Ø´Ø§Ù…Ù„ Ù„Ø³Ù‡Ù…
function analyzeStock(sym, quote, closes, prevAnalysis = null, highs = null, lows = null) {
  if (!quote || !closes.length) return null;

  const price  = quote.price;
  const change = quote.changePercentage || 0;
  const rsi    = calcRSI(closes);
  const macd   = calcMACD(closes);
  const weekly = calcWeeklyTrend(closes);
  const levels = calcSupRes(closes, highs || closes, lows || closes, price);
  const atrPct = calcATR(closes);
  const green  = calcGreenCandles(closes);

  // â”€â”€ Ù†Ù‚Ø§Ø· Ø§Ù„Ø¥Ø´Ø§Ø±Ø©
  let buy = 0, sell = 0;
  const signals = [], risks = [];

  if (macd.hist > 0 && macd.dir === 'expanding')  { buy += 2; signals.push('MACD Ø²Ø®Ù… ØµØ§Ø¹Ø¯ Ù‚ÙˆÙŠ â†‘'); }
  else if (macd.hist > 0)                          { buy++;    signals.push('MACD ØµØ§Ø¹Ø¯ ÙŠØ¶Ø¹Ù'); }
  else if (macd.hist < 0 && macd.dir === 'expanding') { sell += 2; risks.push('MACD Ù‡Ø§Ø¨Ø· ÙŠØªÙˆØ³Ø¹ â†“'); }
  else if (macd.hist < 0)                          { sell++;   risks.push('MACD Ù‡Ø§Ø¨Ø·'); }

  if (rsi !== null) {
    if (rsi < 30)       { buy += 2;  signals.push('RSI '+rsi+' â€” ØªØ´Ø¨Ø¹ Ø¨ÙŠØ¹ Ø´Ø¯ÙŠØ¯ ðŸ”¥'); }
    else if (rsi < 40)  { buy++;     signals.push('RSI '+rsi+' â€” Ù…Ù†Ø·Ù‚Ø© Ø´Ø±Ø§Ø¡'); }
    else if (rsi > 75)  { sell += 2; risks.push('RSI '+rsi+' â€” ØªØ´Ø¨Ø¹ Ø´Ø±Ø§Ø¡ âš ï¸'); }
    else if (rsi > 65)  { sell++;    risks.push('RSI '+rsi+' â€” Ù…Ø±ØªÙØ¹'); }
  }

  if (weekly === 'bullish') { buy++;   signals.push('Ø£Ø³Ø¨ÙˆØ¹ÙŠ ØµØ§Ø¹Ø¯ âœ…'); }
  else                      { sell++;  risks.push('Ø£Ø³Ø¨ÙˆØ¹ÙŠ Ù‡Ø§Ø¨Ø· âŒ'); }

  if (green >= 4) { buy++;   signals.push(green+' Ø´Ù…ÙˆØ¹ Ø®Ø¶Ø±Ø§Ø¡ Ù…Ù† 5'); }
  else if (green <= 1) { sell++; risks.push('Ø´Ù…ÙˆØ¹ Ø­Ù…Ø±Ø§Ø¡ Ù…ØªØªØ§Ù„ÙŠØ©'); }

  // âœ… Ø­Ø¬Ø¨: RSI Ù…Ø±ØªÙØ¹ + Ù‚Ø±ÙŠØ¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø©
  const nearRes = levels.resistance && price >= levels.resistance * 0.98;
  if (rsi !== null && rsi > 70 && nearRes) { sell += 4; risks.push('RSI Ù…Ø±ØªÙØ¹ + Ù‚Ø±ÙŠØ¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© â›”'); }
  else if (rsi !== null && rsi > 72)       { sell += 2; risks.push('RSI Ù…Ø±ØªÙØ¹ Ø¬Ø¯Ø§Ù‹ âš ï¸'); }

  const score   = buy - sell;
  let verdict, vIcon;
  if      (score >= 3) { verdict = 'Ø¥Ø´Ø§Ø±Ø© Ø´Ø±Ø§Ø¡ Ù‚ÙˆÙŠØ©';        vIcon = 'âœ…'; }
  else if (score >= 1) { verdict = 'Ø¥ÙŠØ¬Ø§Ø¨ÙŠ â€” ÙŠÙ…ÙƒÙ† Ø§Ù„Ø¯Ø®ÙˆÙ„';   vIcon = 'âš ï¸'; }
  else if (score === 0){ verdict = 'Ø¥Ø´Ø§Ø±Ø§Øª Ù…ØªØ¶Ø§Ø±Ø¨Ø© â€” Ø§Ù†ØªØ¸Ø±'; vIcon = 'â³'; }
  else                  { verdict = 'Ø³Ù„Ø¨ÙŠ â€” ØªØ¬Ù†Ø¨ Ø§Ù„Ø¯Ø®ÙˆÙ„';    vIcon = 'âŒ'; }

  // â”€â”€ Ø§ÙƒØªØ´Ø§Ù Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ø§Ù„Ø¬ÙˆÙ‡Ø±ÙŠØ© (Ù„Ù„ØªÙ†Ø¨ÙŠÙ‡)
  const changes = [];
  if (prevAnalysis) {
    // MACD ØªØ­ÙˆÙ„
    if (prevAnalysis.macdHist < 0 && macd.hist > 0)
      changes.push('ðŸš€ MACD ØªØ­ÙˆÙ‘Ù„ Ø¥ÙŠØ¬Ø§Ø¨ÙŠØ§Ù‹ â€” Ø¥Ø´Ø§Ø±Ø© Ø´Ø±Ø§Ø¡ Ø¬Ø¯ÙŠØ¯Ø©!');
    if (prevAnalysis.macdHist > 0 && macd.hist < 0)
      changes.push('âš ï¸ MACD ØªØ­ÙˆÙ‘Ù„ Ø³Ù„Ø¨ÙŠØ§Ù‹ â€” ÙƒÙ† Ø­Ø°Ø±Ø§Ù‹');
    // MACD Ø§ØªØ¬Ø§Ù‡
    if (prevAnalysis.macdDir === 'contracting' && macd.dir === 'expanding' && macd.hist > 0)
      changes.push('ðŸ“ˆ Ø²Ø®Ù… MACD Ø¨Ø¯Ø£ ÙŠØªÙˆØ³Ø¹ â€” Ø§Ù„Ø²Ø®Ù… ÙŠØªØ³Ø§Ø±Ø¹');
    // RSI
    if (prevAnalysis.rsi > 40 && rsi < 35)
      changes.push('ðŸŽ¯ RSI Ø¯Ø®Ù„ Ù…Ù†Ø·Ù‚Ø© ØªØ´Ø¨Ø¹ Ø§Ù„Ø¨ÙŠØ¹ â€” ÙØ±ØµØ© Ø§Ù‚ØªØ±Ø¨Øª');
    if (prevAnalysis.rsi < 70 && rsi > 75)
      changes.push('ðŸ”” RSI Ø¯Ø®Ù„ Ù…Ù†Ø·Ù‚Ø© ØªØ´Ø¨Ø¹ Ø§Ù„Ø´Ø±Ø§Ø¡ â€” Ø±Ø§Ù‚Ø¨ Ø§Ù„Ø®Ø±ÙˆØ¬');
    // Ø§Ù„Ø³Ø¹Ø± Ø¹Ù†Ø¯ Ø§Ù„Ø¯Ø¹Ù…
    if (levels.support && price <= levels.support * 1.015 && prevAnalysis.price > levels.support * 1.015)
      changes.push('ðŸ›¡ Ø§Ù„Ø³Ø¹Ø± Ù„Ø§Ù…Ø³ Ø§Ù„Ø¯Ø¹Ù… $' + levels.support + ' â€” Ù†Ù‚Ø·Ø© Ø¯Ø®ÙˆÙ„ Ù…Ø­ØªÙ…Ù„Ø©');
    // ØªØ­ÙˆÙ„ Ø§Ù„Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ
    if (prevAnalysis.weekly === 'bearish' && weekly === 'bullish')
      changes.push('ðŸŒŸ Ø§Ù„Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ ØªØ­ÙˆÙ‘Ù„ ØµØ§Ø¹Ø¯Ø§Ù‹!');
  }

  return {
    price: +price.toFixed(2),
    change: +change.toFixed(2),
    rsi,
    macdHist:  macd.hist,
    macdDir:   macd.dir,
    macdLine:  macd.macdLine,
    weekly,
    support:   levels.support,
    resistance:levels.resistance,
    atrPct,
    green,
    signals,
    risks,
    score,
    verdict,
    vIcon,
    changes,  // Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ø§Ù„Ø¬ÙˆÙ‡Ø±ÙŠØ© â€” Ù„Ù„ØªÙ†Ø¨ÙŠÙ‡
  };
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MESSAGE BUILDERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================

// Ø±Ø³Ø§Ù„Ø© ØªØ­Ù„ÙŠÙ„ Ø³Ù‡Ù… ÙƒØ§Ù…Ù„ (Ø¹Ù†Ø¯ Ø§Ù„Ø·Ù„Ø¨)
function estimateTradeDuration({kind='rec', profitPct=0, atrPct=0, macdHist=0, macdHistDir=null, weeklyTrend=null, actionTone=null, rvol=1, isNight=false}) {
  return RamiAnalysis.estimateTradeDuration({
    kind, profitPct, atrPct, macdHist, macdHistDir, weeklyTrend, actionTone, rvol, isNight
  });
}

function formatTelegramDuration(duration) {
  if (!duration) return '3-7 Ø£ÙŠØ§Ù… ØªØ¯Ø§ÙˆÙ„';
  if (duration.label === 'Ø¨Ø¹Ø¯ Ø§Ù„Ø§ÙØªØªØ§Ø­') return 'Ø¨Ø¹Ø¯ Ø§Ù„Ø§ÙØªØªØ§Ø­';
  if (duration.days <= 1) return 'Ø§Ù„ÙŠÙˆÙ… / Ø¬Ù„Ø³Ø© ÙˆØ§Ø­Ø¯Ø©';
  if (duration.days <= 3) return `${duration.days} Ø£ÙŠØ§Ù… ØªØ¯Ø§ÙˆÙ„`;
  if (duration.days <= 7) return '3-7 Ø£ÙŠØ§Ù… ØªØ¯Ø§ÙˆÙ„';
  return 'Ø£ÙƒØ«Ø± Ù…Ù† Ø£Ø³Ø¨ÙˆØ¹';
}

function formatDecisionLabel(decision) {
  const label = decision?.recDecision?.label || 'Ø±Ø§Ù‚Ø¨';
  if (label === 'Ø§Ø¯Ø®Ù„ Ø§Ù„Ø¢Ù†') return 'âœ… Ø§Ø¯Ø®Ù„ Ø§Ù„Ø¢Ù†';
  if (label === 'Ø§Ø¯Ø®Ù„ Ø¨Ø´Ø±Ø·') return 'ðŸŸ¦ Ø§Ø¯Ø®Ù„ Ø¨Ø´Ø±Ø·';
  if (label === 'Ø§Ø³ØªØ¹Ø¯') return 'ðŸŸ¡ Ø§Ø³ØªØ¹Ø¯';
  if (label === 'Ù…Ø±ÙÙˆØ¶') return 'â›” Ù„Ø§ ØªØ¯Ø®Ù„ Ø§Ù„Ø¢Ù†';
  return label;
}

function buildAnalysisMsg(sym, name, a, levels) {
  const atr      = a.atrPct;
  const recMetrics = RamiAnalysis.calcRecTradeMetrics({
    price: a.price,
    support: a.support,
    resistance: a.resistance,
    atrPct: atr,
    nearSupport: !!(a.support && a.price <= a.support * 1.03),
    nearResistance: !!(a.resistance && a.price >= a.resistance * 0.98),
  });
  const stopLoss = recMetrics.stopLoss || null;
  // âœ… Ø¥Ø°Ø§ Ù‚Ø±ÙŠØ¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© â†’ Ø§Ù„Ù‡Ø¯Ù 5% ÙÙˆÙ‚Ù‡Ø§ (Ø¨Ø¹Ø¯ ÙƒØ³Ø±Ù‡Ø§)
  const isNearRes = recMetrics.tooCloseToResistance || (a.resistance && a.price >= a.resistance * 0.98);
  const target = recMetrics.target || null;
  const profitPct = recMetrics.profitPct;
  const duration = estimateTradeDuration({
    kind: 'rec',
    profitPct,
    atrPct: atr,
    macdHist: a.macdHist,
    macdHistDir: a.macdDir,
    weeklyTrend: a.weekly,
  });
  const durationLabel = formatTelegramDuration(duration);
  const riskReward = recMetrics.riskReward;
  const profitPctForDecision = profitPct;
  const tradeQuality = recMetrics.tradeQuality;
  const confidence = Math.max(10, Math.min(99, 50 + (a.score || 0) * 10));
  const distToSupport = recMetrics.distToSupport;
  const entryTiming = recMetrics.entryTiming;
  const entryNote = recMetrics.entryNote;
  const unifiedDecision = RamiAnalysis.buildRecCardDecision({
    confidence,
    tradeQuality,
    riskReward,
    profitPct: profitPctForDecision,
    entryTiming,
    entryNote,
    isCooldown: false,
    tooCloseToResistance: !!isNearRes,
    trendOk: true,
    newsOk: true,
    newsBlocked: false,
    signal: a.score >= 3 ? 'Ø´Ø±Ø§Ø¡ Ù‚ÙˆÙŠ' : a.score >= 1 ? 'Ø´Ø±Ø§Ø¡' : 'Ø§Ù†ØªØ¸Ø§Ø±',
    macdHist: a.macdHist,
    volR: 1,
    change: a.change,
    nearSupport: !!(a.support && a.price <= a.support * 1.03),
    distToSupport,
    nearResistance: !!isNearRes,
    priceText: '$' + a.price,
    idealEntryText: a.support ? '$' + a.support : '$' + a.price,
  });

  let m = `ðŸ“Š <b>${name || sym} (${sym})</b>\n`;
  m    += `ðŸ’° <b>$${a.price}</b> ${a.change >= 0 ? 'ðŸ“ˆ' : 'ðŸ“‰'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m    += `<b>${formatDecisionLabel(unifiedDecision)}</b>\n`;
  m    += `${unifiedDecision.finalEntryNote}\n`;
  m    += `R/R: <b>${riskReward ? riskReward + 'x' : 'ØºÙŠØ± Ù…ØªØ§Ø­'}</b> | Ø¬ÙˆØ¯Ø©: <b>${Math.min(100, Math.round(tradeQuality))}%</b>\n`;
  m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? 'âœ…' : 'âŒ';
    const mDir  = a.macdDir === 'expanding' ? 'â†‘ ÙŠØªÙˆØ³Ø¹' : 'â†“ ÙŠØ¶ÙŠÙ‚';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${mDir}\n`;
  }
  if (a.rsi != null) {
    const rIcon = a.rsi < 35 ? 'âœ…' : a.rsi > 70 ? 'âŒ' : 'âš ï¸';
    const rNote = a.rsi < 35 ? 'ØªØ´Ø¨Ø¹ Ø¨ÙŠØ¹' : a.rsi > 70 ? 'ØªØ´Ø¨Ø¹ Ø´Ø±Ø§Ø¡' : 'Ù…Ø­Ø§ÙŠØ¯';
    m += `RSI: ${rIcon} ${a.rsi} â€” ${rNote}\n`;
  }
  m += `Ø£Ø³Ø¨ÙˆØ¹ÙŠ: ${a.weekly === 'bullish' ? 'âœ… ØµØ§Ø¹Ø¯' : 'âŒ Ù‡Ø§Ø¨Ø·'}\n`;
  m += `Ø´Ù…ÙˆØ¹: ðŸ•¯ ${a.green} Ø®Ø¶Ø±Ø§Ø¡ Ù…Ù† Ø¢Ø®Ø± 5\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  if (a.support)    m += `ðŸŸ¢ Ø¯Ø¹Ù…: <b>$${a.support}</b>\n`;
  if (a.resistance) m += `ðŸ”´ Ù…Ù‚Ø§ÙˆÙ…Ø©: <b>$${a.resistance}</b>\n`;
  if (isNearRes)    m += `âš ï¸ Ø§Ù„Ø³Ø¹Ø± Ù‚Ø±ÙŠØ¨ Ù…Ù† Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© â€” Ø§Ù†ØªØ¸Ø± ÙƒØ³Ø±Ù‡Ø§\n`;
  if (stopLoss)     m += `ðŸ›‘ ÙˆÙ‚Ù Ù…Ù‚ØªØ±Ø­: <b>$${stopLoss}</b>\n`;
  if (target)       m += `ðŸŽ¯ Ù‡Ø¯Ù Ù…Ù‚ØªØ±Ø­: <b>$${target}</b> (+${profitPct}%)\n`;
  m += `â±ï¸ Ù…Ø¯Ø© Ø§Ù„Ø§Ø­ØªÙØ§Ø¸: <b>${durationLabel}</b>\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m += `ðŸ¤– <b>Ø§Ù„ØªØ­Ù„ÙŠÙ„:</b>\n`;
  a.signals.forEach(s => { m += `âœ… ${s}\n`; });
  a.risks.forEach(r   => { m += `âŒ ${r}\n`; });
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m += `${a.vIcon} ${a.verdict}\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m += `Ù‡Ù„ Ø§Ø´ØªØ±ÙŠØª ${sym}ØŸ\n`;
  m += `1ï¸âƒ£ Ù†Ø¹Ù… â€” Ø³Ø¬Ù‘Ù„ Ø§Ù„ØµÙÙ‚Ø©\n`;
  m += `2ï¸âƒ£ Ù„Ø§ â€” Ø£Ø¶ÙÙ‡ Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©`;
  return m;
}

// Ø±Ø³Ø§Ù„Ø© ØªØ­Ø¯ÙŠØ« Ø³Ù‡Ù… ÙÙŠ Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© (ÙƒÙ„ 10 Ø¯Ù‚Ø§Ø¦Ù‚)
function buildWatchUpdateMsg(sym, a, prevA) {
  const hasChanges = a.changes && a.changes.length > 0;

  let m = `ðŸ‘ <b>ØªØ­Ø¯ÙŠØ« ${sym}</b> â€” ${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}\n`;
  m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m    += `ðŸ’° $${a.price} ${a.change >= 0 ? 'â–²' : 'â–¼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? 'âœ…' : 'âŒ';
    const mDir  = a.macdDir === 'expanding' ? 'â†‘' : 'â†“';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${mDir}\n`;
  }
  if (a.rsi != null) {
    const rIcon = a.rsi < 35 ? 'ðŸ”¥' : a.rsi > 70 ? 'âš ï¸' : 'â€¢';
    m += `RSI: ${rIcon} ${a.rsi}\n`;
  }
  m += `Ø£Ø³Ø¨ÙˆØ¹ÙŠ: ${a.weekly === 'bullish' ? 'âœ… ØµØ§Ø¹Ø¯' : 'âŒ Ù‡Ø§Ø¨Ø·'}\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;

  if (hasChanges) {
    m += `<b>âš¡ ØªØºÙŠØ±Ø§Øª Ù…Ù‡Ù…Ø©:</b>\n`;
    a.changes.forEach(c => { m += `${c}\n`; });
    m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  }

  m += `${a.vIcon} ${a.verdict}`;
  return m;
}

// Ø±Ø³Ø§Ù„Ø© ØªØ­Ø¯ÙŠØ« Ø³Ù‡Ù… ÙÙŠ Ø§Ù„Ù…Ø­ÙØ¸Ø©
function buildPortfolioUpdateMsg(sym, a, trade) {
  const pnl    = +((a.price - trade.entry) / trade.entry * 100).toFixed(2);
  const pnlIcon = pnl >= 0 ? 'ðŸ“ˆ' : 'ðŸ“‰';
  const toTarget = trade.target ? +((trade.target - a.price) / a.price * 100).toFixed(2) : null;
  const toStop   = trade.stop   ? +((a.price - trade.stop)  / a.price * 100).toFixed(2) : null;
  const hasChanges = a.changes && a.changes.length > 0;

  let m = `ðŸ’¼ <b>ØªØ­Ø¯ÙŠØ« ${sym}</b> â€” Ù…Ø­ÙØ¸ØªÙƒ\n`;
  m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  m    += `ðŸ’° $${a.price} ${a.change >= 0 ? 'â–²' : 'â–¼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `${pnlIcon} P&L: <b>${pnl >= 0 ? '+' : ''}${pnl}%</b> (Ø¯Ø®ÙˆÙ„ $${trade.entry})\n`;
  if (toTarget != null) m += `ðŸŽ¯ Ù„Ù„Ù‡Ø¯Ù: ${toTarget > 0 ? '+' : ''}${toTarget}% ($${trade.target})\n`;
  if (toStop   != null) m += `ðŸ›‘ Ù„Ù„ÙˆÙ‚Ù: -${toStop}% ($${trade.stop})\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? 'âœ…' : 'âŒ';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${a.macdDir === 'expanding' ? 'â†‘' : 'â†“'}\n`;
  }
  if (a.rsi != null) m += `RSI: ${a.rsi < 35 ? 'ðŸ”¥' : a.rsi > 70 ? 'âš ï¸' : 'â€¢'} ${a.rsi}\n`;
  m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;

  if (hasChanges) {
    a.changes.forEach(c => { m += `${c}\n`; });
    m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
  }

  m += `${a.vIcon} ${a.verdict}`;
  return m;
}


// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• REPORT GENERATOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function generateReport() {
  try {
    let history = await fbGetHistory();
    if (!history.length) {
      await tgSend('ðŸ“Š Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ ØªÙˆØµÙŠØ§Øª Ø¨Ø¹Ø¯\nØ§ÙØªØ­ Ø§Ù„Ø£Ø¯Ø§Ø© ÙÙŠ ÙŠÙˆÙ… ØªØ¯Ø§ÙˆÙ„ ÙˆØ§Ù†ØªØ¸Ø± ØªÙˆÙ„ÙŠØ¯ Ø§Ù„ØªÙˆØµÙŠØ§Øª');
      return;
    }

    const recAll  = history.filter(h => (h.type || 'rec') === 'rec');
    const specAll = history.filter(h => h.type === 'spec');
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recWeek    = recAll.filter(h  => new Date(h.recDate) >= oneWeekAgo);
    const specWeek   = specAll.filter(h => new Date(h.recDate) >= oneWeekAgo);

    function calcStats(recs) {
      const closed  = recs.filter(h => h.result !== 'pending');
      const wins    = closed.filter(h => h.result === 'win');
      const losses  = closed.filter(h => h.result === 'loss');
      const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
      const avgWin  = wins.length   ? +(wins.reduce((s, h) => s + (h.pnlPct || 0), 0) / wins.length).toFixed(2)   : 0;
      const avgLoss = losses.length ? +(losses.reduce((s, h) => s + (h.pnlPct || 0), 0) / losses.length).toFixed(2) : 0;
      const exp     = closed.length ? +((winRate / 100 * avgWin) + ((1 - winRate / 100) * avgLoss)).toFixed(2) : 0;
      const best    = [...wins].sort((a, b) => (b.pnlPct || 0) - (a.pnlPct || 0))[0];
      const worst   = [...losses].sort((a, b) => (a.pnlPct || 0) - (b.pnlPct || 0))[0];
      const openR   = closed.filter(h => h.session === 'Ø§ÙØªØªØ§Ø­');
      const midR    = closed.filter(h => h.session === 'Ù…Ù†ØªØµÙ');
      const openWR  = openR.length ? Math.round(openR.filter(h => h.result === 'win').length / openR.length * 100) : null;
      const midWR   = midR.length  ? Math.round(midR.filter(h => h.result === 'win').length  / midR.length  * 100) : null;
      const withRR  = recs.filter(h => h.riskReward);
      const avgRR   = withRR.length ? +(withRR.reduce((s, h) => s + h.riskReward, 0) / withRR.length).toFixed(2) : null;
      return {
        total: recs.length, wins: wins.length, losses: losses.length,
        pending: recs.filter(h => h.result === 'pending').length,
        winRate, avgWin, avgLoss, exp, best, worst, avgRR,
        openWR, midWR, openCount: openR.length, midCount: midR.length,
      };
    }

    function getVerdict(exp, winRate, isSpec = false) {
      if (isSpec) {
        if (exp >= 3 && winRate >= 55) return 'âœ… Ø§Ù„Ù…Ø¬Ø§Ø²ÙØ© Ù…Ø±Ø¨Ø­Ø© Ø¬Ø¯Ø§Ù‹ â€” Ø§Ø³ØªÙ…Ø±';
        if (exp >= 1 && winRate >= 45) return 'âš ï¸ Ø§Ù„Ù…Ø¬Ø§Ø²ÙØ© Ù…ØªØ¹Ø§Ø¯Ù„Ø© â€” Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø´Ø±ÙˆØ·';
        return 'âŒ Ø§Ù„Ù…Ø¬Ø§Ø²ÙØ© Ø®Ø§Ø³Ø±Ø© â€” Ø´Ø¯Ø¯ Ø§Ù„Ø´Ø±ÙˆØ·';
      }
      if (exp >= 2 && winRate >= 60) return 'âœ… Ø§Ù„Ø£Ø¯Ø§Ø© Ù…Ù…ØªØ§Ø²Ø© â€” Ø§Ø³ØªÙ…Ø±';
      if (exp >= 1 && winRate >= 50) return 'âœ… Ø§Ù„Ø£Ø¯Ø§Ø© Ù…Ø±Ø¨Ø­Ø© â€” Ø¬ÙŠØ¯';
      if (exp >= 0 && winRate >= 45) return 'âš ï¸ Ø§Ù„Ø£Ø¯Ø§Ø© Ù…ØªØ¹Ø§Ø¯Ù„Ø© â€” Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù…Ø¹Ø§Ø¯Ù„Ø§Øª';
      if (winRate >= 40)             return 'âš ï¸ Ø£Ø¯Ø§Ø¡ Ø¶Ø¹ÙŠÙ â€” Ø®ÙÙ Ø§Ù„Ù…Ø®Ø§Ø·Ø±Ø©';
      return 'âŒ Ø§Ù„Ø£Ø¯Ø§Ø© Ø®Ø§Ø³Ø±Ø© â€” Ø£ÙˆÙ‚Ù ÙˆØ±Ø§Ø¬Ø¹ Ø§Ù„ÙƒÙˆØ¯';
    }

    const rw = calcStats(recWeek);
    const ra = calcStats(recAll);
    const sw = calcStats(specWeek);
    const sa = calcStats(specAll);

    const dateStr = new Date().toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Ø±Ø³Ø§Ù„Ø© 1 â€” Ø§Ù„ØªÙˆØµÙŠØ§Øª
    let msg1 = `ðŸ“Š <b>Ø§Ù„ØªÙˆØµÙŠØ§Øª</b>\nðŸ“… ${dateStr}\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
    msg1 += `ðŸ—“ <b>Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ (${rw.total} ØªÙˆØµÙŠØ©)</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    if (!rw.wins && !rw.losses) {
      msg1 += `â³ Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ù…ØºÙ„Ù‚Ø© Ø¨Ø¹Ø¯\n`;
    } else {
      msg1 += `âœ… ${rw.wins} Ù†Ø§Ø¬Ø­Ø©  âŒ ${rw.losses} Ø®Ø§Ø³Ø±Ø©  â³ ${rw.pending} Ù…Ø¹Ù„Ù‚Ø©\n`;
      msg1 += `ðŸŽ¯ Ù†Ø³Ø¨Ø© Ø§Ù„Ù†Ø¬Ø§Ø­: <b>${rw.winRate}%</b>\n`;
      msg1 += `ðŸ’° Ù…ØªÙˆØ³Ø· Ø§Ù„Ø±Ø¨Ø­: <b>+${rw.avgWin}%</b>\n`;
      msg1 += `ðŸ“‰ Ù…ØªÙˆØ³Ø· Ø§Ù„Ø®Ø³Ø§Ø±Ø©: <b>${rw.avgLoss}%</b>\n`;
      msg1 += `ðŸ§® Ø§Ù„ØªÙˆÙ‚Ø¹ Ø§Ù„Ø±ÙŠØ§Ø¶ÙŠ: <b>${rw.exp >= 0 ? '+' : ''}${rw.exp}%</b>\n`;
      if (rw.openWR !== null) msg1 += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nðŸŒ… Ø§Ù„Ø§ÙØªØªØ§Ø­: ${rw.openWR}% (${rw.openCount})\n`;
      if (rw.midWR  !== null) msg1 += `ðŸŒ‡ Ø§Ù„Ù…Ù†ØªØµÙ: ${rw.midWR}% (${rw.midCount})\n`;
      if (rw.best)  msg1 += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nðŸ† Ø£ÙØ¶Ù„: <b>${rw.best.id}</b> +${rw.best.pnlPct}%\n`;
      if (rw.worst) msg1 += `ðŸ’€ Ø£Ø³ÙˆØ£: <b>${rw.worst.id}</b> ${rw.worst.pnlPct}%\n`;
    }
    msg1 += `\n${getVerdict(rw.exp, rw.winRate)}\n\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
    msg1 += `ðŸ“ˆ <b>Ø§Ù„ÙƒÙ„ÙŠ (${ra.total} ØªÙˆØµÙŠØ©)</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    msg1 += `âœ… ${ra.wins}  âŒ ${ra.losses}  â³ ${ra.pending}\n`;
    msg1 += `ðŸŽ¯ Ù†Ø³Ø¨Ø© Ø§Ù„Ù†Ø¬Ø§Ø­: <b>${ra.winRate}%</b>\n`;
    msg1 += `ðŸ§® Ø§Ù„ØªÙˆÙ‚Ø¹ Ø§Ù„Ø±ÙŠØ§Ø¶ÙŠ: <b>${ra.exp >= 0 ? '+' : ''}${ra.exp}%</b>\n`;
    msg1 += `\n${getVerdict(ra.exp, ra.winRate)}`;
    await tgSend(msg1);

    // Ø±Ø³Ø§Ù„Ø© 2 â€” Ø§Ù„Ù…Ø¬Ø§Ø²ÙØ©
    if (sa.total > 0) {
      let msg2 = `ðŸŽ² <b>Ø§Ù„Ù…Ø¬Ø§Ø²ÙØ©</b>\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
      msg2 += `ðŸ—“ <b>Ù‡Ø°Ø§ Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ (${sw.total} ÙØ±ØµØ©)</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
      if (!sw.wins && !sw.losses) {
        msg2 += `â³ Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ø¨Ø¹Ø¯\n`;
      } else {
        msg2 += `âœ… ${sw.wins} Ù†Ø§Ø¬Ø­Ø©  âŒ ${sw.losses} Ø®Ø§Ø³Ø±Ø©  â³ ${sw.pending} Ù…Ø¹Ù„Ù‚Ø©\n`;
        msg2 += `ðŸŽ¯ Ù†Ø³Ø¨Ø© Ø§Ù„Ù†Ø¬Ø§Ø­: <b>${sw.winRate}%</b>\n`;
        msg2 += `ðŸ’° Ù…ØªÙˆØ³Ø· Ø§Ù„Ø±Ø¨Ø­: <b>+${sw.avgWin}%</b>\n`;
        msg2 += `ðŸ§® Ø§Ù„ØªÙˆÙ‚Ø¹ Ø§Ù„Ø±ÙŠØ§Ø¶ÙŠ: <b>${sw.exp >= 0 ? '+' : ''}${sw.exp}%</b>\n`;
        if (sw.avgRR) msg2 += `ðŸ“ Ù…ØªÙˆØ³Ø· R/R: <b>1:${sw.avgRR}</b>\n`;
        if (sw.best)  msg2 += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nðŸ† Ø£ÙØ¶Ù„: <b>${sw.best.id}</b> +${sw.best.pnlPct}%\n`;
      }
      msg2 += `\n${getVerdict(sw.exp, sw.winRate, true)}\n\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
      msg2 += `ðŸ“ˆ <b>Ø§Ù„ÙƒÙ„ÙŠ (${sa.total} ÙØ±ØµØ©)</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
      msg2 += `âœ… ${sa.wins}  âŒ ${sa.losses}  â³ ${sa.pending}\n`;
      msg2 += `ðŸŽ¯ Ù†Ø³Ø¨Ø© Ø§Ù„Ù†Ø¬Ø§Ø­: <b>${sa.winRate}%</b>\n`;
      if (sa.avgRR) msg2 += `ðŸ“ Ù…ØªÙˆØ³Ø· R/R: <b>1:${sa.avgRR}</b>\n`;
      msg2 += `\n${getVerdict(sa.exp, sa.winRate, true)}`;
      await tgSend(msg2);
    }

  } catch(e) {
    console.error('generateReport:', e.message);
    await tgSend(`âš ï¸ Ø®Ø·Ø£ ÙÙŠ Ø§Ù„ØªÙ‚Ø±ÙŠØ±: ${e.message}`);
  }
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MONITOR (ÙƒÙ„ 10 Ø¯Ù‚Ø§Ø¦Ù‚) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function runMonitor() {
  try {
    // Ø¬Ù„Ø¨ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª
    const [watchData, portData, prevStateData] = await Promise.all([
      fbGet('watchlist'),
      fbGet('portfolio'),
      fbGet('monitor_state'),
    ]);

    const watchList  = watchData.symbols  || [];
    const portfolio  = (portData.trades   || []).filter(t => !t.closed);
    const prevState  = prevStateData.stocks || {};

    // Ø¬Ù…Ø¹ ÙƒÙ„ Ø§Ù„Ø±Ù…ÙˆØ²
    const allSymbols = [...new Set([
      ...watchList,
      ...portfolio.map(t => t.symbol),
    ])];

    if (allSymbols.length === 0) return;

    // Ø¬Ù„Ø¨ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ù† FMP
    const stocksData = await getMultipleStocks(allSymbols);
    const newState   = {};
    const messages   = [];

    // â”€â”€ Ù…Ø¹Ø§Ù„Ø¬Ø© Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©
    for (const sym of watchList) {
      const d = stocksData[sym];
      if (!d?.quote) continue;

      const prev = prevState[sym] || null;
      const a    = analyzeStock(sym, d.quote, d.closes, prev, d.highs, d.lows);
      if (!a) continue;

      newState[sym] = {
        price:    a.price,
        rsi:      a.rsi,
        macdHist: a.macdHist,
        macdDir:  a.macdDir,
        weekly:   a.weekly,
        updatedAt: new Date().toISOString(),
      };

      // Ø£Ø±Ø³Ù„ ÙÙ‚Ø· Ø¥Ø°Ø§ ÙÙŠÙ‡ ØªØºÙŠÙŠØ±Ø§Øª Ù…Ù‡Ù…Ø©
      if (a.changes && a.changes.length > 0) {
        messages.push(buildWatchUpdateMsg(sym, a, prev));
      }
    }

    // â”€â”€ Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ù…Ø­ÙØ¸Ø©
    for (const trade of portfolio) {
      const sym = trade.symbol;
      const d   = stocksData[sym];
      if (!d?.quote) continue;

      const prev = prevState[sym] || null;
      const a    = analyzeStock(sym, d.quote, d.closes, prev, d.highs, d.lows);
      if (!a) continue;

      newState[sym] = {
        price:    a.price,
        rsi:      a.rsi,
        macdHist: a.macdHist,
        macdDir:  a.macdDir,
        weekly:   a.weekly,
        updatedAt: new Date().toISOString(),
      };

      const pnl = +((a.price - trade.entry) / trade.entry * 100).toFixed(2);

      // ØªÙ†Ø¨ÙŠÙ‡ ÙˆØµÙˆÙ„ Ø§Ù„Ù‡Ø¯Ù
      if (trade.target && a.price >= trade.target) {
        messages.push(
          `ðŸŽ¯ <b>${sym} ÙˆØµÙ„ Ø§Ù„Ù‡Ø¯Ù!</b>\n` +
          `$${trade.entry} â†’ $${a.price}\n` +
          `Ø±Ø¨Ø­: +${pnl}% ðŸŽ‰\n` +
          `Ø§ÙƒØªØ¨: <code>Ø®Ø±Ø¬Øª ${sym}</code>`
        );
        continue;
      }

      // ØªÙ†Ø¨ÙŠÙ‡ Ø§Ù‚ØªØ±Ø§Ø¨ Ø§Ù„ÙˆÙ‚Ù
      if (trade.stop && a.price <= trade.stop * 1.02 && a.price > trade.stop) {
        messages.push(
          `âš ï¸ <b>${sym} Ø§Ù‚ØªØ±Ø¨ Ù…Ù† Ø§Ù„ÙˆÙ‚Ù!</b>\n` +
          `Ø§Ù„Ø³Ø¹Ø±: $${a.price} | ÙˆÙ‚Ù: $${trade.stop}\n` +
          `P&L: ${pnl}%\nÙƒÙ† Ù…Ø³ØªØ¹Ø¯Ø§Ù‹ Ù„Ù„Ø®Ø±ÙˆØ¬`
        );
        continue;
      }

      // ØªÙ†Ø¨ÙŠÙ‡ ÙƒØ³Ø± Ø§Ù„ÙˆÙ‚Ù
      if (trade.stop && a.price <= trade.stop) {
        messages.push(
          `ðŸš¨ <b>${sym} ÙƒØ³Ø± Ø§Ù„ÙˆÙ‚Ù!</b>\n` +
          `$${a.price} < $${trade.stop}\n` +
          `Ø®Ø³Ø§Ø±Ø©: ${pnl}%\n` +
          `Ø§Ø®Ø±Ø¬ ÙÙˆØ±Ø§Ù‹! Ø§ÙƒØªØ¨: <code>Ø®Ø±Ø¬Øª ${sym}</code>`
        );
        continue;
      }

      // ØªØ­Ø¯ÙŠØ« Ø¯ÙˆØ±ÙŠ Ø¥Ø°Ø§ ÙÙŠÙ‡ ØªØºÙŠÙŠØ±Ø§Øª Ù…Ù‡Ù…Ø©
      if (a.changes && a.changes.length > 0) {
        messages.push(buildPortfolioUpdateMsg(sym, a, trade));
      }
    }

    // Ø­ÙØ¸ Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©
    await fbSet('monitor_state', { stocks: newState, lastRun: new Date().toISOString() });

    // Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø±Ø³Ø§Ø¦Ù„
    for (const msg of messages) {
      await tgSend(msg);
      await new Promise(r => setTimeout(r, 500)); // ØªØ£Ø®ÙŠØ± Ø¨Ø³ÙŠØ· Ø¨ÙŠÙ† Ø§Ù„Ø±Ø³Ø§Ø¦Ù„
    }

  } catch (e) {
    console.error('runMonitor:', e.message);
  }
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SESSION STATE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
const sess = {};

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MESSAGE HANDLER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• CALLBACK HANDLER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
async function handleCallback(callbackId, data, cid) {
  await tgAnswerCallback(callbackId);

  const parts  = data.split('_');
  const action = parts[0];
  const sym    = parts.slice(1).join('_').toUpperCase();
  const s      = sess[cid] || {};

  // Ø§Ø´ØªØ±ÙŠØª
  if (action === 'bought') {
    sess[cid] = { ...s, step: 'ask_price' };
    await tgSend(`Ø¨ÙƒÙ… Ø§Ø´ØªØ±ÙŠØª <b>${sym}</b>ØŸ\n(Ø§ÙƒØªØ¨ 0 Ù„Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ $${s.price?.toFixed(2)})`);
    return;
  }

  // Ø£Ø¶Ù Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©
  if (action === 'watch') {
    const wData = await fbGet('watchlist');
    const list  = wData.symbols || [];
    if (!list.includes(sym)) { list.push(sym); await fbSet('watchlist', { symbols: list }); }
    const tips = [];
    if (s.analysis?.rsi > 60)             tips.push('Ø§Ù†ØªØ¸Ø± RSI ÙŠÙ‡Ø¨Ø· Ø¯ÙˆÙ† 50');
    if (s.analysis?.rsi < 40)             tips.push('RSI Ù…Ù†Ø®ÙØ¶ â€” ÙØ±ØµØ© Ù‚Ø±ÙŠØ¨Ø©');
    if (s.analysis?.macdHist < 0)         tips.push('Ø§Ù†ØªØ¸Ø± MACD ÙŠØªØ­ÙˆÙ„ Ø¥ÙŠØ¬Ø§Ø¨ÙŠØ§Ù‹');
    if (s.analysis?.weekly === 'bearish') tips.push('Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ Ù‡Ø§Ø¨Ø· â€” ØªØ­Ù„Ù‰ Ø¨Ø§Ù„ØµØ¨Ø±');
    if (!tips.length)                      tips.push('Ø±Ø§Ù‚Ø¨ ÙƒØ³Ø± Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© ÙƒØ¥Ø´Ø§Ø±Ø© Ø¯Ø®ÙˆÙ„');
    let m = `ðŸ‘ <b>${sym} Ø£Ø¶ÙŠÙ Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    tips.forEach(t => { m += `â€¢ ${t}\n`; });
    m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nâ° Ø³Ø£Ù†Ø¨Ù‡Ùƒ Ø¹Ù†Ø¯ ØªØºÙŠØ± Ù…Ù‡Ù… ðŸ‘€`;
    await tgSend(m);
    sess[cid] = {};
    return;
  }

  // Ø£Ø³Ø¹Ø§Ø± Ø£Ø³Ø¨ÙˆØ¹ Ø£Ùˆ Ø´Ù‡Ø±
  if (action === 'prices7' || action === 'prices30') {
    const isMonth = action === 'prices30';
    await tgSend(`â³ Ø¬Ø§Ø±ÙŠ Ø¬Ù„Ø¨ Ø£Ø³Ø¹Ø§Ø± <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`âš ï¸ ${sym} â€” Ù„Ù… Ø£Ø¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª`); return; }
    const count = isMonth ? 30 : 7;
    const lastN = d.dates.slice(-count);
    const clsN  = d.closes.slice(-count);
    if (!lastN.length || !clsN.length) {
      const cur = +d.quote.price;
      const curChg = +(d.quote.changePercentage || 0).toFixed(2);
      await tgSend(`ðŸ’° <b>${d.quote.name || sym} (${sym})</b>\nØ§Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ: <b>$${cur.toFixed(2)}</b> ${curChg >= 0 ? 'â–²' : 'â–¼'} ${curChg >= 0 ? '+' : ''}${curChg}%\nâš ï¸ Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª ØªØ§Ø±ÙŠØ®ÙŠØ© ÙƒØ§ÙÙŠØ© Ù„Ø¹Ø±Ø¶ ${isMonth ? 'Ø§Ù„Ø´Ù‡Ø±' : 'Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹'}.`);
      return;
    }
    const days  = ['Ø§Ù„Ø£Ø­Ø¯','Ø§Ù„Ø§Ø«Ù†ÙŠÙ†','Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡','Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡','Ø§Ù„Ø®Ù…ÙŠØ³','Ø§Ù„Ø¬Ù…Ø¹Ø©','Ø§Ù„Ø³Ø¨Øª'];
    let m = `ðŸ“… <b>${sym}</b> â€” Ø¢Ø®Ø± ${isMonth ? '30 ÙŠÙˆÙ…' : '7 Ø£ÙŠØ§Ù…'}\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    for (let i = 0; i < lastN.length; i++) {
      const date    = new Date(lastN[i]);
      const dayName = days[date.getDay()];
      const price   = clsN[i];
      const prev    = i > 0 ? clsN[i-1] : price;
      const chg     = +((price - prev) / prev * 100).toFixed(2);
      const icon    = chg > 0 ? 'â–²' : chg < 0 ? 'â–¼' : 'âž¡ï¸';
      m += `${dayName} ${lastN[i]}\n$${price.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    }
    const cur    = d.quote.price;
    const curChg = +(d.quote.changePercentage || 0).toFixed(2);
    m += `ðŸ’° Ø§Ù„Ø¢Ù†: <b>$${cur?.toFixed(2)}</b> ${curChg >= 0 ? 'â–²' : 'â–¼'} ${curChg >= 0 ? '+' : ''}${curChg}%`;
    await tgSend(m);
    return;
  }

  // Ø®Ø±ÙˆØ¬
  if (action === 'exit') {
    sess[cid] = {};
    await tgSend(`ðŸšª ØªÙ… Ø§Ù„Ø®Ø±ÙˆØ¬`);
    return;
  }

  // â”€â”€ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©
  if (action === 'menu') {
    // ØªØ­Ù„ÙŠÙ„ Ø³Ù‡Ù…
    if (sym === 'ANALYZE') {
      sess[cid] = { step: 'waiting_sym' };
      await tgSend('ðŸ“Š Ø§ÙƒØªØ¨ Ø±Ù…Ø² Ø§Ù„Ø³Ù‡Ù…:\nÙ…Ø«Ø§Ù„: <code>NVDA</code>');
      return;
    }

    // Ù…Ø­ÙØ¸ØªÙŠ
    if (sym === 'PORTFOLIO') {
      const data   = await fbGet('portfolio');
      const port   = (data.trades || []).filter(t => !t.closed);
      if (!port.length) { await tgSend('ðŸ“‚ Ù…Ø­ÙØ¸ØªÙƒ ÙØ§Ø±ØºØ©'); return; }
      const stocks = await getMultipleStocks(port.map(t => t.symbol));
      let m = 'ðŸ’¼ <b>Ù…Ø­ÙØ¸ØªÙƒ Ø§Ù„Ø¢Ù†:</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n';
      let totalPnl = 0;
      for (const t of port) {
        const cur = stocks[t.symbol]?.quote?.price || t.entry;
        const pnl = +((cur - t.entry) / t.entry * 100).toFixed(2);
        totalPnl += pnl;
        const toTarget = t.target ? +((t.target - cur) / cur * 100).toFixed(1) : null;
        m += `${pnl >= 0 ? 'âœ…' : 'âŒ'} <b>${t.symbol}</b> $${t.entry} â†’ $${cur?.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl}%)`;
        if (toTarget != null) m += ` | Ù„Ù„Ù‡Ø¯Ù: ${toTarget > 0 ? '+' : ''}${toTarget}%`;
        m += '\n';
      }
      m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Ù…ØªÙˆØ³Ø· P&L: ${totalPnl >= 0 ? '+' : ''}${+(totalPnl / port.length).toFixed(2)}%`;
      await tgSend(m);
      return;
    }

    // Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ
    if (sym === 'WATCHLIST') {
      const data   = await fbGet('watchlist');
      const list   = data.symbols || [];
      if (!list.length) { await tgSend('ðŸ‘ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© ÙØ§Ø±ØºØ©'); return; }
      const stocks = await getMultipleStocks(list);
      let m = 'ðŸ‘ <b>Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©:</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n';
      for (const s of list) {
        const q = stocks[s]?.quote;
        if (q) {
          const chg = +(q.changePercentage || 0).toFixed(2);
          m += `â€¢ <b>${s}</b> $${q.price?.toFixed(2)} ${chg >= 0 ? 'â–²' : 'â–¼'} ${chg >= 0 ? '+' : ''}${chg}%
`;
        } else { m += `â€¢ <b>${s}</b>
`; }
      }
      m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ÙŠØ±Ø§Ù‚Ø¨Ù‡Ø§ Ø§Ù„Ø¨ÙˆØª ÙŠÙˆÙ…ÙŠØ§Ù‹ ðŸ‘€`;
      await tgSend(m);
      return;
    }

    // ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø£Ø¯Ø§Ø©
    if (sym === 'REPORT') {
      await tgSend('â³ Ø¬Ø§Ø±ÙŠ ØªØ­Ø¶ÙŠØ± ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø£Ø¯Ø§Ø©...');
      await generateReport();
      return;
    }

    // Ù…Ø³Ø§Ø¹Ø¯Ø©
    if (sym === 'HELP') {
      await tgSend(
        `â“ <b>Ø§Ù„Ù…Ø³Ø§Ø¹Ø¯Ø©</b>
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
` +
        `ðŸ“Š ØªØ­Ù„ÙŠÙ„ Ø³Ù‡Ù…: Ø§ÙƒØªØ¨ Ø±Ù…Ø²Ù‡ Ù…Ø«Ù„ <code>NVDA</code>
` +
        `ðŸ’¼ Ù…Ø­ÙØ¸ØªÙŠ: Ø§ÙƒØªØ¨ <code>Ù…Ø­ÙØ¸ØªÙŠ</code>
` +
        `ðŸ‘ Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ: Ø§ÙƒØªØ¨ <code>Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ</code>
` +
        `ðŸ“ˆ ØªÙ‚Ø±ÙŠØ±: Ø§ÙƒØªØ¨ <code>ØªÙ‚Ø±ÙŠØ±</code>
` +
        `ðŸšª Ø¥ØºÙ„Ø§Ù‚ ØµÙÙ‚Ø©: <code>Ø®Ø±Ø¬Øª AAPL</code>
` +
        `ðŸ—‘ Ø­Ø°Ù Ù…Ù† Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©: <code>Ø­Ø°Ù AAPL</code>
` +
        `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
` +
        `Ø§ÙƒØªØ¨ <code>1</code> Ù„Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©`
      );
      return;
    }
  }

}

async function handleMessage(text, cid) {
  const s   = sess[cid] || {};
  const low = text.toLowerCase().trim();

  // â”€â”€ /start Ø£Ùˆ ØªØ­ÙŠØ©
  if (text === '/start' || text === 'Ù…Ø±Ø­Ø¨Ø§' || text === 'Ù‡Ù„Ø§' || text === '/help' || text === '1') {
    sess[cid] = {};
    await tgSendButtons(
      `ðŸ¦… <b>RamiMarketX â€” Ù…Ø±Ø­Ø¨Ø§Ù‹ Ø±Ø§Ù…ÙŠ!</b>\nØ§Ø®ØªØ± Ù…Ù† Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©:`,
      [
        [{ text: 'ðŸ“Š ØªØ­Ù„ÙŠÙ„ Ø³Ù‡Ù…',     callback_data: 'menu_analyze'   }],
        [{ text: 'ðŸ’¼ Ù…Ø­ÙØ¸ØªÙŠ',         callback_data: 'menu_portfolio' }],
        [{ text: 'ðŸ‘ Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ',        callback_data: 'menu_watchlist' }],
        [{ text: 'ðŸ“ˆ ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø£Ø¯Ø§Ø©',   callback_data: 'menu_report'    }],
        [{ text: 'â“ Ù…Ø³Ø§Ø¹Ø¯Ø©',          callback_data: 'menu_help'      }],
      ]
    );
    return;
  }

  // â”€â”€ Ù…Ø­ÙØ¸ØªÙŠ
  if (text === 'Ù…Ø­ÙØ¸ØªÙŠ' || text === 'portfolio') {
    const data = await fbGet('portfolio');
    const port = (data.trades || []).filter(t => !t.closed);
    if (port.length === 0) { await tgSend('ðŸ“‚ Ù…Ø­ÙØ¸ØªÙƒ ÙØ§Ø±ØºØ©'); return; }

    // Ø¬Ù„Ø¨ Ø§Ù„Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø­Ø§Ù„ÙŠØ©
    const syms   = port.map(t => t.symbol);
    const stocks = await getMultipleStocks(syms);

    let m = 'ðŸ’¼ <b>Ù…Ø­ÙØ¸ØªÙƒ Ø§Ù„Ø¢Ù†:</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n';
    let totalPnl = 0;
    for (const t of port) {
      const cur  = stocks[t.symbol]?.quote?.price || t.entry;
      const pnl  = +((cur - t.entry) / t.entry * 100).toFixed(2);
      const icon = pnl >= 0 ? 'âœ…' : 'âŒ';
      totalPnl  += pnl;
      const toTarget = t.target ? +((t.target - cur) / cur * 100).toFixed(1) : null;
      m += `${icon} <b>${t.symbol}</b> $${t.entry} â†’ $${cur?.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl}%)`;
      if (toTarget != null) m += ` | Ù„Ù„Ù‡Ø¯Ù: ${toTarget > 0 ? '+' : ''}${toTarget}%`;
      m += '\n';
    }
    m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    m += `Ù…ØªÙˆØ³Ø· P&L: ${totalPnl >= 0 ? '+' : ''}${+(totalPnl / port.length).toFixed(2)}%`;
    await tgSend(m);
    return;
  }

  // â”€â”€ Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ
  if (text === 'Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ' || text === 'watchlist') {
    const data = await fbGet('watchlist');
    const list = data.symbols || [];
    if (list.length === 0) { await tgSend('ðŸ‘ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© ÙØ§Ø±ØºØ©'); return; }

    // Ø¬Ù„Ø¨ Ø§Ù„Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø­Ø§Ù„ÙŠØ©
    const stocks = await getMultipleStocks(list);
    let m = 'ðŸ‘ <b>Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©:</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n';
    for (const sym of list) {
      const q = stocks[sym]?.quote;
      if (q) {
        const chg  = +(q.changePercentage || 0).toFixed(2);
        const icon = chg >= 0 ? 'â–²' : 'â–¼';
        m += `â€¢ <b>${sym}</b> $${q.price?.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%\n`;
      } else {
        m += `â€¢ <b>${sym}</b>\n`;
      }
    }
    m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    m += `Ø§Ù„Ø¨ÙˆØª ÙŠØ±Ø§Ù‚Ø¨Ù‡Ø§ ÙƒÙ„ 10 Ø¯Ù‚Ø§Ø¦Ù‚ ðŸ‘€`;
    await tgSend(m);
    return;
  }

  // â”€â”€ ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø£Ø¯Ø§Ø¡
  if (text === 'ØªÙ‚Ø±ÙŠØ±' || text === 'Ø£Ø¯Ø§Ø¡' || text === 'performance') {
    const history = await fbGetHistory();
    if (!history.length) {
      await tgSend('ðŸ“Š Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ ØªÙˆØµÙŠØ§Øª Ø¨Ø¹Ø¯\nØ§ÙØªØ­ Ø§Ù„Ø£Ø¯Ø§Ø© ÙˆØ§Ù†ØªØ¸Ø± ÙŠÙˆÙ… ØªØ¯Ø§ÙˆÙ„ ÙƒØ§Ù…Ù„');
      return;
    }

    const closed   = history.filter(h => h.result !== 'pending');
    const wins     = closed.filter(h => h.result === 'win');
    const losses   = closed.filter(h => h.result === 'loss');
    const pending  = history.filter(h => h.result === 'pending');
    const winRate  = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
    const avgWin   = wins.length   ? +(wins.reduce((s, h) => s + (h.pnlPct || 0), 0) / wins.length).toFixed(2)   : 0;
    const avgLoss  = losses.length ? +(losses.reduce((s, h) => s + (h.pnlPct || 0), 0) / losses.length).toFixed(2) : 0;
    const exp      = closed.length ? +((winRate / 100 * avgWin) + ((1 - winRate / 100) * avgLoss)).toFixed(2) : 0;

    // Ø£ÙØ¶Ù„ ÙˆØ£Ø³ÙˆØ£ ØªÙˆØµÙŠØ©
    const best  = wins.sort((a, b)   => (b.pnlPct || 0) - (a.pnlPct || 0))[0];
    const worst = losses.sort((a, b) => (a.pnlPct || 0) - (b.pnlPct || 0))[0];

    // Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø¬Ù„Ø³ØªÙŠÙ†
    const openRecs = closed.filter(h => h.session === 'Ø§ÙØªØªØ§Ø­');
    const midRecs  = closed.filter(h => h.session === 'Ù…Ù†ØªØµÙ');
    const openWR   = openRecs.length ? Math.round(openRecs.filter(h => h.result === 'win').length / openRecs.length * 100) : 0;
    const midWR    = midRecs.length  ? Math.round(midRecs.filter(h => h.result === 'win').length  / midRecs.length  * 100) : 0;

    let m = `ðŸ“Š <b>ØªÙ‚Ø±ÙŠØ± Ø£Ø¯Ø§Ø¡ ØªØ±ÙŠØ¯Ø± Ø¨Ø±Ùˆ X</b>\n`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    m    += `âœ… Ù†Ø§Ø¬Ø­Ø©: ${wins.length} | âŒ Ø®Ø§Ø³Ø±Ø©: ${losses.length} | â³ Ù…Ø¹Ù„Ù‚Ø©: ${pending.length}\n`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    m    += `ðŸŽ¯ Ù†Ø³Ø¨Ø© Ø§Ù„Ù†Ø¬Ø§Ø­: <b>${winRate}%</b>\n`;
    m    += `ðŸ’° Ù…ØªÙˆØ³Ø· Ø§Ù„Ø±Ø¨Ø­: <b>+${avgWin}%</b>\n`;
    m    += `ðŸ“‰ Ù…ØªÙˆØ³Ø· Ø§Ù„Ø®Ø³Ø§Ø±Ø©: <b>${avgLoss}%</b>\n`;
    m    += `ðŸ§® Ø§Ù„ØªÙˆÙ‚Ø¹ Ø§Ù„Ø±ÙŠØ§Ø¶ÙŠ: <b>${exp >= 0 ? '+' : ''}${exp}%</b>\n`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    m    += `ðŸŒ… Ø§Ù„Ø§ÙØªØªØ§Ø­: ${openWR}% Ù†Ø¬Ø§Ø­ (${openRecs.length} ØµÙÙ‚Ø©)\n`;
    m    += `ðŸŒ‡ Ø§Ù„Ù…Ù†ØªØµÙ: ${midWR}% Ù†Ø¬Ø§Ø­ (${midRecs.length} ØµÙÙ‚Ø©)\n`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    if (best)  m += `ðŸ† Ø£ÙØ¶Ù„: ${best.id} +${best.pnlPct}%\n`;
    if (worst) m += `ðŸ’€ Ø£Ø³ÙˆØ£: ${worst.id} ${worst.pnlPct}%\n`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
    const verdict = exp >= 1.5 ? 'âœ… Ø§Ù„Ø£Ø¯Ø§Ø© Ù…Ø±Ø¨Ø­Ø© â€” Ø§Ø³ØªÙ…Ø±' :
                    exp >= 0   ? 'âš ï¸ Ø§Ù„Ø£Ø¯Ø§Ø© Ù…ØªØ¹Ø§Ø¯Ù„Ø© â€” Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù…Ø¹Ø§Ø¯Ù„Ø§Øª' :
                                 'âŒ Ø§Ù„Ø£Ø¯Ø§Ø© Ø®Ø§Ø³Ø±Ø© â€” ØªÙˆÙ‚Ù ÙˆØ±Ø§Ø¬Ø¹';
    m += verdict;
    await tgSend(m);
    return;
  }

  // â”€â”€ Ø¥ØºÙ„Ø§Ù‚ ØµÙÙ‚Ø©
  if (low.startsWith('Ø®Ø±Ø¬Øª') || low.startsWith('Ø¨Ø¹Øª')) {
    const parts = text.split(/\s+/);
    const sym   = parts[1]?.toUpperCase();
    if (sym) {
      const data  = await fbGet('portfolio');
      const port  = data.trades || [];
      const trade = port.find(x => x.symbol === sym && !x.closed);
      if (trade) {
        const d    = await getStock(sym);
        const cur  = parseFloat(parts[2]) || d?.quote?.price || trade.target;
        const pnl  = +((cur - trade.entry) / trade.entry * 100).toFixed(2);
        trade.closed     = true;
        trade.closePrice = cur;
        trade.closeDate  = new Date().toISOString();
        trade.pnlPct     = pnl;
        await fbSet('portfolio', { trades: port });

        // â”€â”€ ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø³Ø¬Ù„ ÙÙŠ Firebase
        const history = await fbGetHistory();
        const rec     = history.findLast(h => h.id === sym && h.result === 'pending');
        if (rec) {
          rec.result      = pnl >= 0 ? 'win' : 'loss';
          rec.resultDate  = new Date().toISOString();
          rec.resultPrice = cur;
          rec.pnlPct      = pnl;
          // Ø­ÙØ¸ ÙÙŠ users/default
          try {
            await getDB().collection('users').doc('default')
              .collection('data').doc('rec_history')
              .set({ records: history, updatedAt: new Date() }, { merge: true });
          } catch (e) {}
        }

        await tgSend(
          `âœ… <b>${sym} Ù…ØºÙ„Ù‚Ø©</b>\n` +
          `Ø¯Ø®ÙˆÙ„: $${trade.entry} â†’ Ø®Ø±ÙˆØ¬: $${cur?.toFixed(2)}\n` +
          `${pnl >= 0 ? 'ðŸ’° Ø±Ø¨Ø­: +' : 'ðŸ“‰ Ø®Ø³Ø§Ø±Ø©: '}${pnl}%\n` +
          `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n` +
          `Ø§Ù„Ø³Ø¬Ù„ Ø­ÙØ¯Ù‘Ø« âœ…\nØ§ÙƒØªØ¨ <code>ØªÙ‚Ø±ÙŠØ±</code> Ù„ØªØ±Ù‰ Ø§Ù„Ø£Ø¯Ø§Ø¡ Ø§Ù„ÙƒÙ„ÙŠ`
        );
      } else {
        await tgSend(`âš ï¸ ${sym} ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ Ù…Ø­ÙØ¸ØªÙƒ`);
      }
    }
    sess[cid] = {};
    return;
  }

  // â”€â”€ Ø­Ø°Ù Ù…Ù† Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©
  if (low.startsWith('Ø­Ø°Ù') || low.startsWith('Ø£Ø²Ù„')) {
    const sym = text.split(/\s+/)[1]?.toUpperCase();
    if (sym) {
      const data = await fbGet('watchlist');
      const list = (data.symbols || []).filter(s => s !== sym);
      await fbSet('watchlist', { symbols: list });
      await tgSend(`ðŸ—‘ <b>${sym}</b> Ø­ÙØ°Ù Ù…Ù† Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©`);
    }
    return;
  }

  // â”€â”€ Ø§Ù†ØªØ¸Ø§Ø± Ø±Ù…Ø² Ø§Ù„Ø³Ù‡Ù… Ù…Ù† Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©
  if (s.step === 'waiting_sym') {
    const sym2 = text.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (sym2.length >= 1 && sym2.length <= 10) {
      sess[cid] = { step: 'ask_bought', sym: sym2 };
      await tgSend(`â³ Ø¬Ø§Ø±ÙŠ ØªØ­Ù„ÙŠÙ„ <b>${sym2}</b>...`);
      const d = await getStock(sym2);
      if (!d?.quote) { await tgSend(`âš ï¸ ${sym2} â€” Ù„Ù… Ø£Ø¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª`); sess[cid] = {}; return; }
      const a = analyzeStock(sym2, d.quote, d.closes, null, d.highs, d.lows);
      if (!a) {
        await tgSend(`ðŸ’° <b>${d.quote.name || sym2} (${sym2})</b>\nØ§Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ: <b>$${(+d.quote.price).toFixed(2)}</b>\nâš ï¸ Ù„Ù… ØªØªÙˆÙØ± Ø¨ÙŠØ§Ù†Ø§Øª ØªØ§Ø±ÙŠØ®ÙŠØ© ÙƒØ§ÙÙŠØ© Ù„Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„ÙÙ†ÙŠ.`);
        sess[cid] = {};
        return;
      }
      sess[cid] = { step: 'ask_bought', sym: sym2, price: d.quote.price, analysis: a };
      const buttons = [
        [{ text: 'âœ… Ø§Ø´ØªØ±ÙŠØª',          callback_data: `bought_${sym2}` }],
        [{ text: 'ðŸ‘ Ø£Ø¶Ù Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©',   callback_data: `watch_${sym2}` }],
        [
          { text: 'ðŸ“… Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹', callback_data: `prices7_${sym2}` },
          { text: 'ðŸ“† Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø´Ù‡Ø±',   callback_data: `prices30_${sym2}` },
        ],
        [{ text: 'ðŸšª Ø®Ø±ÙˆØ¬',            callback_data: `exit_${sym2}` }],
      ];
      await tgSendButtons(buildAnalysisMsg(sym2, d.quote.name || sym2, a), buttons);
    } else {
      await tgSend('âš ï¸ Ø±Ù…Ø² ØºÙŠØ± ØµØ­ÙŠØ­ â€” Ø§ÙƒØªØ¨ Ù…Ø«Ù„: <code>NVDA</code>');
    }
    return;
  }

  // â”€â”€ Ø®Ø·ÙˆØ§Øª ØªØ³Ø¬ÙŠÙ„ Ø§Ù„ØµÙÙ‚Ø©
  if (s.step === 'ask_bought') {
    if (text === '1' || text === 'Ù†Ø¹Ù…') {
      sess[cid] = { ...s, step: 'ask_price' };
      await tgSend(`Ø¨ÙƒÙ… Ø§Ø´ØªØ±ÙŠØª <b>${s.sym}</b>ØŸ\n(Ø§ÙƒØªØ¨ 0 Ù„Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ $${s.price?.toFixed(2)})`);
    } else {
      // Ø£Ø¶Ù Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©
      const data = await fbGet('watchlist');
      const list = data.symbols || [];
      if (!list.includes(s.sym)) {
        list.push(s.sym);
        await fbSet('watchlist', { symbols: list });
      }
      const tips = [];
      if (s.analysis?.rsi > 60)         tips.push('Ø§Ù†ØªØ¸Ø± RSI ÙŠÙ‡Ø¨Ø· Ø¯ÙˆÙ† 50');
      if (s.analysis?.rsi < 40)         tips.push('RSI Ù…Ù†Ø®ÙØ¶ â€” ÙØ±ØµØ© Ù‚Ø±ÙŠØ¨Ø©');
      if (s.analysis?.macdHist < 0)     tips.push('Ø§Ù†ØªØ¸Ø± MACD ÙŠØªØ­ÙˆÙ„ Ø¥ÙŠØ¬Ø§Ø¨ÙŠØ§Ù‹');
      if (s.analysis?.weekly === 'bearish') tips.push('Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ Ù‡Ø§Ø¨Ø· â€” ØªØ­Ù„Ù‰ Ø¨Ø§Ù„ØµØ¨Ø±');
      if (!tips.length)                  tips.push('Ø±Ø§Ù‚Ø¨ ÙƒØ³Ø± Ø§Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© ÙƒØ¥Ø´Ø§Ø±Ø© Ø¯Ø®ÙˆÙ„');

      let m = `ðŸ‘ <b>${s.sym} Ø£Ø¶ÙŠÙ Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n`;
      tips.forEach(t => { m += `â€¢ ${t}\n`; });
      m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nâ° Ø³Ø£Ù†Ø¨Ù‡Ùƒ Ø¹Ù†Ø¯ ØªØºÙŠØ± Ù…Ù‡Ù… ðŸ‘€\nØ§ÙƒØªØ¨ <code>Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ</code> Ù„Ø±Ø¤ÙŠØ© Ù‚Ø§Ø¦Ù…ØªÙƒ`;
      await tgSend(m);
      sess[cid] = {};
    }
    return;
  }

  if (s.step === 'ask_price') {
    const entry = parseFloat(text) === 0 ? s.price : (parseFloat(text) || s.price);
    sess[cid]   = { ...s, step: 'ask_qty', entry };
    await tgSend(`ÙƒÙ… Ø³Ù‡Ù… Ø§Ø´ØªØ±ÙŠØª Ù…Ù† <b>${s.sym}</b>ØŸ`);
    return;
  }

  if (s.step === 'ask_qty') {
    const qty    = parseInt(text) || 1;
    const atr    = s.analysis?.atrPct || 3;
    const stop   = +(s.entry * (1 - atr * 2 / 100)).toFixed(2);
    const target = +(s.entry * (1 + atr * 3.5 / 100)).toFixed(2);
    const pct    = +((target - s.entry) / s.entry * 100).toFixed(1);
    const duration = estimateTradeDuration({
      kind: 'spec',
      profitPct: pct,
      atrPct: atr,
      macdHist: s.analysis?.macdHist,
      macdHistDir: s.analysis?.macdDir,
      weeklyTrend: s.analysis?.weekly,
    });
    const durationLabel = formatTelegramDuration(duration);

    const data = await fbGet('portfolio');
    const port = data.trades || [];
    port.push({
      symbol: s.sym, entry: s.entry, qty, stop, target,
      date: new Date().toISOString(), closed: false,
    });
    await fbSet('portfolio', { trades: port });

    // Ø¥Ø²Ø§Ù„Ø© Ù…Ù† Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ø¥Ø°Ø§ ÙƒØ§Ù† ÙÙŠÙ‡Ø§
    const wData = await fbGet('watchlist');
    const wList = (wData.symbols || []).filter(x => x !== s.sym);
    await fbSet('watchlist', { symbols: wList });

    sess[cid] = {};
    await tgSend(
      `âœ… <b>ØªÙ… ØªØ³Ø¬ÙŠÙ„ ${s.sym}</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n` +
      `Ø¯Ø®ÙˆÙ„: <b>$${s.entry?.toFixed(2)}</b> Ã— ${qty} Ø³Ù‡Ù…\n` +
      `Ø±Ø£Ø³ Ø§Ù„Ù…Ø§Ù„: <b>$${(s.entry * qty).toFixed(0)}</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n` +
      `ðŸ›‘ ÙˆÙ‚Ù: <b>$${stop}</b> (-${(atr * 2).toFixed(1)}%)\n` +
      `ðŸŽ¯ Ù‡Ø¯Ù: <b>$${target}</b> (+${pct}%)\n` +
      `â±ï¸ Ù…Ø¯Ø©: ${durationLabel}\n` +
      `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n` +
      `ðŸ‘€ Ø³Ø£Ø±Ø§Ù‚Ø¨Ù‡ ÙˆØ£Ù†Ø¨Ù‡Ùƒ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹`
    );
    return;
  }

  // â”€â”€ Ø£Ø³Ø¹Ø§Ø± Ø¢Ø®Ø± Ø£Ø³Ø¨ÙˆØ¹ Ø£Ùˆ Ø´Ù‡Ø±
  const priceMatch = text.match(/^([A-Za-z0-9.\-]{1,10})\s+(Ø£Ø³Ø¹Ø§Ø±|Ø³Ø¹Ø±|ØªØ§Ø±ÙŠØ®|history|Ø´Ù‡Ø±|month|week|Ø£Ø³Ø¨ÙˆØ¹|Ø§Ø³Ø¨ÙˆØ¹)$/i);
  if (priceMatch) {
    const sym = priceMatch[1].toUpperCase();
    await tgSend(`â³ Ø¬Ø§Ø±ÙŠ Ø¬Ù„Ø¨ Ø£Ø³Ø¹Ø§Ø± <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`âš ï¸ ${sym} â€” Ù„Ù… Ø£Ø¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª`); return; }

    // Ø¢Ø®Ø± 7 Ø£ÙŠØ§Ù… Ø£Ùˆ 30 ÙŠÙˆÙ…
    const isMonth = /Ø´Ù‡Ø±|month/i.test(priceMatch[2]);
    const count   = isMonth ? 30 : 7;
    const lastN   = d.dates.slice(-count);
    const clsN    = d.closes.slice(-count);
    if (!lastN.length || !clsN.length) {
      const cur = +d.quote.price;
      const curChg = +(d.quote.changePercentage || 0).toFixed(2);
      await tgSend(`ðŸ’° <b>${d.quote.name || sym} (${sym})</b>\nØ§Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ: <b>$${cur.toFixed(2)}</b> ${curChg >= 0 ? 'â–²' : 'â–¼'} ${curChg >= 0 ? '+' : ''}${curChg}%\nâš ï¸ Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª ØªØ§Ø±ÙŠØ®ÙŠØ© ÙƒØ§ÙÙŠØ© Ù„Ø¹Ø±Ø¶ ${isMonth ? 'Ø§Ù„Ø´Ù‡Ø±' : 'Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹'}.`);
      return;
    }
    const days    = ['Ø§Ù„Ø£Ø­Ø¯','Ø§Ù„Ø§Ø«Ù†ÙŠÙ†','Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡','Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡','Ø§Ù„Ø®Ù…ÙŠØ³','Ø§Ù„Ø¬Ù…Ø¹Ø©','Ø§Ù„Ø³Ø¨Øª'];

    let m = `ðŸ“… <b>${d.quote.name || sym} (${sym})</b> â€” Ø¢Ø®Ø± ${isMonth ? '30 ÙŠÙˆÙ…' : '7 Ø£ÙŠØ§Ù…'}
`;
    m    += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
`;

    for (let i = 0; i < lastN.length; i++) {
      const date    = new Date(lastN[i]);
      const dayName = days[date.getDay()];
      const price   = clsN[i];
      const prev    = i > 0 ? clsN[i-1] : price;
      const chg     = +((price - prev) / prev * 100).toFixed(2);
      const icon    = chg > 0 ? 'â–²' : chg < 0 ? 'â–¼' : 'âž¡ï¸';
      m += `${dayName} ${lastN[i]}
`;
      m += `$${price.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%
`;
      m += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
`;
    }

    // Ø§Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ
    const cur    = d.quote.price;
    const curChg = +(d.quote.changePercentage || 0).toFixed(2);
    m += `ðŸ’° Ø§Ù„Ø¢Ù†: <b>$${cur?.toFixed(2)}</b> ${curChg >= 0 ? 'â–²' : 'â–¼'} ${curChg >= 0 ? '+' : ''}${curChg}%`;
    await tgSend(m);
    return;
  }

  // â”€â”€ ØªØ­Ù„ÙŠÙ„ Ø³Ù‡Ù… Ø¨Ø§Ù„Ø·Ù„Ø¨
  const sym = text.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  if (sym.length >= 1 && sym.length <= 10) {
    await tgSend(`â³ Ø¬Ø§Ø±ÙŠ ØªØ­Ù„ÙŠÙ„ <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`âš ï¸ ${sym} â€” Ù„Ù… Ø£Ø¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø±Ù…Ø²`); return; }

    const q    = d.quote;
    const name = q.name || sym;
    const a    = analyzeStock(sym, q, d.closes);
    if (!a) {
      await tgSend(`ðŸ’° <b>${name} (${sym})</b>\nØ§Ù„Ø³Ø¹Ø± Ø§Ù„Ø­Ø§Ù„ÙŠ: <b>$${(+q.price).toFixed(2)}</b>\nâš ï¸ Ù„Ù… ØªØªÙˆÙØ± Ø¨ÙŠØ§Ù†Ø§Øª ØªØ§Ø±ÙŠØ®ÙŠØ© ÙƒØ§ÙÙŠØ© Ù„Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„ÙÙ†ÙŠ.`);
      return;
    }

    sess[cid] = { step: 'ask_bought', sym, price: q.price, analysis: a };

    // Ø£Ø²Ø±Ø§Ø± Inline ØªØ­Øª Ø§Ù„ØªØ­Ù„ÙŠÙ„
    const buttons = [
      [{ text: 'âœ… Ø§Ø´ØªØ±ÙŠØª', callback_data: `bought_${sym}` }],
      [{ text: 'ðŸ‘ Ø£Ø¶Ù Ù„Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©', callback_data: `watch_${sym}` }],
      [
        { text: 'ðŸ“… Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹', callback_data: `prices7_${sym}` },
        { text: 'ðŸ“† Ø£Ø³Ø¹Ø§Ø± Ø§Ù„Ø´Ù‡Ø±',   callback_data: `prices30_${sym}` },
      ],
      [{ text: 'ðŸšª Ø®Ø±ÙˆØ¬', callback_data: `exit_${sym}` }],
    ];

    await tgSendButtons(buildAnalysisMsg(sym, name, a), buttons);
    return;
  }

  // â”€â”€ Ù…Ø³Ø§Ø¹Ø¯Ø© Ø§ÙØªØ±Ø§Ø¶ÙŠØ©
  await tgSend(
    `ðŸ¦… <b>RamiMarketX</b>\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n` +
    `Ø§ÙƒØªØ¨ Ø±Ù…Ø² Ø§Ù„Ø³Ù‡Ù…: <code>NVDA</code>\n` +
    `Ù…Ø­ÙØ¸ØªÙƒ: <code>Ù…Ø­ÙØ¸ØªÙŠ</code>\n` +
    `Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ: <code>Ù…Ø±Ø§Ù‚Ø¨ØªÙŠ</code>\n` +
    `ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø£Ø¯Ø§Ø¡: <code>ØªÙ‚Ø±ÙŠØ±</code>\n` +
    `Ø¥ØºÙ„Ø§Ù‚: <code>Ø®Ø±Ø¬Øª AAPL</code>\n` +
    `Ø­Ø°Ù Ù…Ù† Ø§Ù„Ù…Ø±Ø§Ù‚Ø¨Ø©: <code>Ø­Ø°Ù AAPL</code>`
  );
}

// ================================================================
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MAIN HANDLER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ================================================================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // â”€â”€ Cron: Ù…Ø±Ø§Ù‚Ø¨Ø© ÙƒÙ„ 10 Ø¯Ù‚Ø§Ø¦Ù‚
  if (req.method === 'GET' && req.query.action === 'monitor') {
    await runMonitor();
    res.status(200).json({ ok: true, action: 'monitor', time: new Date().toISOString() });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, bot: 'RamiMarketX v2 Active' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // â”€â”€ callback_query (Ø¶ØºØ· Ø²Ø±)
    if (body?.callback_query) {
      const cb  = body.callback_query;
      const cid = String(cb.message?.chat?.id);
      if (cid === TG_CHAT_ID) {
        await handleCallback(cb.id, cb.data, cid);
      }
      res.status(200).json({ ok: true });
      return;
    }

    const msg  = body?.message;
    if (!msg) { res.status(200).json({ ok: true }); return; }

    const text = msg.text?.trim() || '';
    const cid  = String(msg.chat?.id);
    if (cid !== TG_CHAT_ID) { res.status(200).json({ ok: true }); return; }

    await handleMessage(text, cid);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e.message);
    res.status(200).json({ ok: true });
  }
};
