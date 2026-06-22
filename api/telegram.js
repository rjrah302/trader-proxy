// ================================================================
// telegram.js — RamiMarketX Bot v2
// ================================================================
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

// ── Firebase
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

// ── Constants
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6195578236';
const FMP_KEY    = process.env.FMP_API_KEY;
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

// ================================================================
// ═══════════════════ TELEGRAM HELPERS ═══════════════════════════
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

// إرسال رسالة مع أزرار Inline
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

// تعديل رسالة موجودة (لإزالة الأزرار بعد الضغط)
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

// الرد على callback_query
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
// ═══════════════════ FIREBASE HELPERS ═══════════════════════════
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

// ── قراءة سجل التوصيات من users/default (الأداة الرئيسية)
async function fbGetHistory() {
  try {
    const s = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('rec_history').get();
    return s.exists ? (s.data().records || []) : [];
  } catch (e) { return []; }
}

// ================================================================
// ═══════════════════ FMP HELPERS ════════════════════════════════
// ================================================================
async function getStock(sym) {
  try {
    const [q, h] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=300&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);
    const quote   = Array.isArray(q) ? q[0] : null;
    const history = Array.isArray(h) ? h : [];
    // نفس منطق الأداة — نفلتر صفوف كاملة OHLC فقط
    const valid   = history.filter(d => (+d.adjClose||+d.close) && +d.high && +d.low && +d.open);
    const closes  = valid.map(d => +(d.adjClose||d.close)).reverse();
    const highs   = valid.map(d => +d.high).reverse();
    const lows    = valid.map(d => +d.low).reverse();
    const opens   = valid.map(d => +d.open).reverse();
    const dates   = valid.map(d => d.date).reverse();
    return { quote, closes, highs, lows, opens, dates };
  } catch (e) { return null; }
}

// جلب أسعار متعددة دفعة واحدة
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
// ═══════════════════ TECHNICAL INDICATORS ═══════════════════════
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
  const prevHist = prevArr.length && prevSig ? prevArr[prevArr.length - 1] - prevSig : null;

  // نفس منطق الأداة — القيمة المطلقة + عبور الصفر
  let dir = null;
  if (prevHist != null) {
    const sameSign = (hist >= 0) === (prevHist >= 0);
    if (!sameSign) {
      dir = 'crossing';
    } else {
      dir = Math.abs(hist) > Math.abs(prevHist) ? 'expanding' : 'contracting';
    }
  }

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

  // نفس خوارزمية الأداة — قمم وقيعان حقيقية مع clusters
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
    ?? +Math.min(...l.slice(-60)).toFixed(2); // ← 60 يوم للـ fallback

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

// ── أنماط الشموع — نفس الأداة الرئيسية بالضبط
function detectCandlePatterns(closes, highs, lows, opens) {
  if (!closes || closes.length < 3) return [];
  if (!opens || opens.length !== closes.length) return [];

  const n = closes.length;
  const patterns = [];

  const C0 = closes[n-1], H0 = highs[n-1], L0 = lows[n-1], O0 = opens[n-1];
  const C1 = closes[n-2], H1 = highs[n-2], L1 = lows[n-2], O1 = opens[n-2];
  const C2 = n>=4 ? closes[n-3] : C1;
  const H2 = n>=4 ? highs[n-3]  : H1;
  const L2 = n>=4 ? lows[n-3]   : L1;
  const O2 = n>=4 ? opens[n-3]  : O1;

  const body0 = Math.abs(C0-O0), range0 = H0-L0 || 0.0001;
  const body1 = Math.abs(C1-O1), range1 = H1-L1 || 0.0001;
  const body2 = Math.abs(C2-O2), range2 = H2-L2 || 0.0001;

  const bull0 = C0>O0, bear0 = C0<O0;
  const bull1 = C1>O1, bear1 = C1<O1;
  const bull2 = C2>O2, bear2 = C2<O2;

  const upperShadow0 = bull0 ? H0-C0 : H0-O0;
  const lowerShadow0 = bull0 ? O0-L0 : C0-L0;

  if (body0/range0 < 0.05)
    patterns.push({ar:'دوجي', signal:'neutral', strength:2, tip:'تردد — انتظر تأكيد'});
  if (lowerShadow0 > body0*2 && upperShadow0 < body0*0.5 && range0 > 0) {
    const downtrend = closes.slice(-6,-1).every((_,i,a) => i===0 || a[i] <= a[i-1]);
    if (downtrend || lowerShadow0 > body0*3)
      patterns.push({ar:'المطرقة', signal:'bullish', strength:4, tip:'ارتداد صاعد قوي'});
  }
  if (upperShadow0 > body0*2 && lowerShadow0 < body0*0.5 && range0 > 0) {
    const uptrend = closes.slice(-6,-1).every((_,i,a) => i===0 || a[i] >= a[i-1]);
    if (uptrend || upperShadow0 > body0*3)
      patterns.push({ar:'النجم الساقط', signal:'bearish', strength:4, tip:'انعكاس هبوطي'});
  }
  if (bull0 && bear1 && C0 >= O1 && O0 <= C1 && body0 > body1)
    patterns.push({ar:'الابتلاع الصاعد', signal:'bullish', strength:5, tip:'انعكاس صاعد قوي'});
  if (bear0 && bull1 && O0 >= C1 && C0 <= O1 && body0 > body1)
    patterns.push({ar:'الابتلاع الهابط', signal:'bearish', strength:5, tip:'انعكاس هبوطي قوي'});
  if (n >= 4 && bear2 && body1/range1 < 0.3 && bull0 && C0 > (O2+C2)/2)
    patterns.push({ar:'نجمة الصباح', signal:'bullish', strength:5, tip:'انعكاس صاعد من 3 شمعات'});
  if (n >= 4 && bull2 && body1/range1 < 0.3 && bear0 && C0 < (O2+C2)/2)
    patterns.push({ar:'نجمة المساء', signal:'bearish', strength:5, tip:'انعكاس هبوطي من 3 شمعات'});
  if (n >= 4 && bull0 && bull1 && bull2 && body0>range0*0.5 && body1>range1*0.5 && C0>C1 && C1>C2)
    patterns.push({ar:'الجنود الثلاثة', signal:'bullish', strength:5, tip:'زخم صاعد استثنائي'});
  if (n >= 4 && bear0 && bear1 && bear2 && body0>range0*0.5 && body1>range1*0.5 && C0<C1 && C1<C2)
    patterns.push({ar:'الغربان الثلاثة', signal:'bearish', strength:5, tip:'زخم هبوطي قوي'});

  return patterns.sort((a,b) => b.strength - a.strength).slice(0,2);
}

// ── Stochastic RSI
function calcStochRSI(closes) {
  if (!closes || closes.length < 20) return null;
  const rsiArr = [];
  for (let i = 14; i <= closes.length; i++) {
    const sl   = closes.slice(i - 14, i);
    const diffs = sl.map((v, j) => j > 0 ? v - sl[j-1] : 0).slice(1);
    const ag   = diffs.map(x => x > 0 ? x : 0).reduce((a, b) => a + b, 0) / 14;
    const al   = diffs.map(x => x < 0 ? -x : 0).reduce((a, b) => a + b, 0) / 14;
    rsiArr.push(al === 0 ? 100 : 100 - (100 / (1 + ag / al)));
  }
  if (rsiArr.length < 14) return null;
  const last14 = rsiArr.slice(-14);
  const minR   = Math.min(...last14);
  const maxR   = Math.max(...last14);
  return maxR === minR ? 50 : +((rsiArr[rsiArr.length-1] - minR) / (maxR - minR) * 100).toFixed(1);
}

// ── حساب وقف وهدف وR/R — نفس الأداة الرئيسية
function calcStopTarget(price, support, resistance, atrPct) {
  const atrVal      = atrPct || 3;
  const atrMultFinal= atrVal < 2 ? 1.5 : atrVal < 4 ? 2.0 : 2.5;
  const atrStop     = Math.min(atrVal * atrMultFinal, 15);
  const atrBasedStop= price * (1 - atrStop / 100);
  const supBasedStop= support ? support * 0.99 : null;
  const stopLoss    = Math.max(
    supBasedStop && supBasedStop > atrBasedStop ? supBasedStop : atrBasedStop,
    price * 0.75
  );
  const minTarget   = price * 1.03;
  const atrTarget   = price * (1 + Math.max(atrStop * 2, 3) / 100);
  const atrRealist  = price + (price * atrVal / 100 * 3.5);
  const resValid    = resistance && resistance > price * 1.02 && resistance > minTarget;
  const isNearRes   = resistance && price >= resistance * 0.98;
  const target      = isNearRes
    ? resistance * 1.05
    : resValid
      ? Math.min(resistance, atrRealist > minTarget ? atrRealist : resistance)
      : Math.max(atrTarget, minTarget);
  const profitPct   = (target - price) / price * 100;
  const lossPct     = (price - stopLoss) / price * 100;
  const rr          = lossPct > 0 ? +(profitPct / lossPct).toFixed(2) : 0;
  return { stopLoss: +stopLoss.toFixed(2), target: +target.toFixed(2), profitPct: +profitPct.toFixed(2), lossPct: +lossPct.toFixed(2), rr };
}

// ── تحليل شامل لسهم — نفس منطق الأداة الرئيسية
function analyzeStock(sym, quote, closes, prevAnalysis = null, highs = null, lows = null, opens = null) {
  if (!quote || !closes.length) return null;

  const price  = quote.price;
  const change = quote.changePercentage || 0;
  const rsi    = calcRSI(closes);
  const stochRsi = calcStochRSI(closes);
  const macd   = calcMACD(closes);
  const weekly = calcWeeklyTrend(closes);
  const levels = calcSupRes(closes, highs || closes, lows || closes, price);
  const atrPct = calcATR(closes);
  const green  = calcGreenCandles(closes);

  // ── الشموع — تمرير opens الحقيقي
  const candlePatterns = detectCandlePatterns(closes, highs, lows, opens);

  // ── Bollinger Bands
  let bb_lower = null, bb_upper = null;
  if (closes.length >= 20) {
    const last20 = closes.slice(-20);
    const ma20   = last20.reduce((a, b) => a + b, 0) / 20;
    const std    = Math.sqrt(last20.reduce((s, v) => s + Math.pow(v - ma20, 2), 0) / 20);
    bb_upper = ma20 + 2 * std;
    bb_lower = ma20 - 2 * std;
  }

  // ── MA20 و MA50
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  // ── نقاط الإشارة — نفس منطق الأداة
  let buy = 0, sell = 0;
  const signals = [], risks = [];

  // MACD مع crossing
  if (macd.hist > 0 && macd.dir === 'expanding')        { buy += 2; signals.push('MACD زخم صاعد قوي ↑'); }
  else if (macd.hist > 0 && macd.dir === 'crossing')    { buy += 2; signals.push('MACD عبر الصفر للأعلى ↑'); }
  else if (macd.hist > 0)                               { buy++;    signals.push('MACD صاعد يضعف'); }
  else if (macd.hist < 0 && macd.dir === 'contracting') { buy++;    signals.push('MACD سالب يتقلص ↗'); }
  else if (macd.hist < 0 && macd.dir === 'crossing')    { sell++;   risks.push('MACD عبر الصفر للأسفل ↓'); }
  else if (macd.hist < 0 && macd.dir === 'expanding')   { sell += 2; risks.push('MACD هابط يتوسع ↓'); }
  else if (macd.hist < 0)                               { sell++;   risks.push('MACD هابط'); }

  // RSI
  if (rsi !== null) {
    if (rsi < 30)       { buy += 2;  signals.push('RSI '+rsi+' — تشبع بيع شديد 🔥'); }
    else if (rsi < 40)  { buy++;     signals.push('RSI '+rsi+' — منطقة شراء'); }
    else if (rsi > 75)  { sell += 2; risks.push('RSI '+rsi+' — تشبع شراء ⚠️'); }
    else if (rsi > 65)  { sell++;    risks.push('RSI '+rsi+' — مرتفع'); }
  }

  // MA
  if (ma20 && ma50) {
    if (ma20 > ma50 && price > ma20)  { buy++;   signals.push('فوق MA20 وMA50 ✅'); }
    else if (ma20 < ma50)             { sell++;  risks.push('MA20 تحت MA50 ❌'); }
  }

  // Bollinger
  if (bb_lower && price <= bb_lower) { buy++;   signals.push('عند Bollinger السفلي'); }
  if (bb_upper && price >= bb_upper) { sell++;  risks.push('عند Bollinger العلوي'); }

  // أسبوعي
  if (weekly === 'bullish') { buy++;   signals.push('أسبوعي صاعد ✅'); }
  else                      { sell++;  risks.push('أسبوعي هابط ❌'); }

  // شموع
  if (green >= 4) { buy++;  signals.push(green+' شموع خضراء من 5'); }
  else if (green <= 1) { sell++; risks.push('شموع حمراء متتالية'); }

  // أنماط الشموع
  candlePatterns.forEach(p => {
    if (p.signal === 'bullish') { buy++;  signals.push('شمعة '+p.ar+' — '+p.tip); }
    else if (p.signal === 'bearish') { sell++; risks.push('شمعة '+p.ar+' — '+p.tip); }
  });

  // حجب: RSI مرتفع + قريب من المقاومة
  const nearRes = levels.resistance && price >= levels.resistance * 0.98;
  if (rsi !== null && rsi > 70 && nearRes) { sell += 4; risks.push('RSI مرتفع + قريب من المقاومة ⛔'); }
  else if (rsi !== null && rsi > 72)       { sell += 2; risks.push('RSI مرتفع جداً ⚠️'); }

  const score   = buy - sell;
  let verdict, vIcon;
  if      (score >= 4) { verdict = 'شراء قوي';              vIcon = '✅'; }
  else if (score >= 2) { verdict = 'إيجابي — يمكن الدخول';  vIcon = '⚠️'; }
  else if (score === 0){ verdict = 'إشارات متضاربة — انتظر'; vIcon = '⏳'; }
  else                  { verdict = 'سلبي — تجنب الدخول';   vIcon = '❌'; }

  // ── اكتشاف التغييرات الجوهرية
  const changes = [];
  if (prevAnalysis) {
    if (prevAnalysis.macdHist < 0 && macd.hist > 0)
      changes.push('🚀 MACD تحوّل إيجابياً — إشارة شراء جديدة!');
    if (prevAnalysis.macdHist > 0 && macd.hist < 0)
      changes.push('⚠️ MACD تحوّل سلبياً — كن حذراً');
    if (prevAnalysis.macdDir === 'contracting' && macd.dir === 'expanding' && macd.hist > 0)
      changes.push('📈 زخم MACD بدأ يتوسع — الزخم يتسارع');
    if (prevAnalysis.rsi > 40 && rsi < 35)
      changes.push('🎯 RSI دخل منطقة تشبع البيع — فرصة اقتربت');
    if (prevAnalysis.rsi < 70 && rsi > 75)
      changes.push('🔔 RSI دخل منطقة تشبع الشراء — راقب الخروج');
    if (levels.support && price <= levels.support * 1.015 && prevAnalysis.price > levels.support * 1.015)
      changes.push('🛡 السعر لامس الدعم $' + levels.support + ' — نقطة دخول محتملة');
    if (prevAnalysis.weekly === 'bearish' && weekly === 'bullish')
      changes.push('🌟 الاتجاه الأسبوعي تحوّل صاعداً!');
  }

  return {
    price: +price.toFixed(2), change: +change.toFixed(2),
    rsi, stochRsi, macdHist: macd.hist, macdDir: macd.dir, macdLine: macd.macdLine,
    weekly, support: levels.support, resistance: levels.resistance,
    atrPct, green, bb_lower, bb_upper, ma20, ma50,
    signals, risks, score, verdict, vIcon, changes,
    candlePatterns,
  };
}

// ================================================================
// ═══════════════════ MESSAGE BUILDERS ═══════════════════════════
// ================================================================

// رسالة تحليل سهم كامل — نفس الأداة الرئيسية
function buildAnalysisMsg(sym, name, a) {
  const st = calcStopTarget(a.price, a.support, a.resistance, a.atrPct);

  let m = `📊 <b>${name || sym} (${sym})</b>\n`;
  m    += `💰 <b>$${a.price}</b> ${a.change >= 0 ? '📈' : '📉'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `──────────────\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? '✅' : a.macdHist < 0 && a.macdDir === 'contracting' ? '⚠️' : '❌';
    const mDir  = a.macdDir === 'expanding' ? '↑ يتوسع' : a.macdDir === 'crossing' ? '⚡ عبر الصفر' : '↓ يضيق';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${mDir}\n`;
  }
  if (a.rsi != null) {
    const rIcon = a.rsi < 35 ? '🔥' : a.rsi > 70 ? '⚠️' : '•';
    const rNote = a.rsi < 35 ? 'تشبع بيع' : a.rsi > 70 ? 'تشبع شراء' : 'محايد';
    m += `RSI: ${rIcon} ${a.rsi} — ${rNote}\n`;
  }
  if (a.stochRsi != null) {
    const sIcon = a.stochRsi < 20 ? '🔥' : a.stochRsi > 80 ? '⚠️' : '•';
    m += `Stoch RSI: ${sIcon} ${a.stochRsi}\n`;
  }
  m += `أسبوعي: ${a.weekly === 'bullish' ? '✅ صاعد' : '❌ هابط'}\n`;
  if (a.ma20 && a.ma50) m += `MA: ${a.ma20 > a.ma50 ? '✅' : '❌'} MA20 ${a.ma20 > a.ma50 ? '>' : '<'} MA50\n`;
  if (a.bb_lower) m += `BB: ${a.price <= a.bb_lower ? '🔥 عند الحد السفلي' : a.price >= a.bb_upper ? '⚠️ عند الحد العلوي' : '• داخل النطاق'}\n`;
  m += `──────────────\n`;
  if (a.support)    m += `🟢 دعم: <b>$${a.support}</b>\n`;
  if (a.resistance) m += `🔴 مقاومة: <b>$${a.resistance}</b>\n`;
  m += `🛑 وقف: <b>$${st.stopLoss}</b> (-${st.lossPct}%)\n`;
  m += `🎯 هدف: <b>$${st.target}</b> (+${st.profitPct}%)\n`;
  m += `📐 R/R: <b>${st.rr}x</b>\n`;
  m += `──────────────\n`;

  // أنماط الشموع
  if (a.candlePatterns && a.candlePatterns.length > 0) {
    a.candlePatterns.forEach(p => {
      m += `${p.signal === 'bullish' ? '🕯✅' : p.signal === 'bearish' ? '🕯❌' : '🕯'} ${p.ar} — ${p.tip}\n`;
    });
    m += `──────────────\n`;
  }

  m += `🤖 <b>التحليل:</b>\n`;
  a.signals.forEach(s => { m += `✅ ${s}\n`; });
  a.risks.forEach(r   => { m += `❌ ${r}\n`; });
  m += `──────────────\n`;
  m += `${a.vIcon} <b>${a.verdict}</b>\n`;
  m += `──────────────\n`;
  m += `هل اشتريت ${sym}؟\n1️⃣ نعم  2️⃣ لا — أضف للمراقبة`;
  return m;
}

// رسالة تحديث سهم في المراقبة (كل 10 دقائق)
function buildWatchUpdateMsg(sym, a, prevA) {
  const hasChanges = a.changes && a.changes.length > 0;

  let m = `👁 <b>تحديث ${sym}</b> — ${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}\n`;
  m    += `──────────────\n`;
  m    += `💰 $${a.price} ${a.change >= 0 ? '▲' : '▼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? '✅' : '❌';
    const mDir  = a.macdDir === 'expanding' ? '↑' : '↓';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${mDir}\n`;
  }
  if (a.rsi != null) {
    const rIcon = a.rsi < 35 ? '🔥' : a.rsi > 70 ? '⚠️' : '•';
    m += `RSI: ${rIcon} ${a.rsi}\n`;
  }
  m += `أسبوعي: ${a.weekly === 'bullish' ? '✅ صاعد' : '❌ هابط'}\n`;
  m += `──────────────\n`;

  if (hasChanges) {
    m += `<b>⚡ تغيرات مهمة:</b>\n`;
    a.changes.forEach(c => { m += `${c}\n`; });
    m += `──────────────\n`;
  }

  m += `${a.vIcon} ${a.verdict}`;
  return m;
}

// رسالة تحديث سهم في المحفظة
function buildPortfolioUpdateMsg(sym, a, trade) {
  const pnl    = +((a.price - trade.entry) / trade.entry * 100).toFixed(2);
  const pnlIcon = pnl >= 0 ? '📈' : '📉';
  const toTarget = trade.target ? +((trade.target - a.price) / a.price * 100).toFixed(2) : null;
  const toStop   = trade.stop   ? +((a.price - trade.stop)  / a.price * 100).toFixed(2) : null;
  const hasChanges = a.changes && a.changes.length > 0;

  let m = `💼 <b>تحديث ${sym}</b> — محفظتك\n`;
  m    += `──────────────\n`;
  m    += `💰 $${a.price} ${a.change >= 0 ? '▲' : '▼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `${pnlIcon} P&L: <b>${pnl >= 0 ? '+' : ''}${pnl}%</b> (دخول $${trade.entry})\n`;
  if (toTarget != null) m += `🎯 للهدف: ${toTarget > 0 ? '+' : ''}${toTarget}% ($${trade.target})\n`;
  if (toStop   != null) m += `🛑 للوقف: -${toStop}% ($${trade.stop})\n`;
  m += `──────────────\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? '✅' : '❌';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${a.macdDir === 'expanding' ? '↑' : '↓'}\n`;
  }
  if (a.rsi != null) m += `RSI: ${a.rsi < 35 ? '🔥' : a.rsi > 70 ? '⚠️' : '•'} ${a.rsi}\n`;
  m += `──────────────\n`;

  if (hasChanges) {
    a.changes.forEach(c => { m += `${c}\n`; });
    m += `──────────────\n`;
  }

  m += `${a.vIcon} ${a.verdict}`;
  return m;
}


// ================================================================
// ═══════════════════ REPORT GENERATOR ═══════════════════════════
// ================================================================
async function generateReport() {
  try {
    let history = await fbGetHistory();
    if (!history.length) {
      await tgSend('📊 لا يوجد سجل توصيات بعد\nافتح الأداة في يوم تداول وانتظر توليد التوصيات');
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
      const openR   = closed.filter(h => h.session === 'افتتاح');
      const midR    = closed.filter(h => h.session === 'منتصف');
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
        if (exp >= 3 && winRate >= 55) return '✅ المجازفة مربحة جداً — استمر';
        if (exp >= 1 && winRate >= 45) return '⚠️ المجازفة متعادلة — راجع الشروط';
        return '❌ المجازفة خاسرة — شدد الشروط';
      }
      if (exp >= 2 && winRate >= 60) return '✅ الأداة ممتازة — استمر';
      if (exp >= 1 && winRate >= 50) return '✅ الأداة مربحة — جيد';
      if (exp >= 0 && winRate >= 45) return '⚠️ الأداة متعادلة — راجع المعادلات';
      if (winRate >= 40)             return '⚠️ أداء ضعيف — خفف المخاطرة';
      return '❌ الأداة خاسرة — أوقف وراجع الكود';
    }

    const rw = calcStats(recWeek);
    const ra = calcStats(recAll);
    const sw = calcStats(specWeek);
    const sa = calcStats(specAll);

    const dateStr = new Date().toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // رسالة 1 — التوصيات
    let msg1 = `📊 <b>التوصيات</b>\n📅 ${dateStr}\n━━━━━━━━━━━━━━━━\n\n`;
    msg1 += `🗓 <b>هذا الأسبوع (${rw.total} توصية)</b>\n──────────────\n`;
    if (!rw.wins && !rw.losses) {
      msg1 += `⏳ لا توجد نتائج مغلقة بعد\n`;
    } else {
      msg1 += `✅ ${rw.wins} ناجحة  ❌ ${rw.losses} خاسرة  ⏳ ${rw.pending} معلقة\n`;
      msg1 += `🎯 نسبة النجاح: <b>${rw.winRate}%</b>\n`;
      msg1 += `💰 متوسط الربح: <b>+${rw.avgWin}%</b>\n`;
      msg1 += `📉 متوسط الخسارة: <b>${rw.avgLoss}%</b>\n`;
      msg1 += `🧮 التوقع الرياضي: <b>${rw.exp >= 0 ? '+' : ''}${rw.exp}%</b>\n`;
      if (rw.openWR !== null) msg1 += `──────────────\n🌅 الافتتاح: ${rw.openWR}% (${rw.openCount})\n`;
      if (rw.midWR  !== null) msg1 += `🌇 المنتصف: ${rw.midWR}% (${rw.midCount})\n`;
      if (rw.best)  msg1 += `──────────────\n🏆 أفضل: <b>${rw.best.id}</b> +${rw.best.pnlPct}%\n`;
      if (rw.worst) msg1 += `💀 أسوأ: <b>${rw.worst.id}</b> ${rw.worst.pnlPct}%\n`;
    }
    msg1 += `\n${getVerdict(rw.exp, rw.winRate)}\n\n━━━━━━━━━━━━━━━━\n\n`;
    msg1 += `📈 <b>الكلي (${ra.total} توصية)</b>\n──────────────\n`;
    msg1 += `✅ ${ra.wins}  ❌ ${ra.losses}  ⏳ ${ra.pending}\n`;
    msg1 += `🎯 نسبة النجاح: <b>${ra.winRate}%</b>\n`;
    msg1 += `🧮 التوقع الرياضي: <b>${ra.exp >= 0 ? '+' : ''}${ra.exp}%</b>\n`;
    msg1 += `\n${getVerdict(ra.exp, ra.winRate)}`;
    await tgSend(msg1);

    // رسالة 2 — المجازفة
    if (sa.total > 0) {
      let msg2 = `🎲 <b>المجازفة</b>\n━━━━━━━━━━━━━━━━\n\n`;
      msg2 += `🗓 <b>هذا الأسبوع (${sw.total} فرصة)</b>\n──────────────\n`;
      if (!sw.wins && !sw.losses) {
        msg2 += `⏳ لا توجد نتائج بعد\n`;
      } else {
        msg2 += `✅ ${sw.wins} ناجحة  ❌ ${sw.losses} خاسرة  ⏳ ${sw.pending} معلقة\n`;
        msg2 += `🎯 نسبة النجاح: <b>${sw.winRate}%</b>\n`;
        msg2 += `💰 متوسط الربح: <b>+${sw.avgWin}%</b>\n`;
        msg2 += `🧮 التوقع الرياضي: <b>${sw.exp >= 0 ? '+' : ''}${sw.exp}%</b>\n`;
        if (sw.avgRR) msg2 += `📐 متوسط R/R: <b>1:${sw.avgRR}</b>\n`;
        if (sw.best)  msg2 += `──────────────\n🏆 أفضل: <b>${sw.best.id}</b> +${sw.best.pnlPct}%\n`;
      }
      msg2 += `\n${getVerdict(sw.exp, sw.winRate, true)}\n\n━━━━━━━━━━━━━━━━\n\n`;
      msg2 += `📈 <b>الكلي (${sa.total} فرصة)</b>\n──────────────\n`;
      msg2 += `✅ ${sa.wins}  ❌ ${sa.losses}  ⏳ ${sa.pending}\n`;
      msg2 += `🎯 نسبة النجاح: <b>${sa.winRate}%</b>\n`;
      if (sa.avgRR) msg2 += `📐 متوسط R/R: <b>1:${sa.avgRR}</b>\n`;
      msg2 += `\n${getVerdict(sa.exp, sa.winRate, true)}`;
      await tgSend(msg2);
    }

  } catch(e) {
    console.error('generateReport:', e.message);
    await tgSend(`⚠️ خطأ في التقرير: ${e.message}`);
  }
}

// ================================================================
// ═══════════════════ MONITOR (كل 10 دقائق) ══════════════════════
// ================================================================
async function runMonitor() {
  try {
    // جلب البيانات
    const [watchData, portData, prevStateData] = await Promise.all([
      fbGet('watchlist'),
      fbGet('portfolio'),
      fbGet('monitor_state'),
    ]);

    const watchList  = watchData.symbols  || [];
    const portfolio  = (portData.trades   || []).filter(t => !t.closed);
    const prevState  = prevStateData.stocks || {};

    // جمع كل الرموز
    const allSymbols = [...new Set([
      ...watchList,
      ...portfolio.map(t => t.symbol),
    ])];

    if (allSymbols.length === 0) return;

    // جلب البيانات من FMP
    const stocksData = await getMultipleStocks(allSymbols);
    const newState   = {};
    const messages   = [];

    // ── معالجة قائمة المراقبة
    for (const sym of watchList) {
      const d = stocksData[sym];
      if (!d?.quote) continue;

      const prev = prevState[sym] || null;
      const a    = analyzeStock(sym, d.quote, d.closes, prev, d.highs, d.lows, d.opens);
      if (!a) continue;

      newState[sym] = {
        price:    a.price,
        rsi:      a.rsi,
        macdHist: a.macdHist,
        macdDir:  a.macdDir,
        weekly:   a.weekly,
        updatedAt: new Date().toISOString(),
      };

      // أرسل فقط إذا فيه تغييرات مهمة
      if (a.changes && a.changes.length > 0) {
        messages.push(buildWatchUpdateMsg(sym, a, prev));
      }
    }

    // ── معالجة المحفظة
    for (const trade of portfolio) {
      const sym = trade.symbol;
      const d   = stocksData[sym];
      if (!d?.quote) continue;

      const prev = prevState[sym] || null;
      const a    = analyzeStock(sym, d.quote, d.closes, prev, d.highs, d.lows, d.opens);
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

      // تنبيه وصول الهدف
      if (trade.target && a.price >= trade.target) {
        messages.push(
          `🎯 <b>${sym} وصل الهدف!</b>\n` +
          `$${trade.entry} → $${a.price}\n` +
          `ربح: +${pnl}% 🎉\n` +
          `اكتب: <code>خرجت ${sym}</code>`
        );
        continue;
      }

      // تنبيه اقتراب الوقف
      if (trade.stop && a.price <= trade.stop * 1.02 && a.price > trade.stop) {
        messages.push(
          `⚠️ <b>${sym} اقترب من الوقف!</b>\n` +
          `السعر: $${a.price} | وقف: $${trade.stop}\n` +
          `P&L: ${pnl}%\nكن مستعداً للخروج`
        );
        continue;
      }

      // تنبيه كسر الوقف
      if (trade.stop && a.price <= trade.stop) {
        messages.push(
          `🚨 <b>${sym} كسر الوقف!</b>\n` +
          `$${a.price} < $${trade.stop}\n` +
          `خسارة: ${pnl}%\n` +
          `اخرج فوراً! اكتب: <code>خرجت ${sym}</code>`
        );
        continue;
      }

      // تحديث دوري إذا فيه تغييرات مهمة
      if (a.changes && a.changes.length > 0) {
        messages.push(buildPortfolioUpdateMsg(sym, a, trade));
      }
    }

    // حفظ الحالة الجديدة
    await fbSet('monitor_state', { stocks: newState, lastRun: new Date().toISOString() });

    // إرسال الرسائل
    for (const msg of messages) {
      await tgSend(msg);
      await new Promise(r => setTimeout(r, 500)); // تأخير بسيط بين الرسائل
    }

  } catch (e) {
    console.error('runMonitor:', e.message);
  }
}

// ================================================================
// ═══════════════════ SESSION STATE ══════════════════════════════
// ================================================================
const sess = {};

// ================================================================
// ═══════════════════ MESSAGE HANDLER ════════════════════════════
// ================================================================

// ================================================================
// ═══════════════════ CALLBACK HANDLER ═══════════════════════════
// ================================================================
async function handleCallback(callbackId, data, cid) {
  await tgAnswerCallback(callbackId);

  const parts  = data.split('_');
  const action = parts[0];
  const sym    = parts.slice(1).join('_').toUpperCase();
  const s      = sess[cid] || {};

  // اشتريت
  if (action === 'bought') {
    sess[cid] = { ...s, step: 'ask_price' };
    await tgSend(`بكم اشتريت <b>${sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);
    return;
  }

  // أضف للمراقبة
  if (action === 'watch') {
    const wData = await fbGet('watchlist');
    const list  = wData.symbols || [];
    if (!list.includes(sym)) { list.push(sym); await fbSet('watchlist', { symbols: list }); }
    const tips = [];
    if (s.analysis?.rsi > 60)             tips.push('انتظر RSI يهبط دون 50');
    if (s.analysis?.rsi < 40)             tips.push('RSI منخفض — فرصة قريبة');
    if (s.analysis?.macdHist < 0)         tips.push('انتظر MACD يتحول إيجابياً');
    if (s.analysis?.weekly === 'bearish') tips.push('الأسبوعي هابط — تحلى بالصبر');
    if (!tips.length)                      tips.push('راقب كسر المقاومة كإشارة دخول');
    let m = `👁 <b>${sym} أضيف للمراقبة</b>\n──────────────\n`;
    tips.forEach(t => { m += `• ${t}\n`; });
    m += `──────────────\n⏰ سأنبهك عند تغير مهم 👀`;
    await tgSend(m);
    sess[cid] = {};
    return;
  }

  // أسعار أسبوع أو شهر
  if (action === 'prices7' || action === 'prices30') {
    const isMonth = action === 'prices30';
    await tgSend(`⏳ جاري جلب أسعار <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`⚠️ ${sym} — لم أجد بيانات`); return; }
    const count = isMonth ? 30 : 7;
    const lastN = d.dates.slice(-count);
    const clsN  = d.closes.slice(-count);
    const days  = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    let m = `📅 <b>${sym}</b> — آخر ${isMonth ? '30 يوم' : '7 أيام'}\n──────────────\n`;
    for (let i = 0; i < lastN.length; i++) {
      const date    = new Date(lastN[i]);
      const dayName = days[date.getDay()];
      const price   = clsN[i];
      const prev    = i > 0 ? clsN[i-1] : price;
      const chg     = +((price - prev) / prev * 100).toFixed(2);
      const icon    = chg > 0 ? '▲' : chg < 0 ? '▼' : '➡️';
      m += `${dayName} ${lastN[i]}\n$${price.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%\n──────────────\n`;
    }
    const cur    = d.quote.price;
    const curChg = +(d.quote.changePercentage || 0).toFixed(2);
    m += `💰 الآن: <b>$${cur?.toFixed(2)}</b> ${curChg >= 0 ? '▲' : '▼'} ${curChg >= 0 ? '+' : ''}${curChg}%`;
    await tgSend(m);
    return;
  }

  // خروج
  if (action === 'exit') {
    sess[cid] = {};
    await tgSend(`🚪 تم الخروج`);
    return;
  }

  // ── القائمة الرئيسية
  if (action === 'menu') {
    // تحليل سهم
    if (sym === 'ANALYZE') {
      sess[cid] = { step: 'waiting_sym' };
      await tgSend('📊 اكتب رمز السهم:\nمثال: <code>NVDA</code>');
      return;
    }

    // محفظتي
    if (sym === 'PORTFOLIO') {
      const data   = await fbGet('portfolio');
      const port   = (data.trades || []).filter(t => !t.closed);
      if (!port.length) { await tgSend('📂 محفظتك فارغة'); return; }
      const stocks = await getMultipleStocks(port.map(t => t.symbol));
      let m = '💼 <b>محفظتك الآن:</b>\n──────────────\n';
      let totalPnl = 0;
      for (const t of port) {
        const cur = stocks[t.symbol]?.quote?.price || t.entry;
        const pnl = +((cur - t.entry) / t.entry * 100).toFixed(2);
        totalPnl += pnl;
        const toTarget = t.target ? +((t.target - cur) / cur * 100).toFixed(1) : null;
        m += `${pnl >= 0 ? '✅' : '❌'} <b>${t.symbol}</b> $${t.entry} → $${cur?.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl}%)`;
        if (toTarget != null) m += ` | للهدف: ${toTarget > 0 ? '+' : ''}${toTarget}%`;
        m += '\n';
      }
      m += `──────────────
متوسط P&L: ${totalPnl >= 0 ? '+' : ''}${+(totalPnl / port.length).toFixed(2)}%`;
      await tgSend(m);
      return;
    }

    // مراقبتي
    if (sym === 'WATCHLIST') {
      const data   = await fbGet('watchlist');
      const list   = data.symbols || [];
      if (!list.length) { await tgSend('👁 قائمة المراقبة فارغة'); return; }
      const stocks = await getMultipleStocks(list);
      let m = '👁 <b>قائمة المراقبة:</b>\n──────────────\n';
      for (const s of list) {
        const q = stocks[s]?.quote;
        if (q) {
          const chg = +(q.changePercentage || 0).toFixed(2);
          m += `• <b>${s}</b> $${q.price?.toFixed(2)} ${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : ''}${chg}%
`;
        } else { m += `• <b>${s}</b>
`; }
      }
      m += `──────────────
يراقبها البوت يومياً 👀`;
      await tgSend(m);
      return;
    }

    // صائد الارتداد
    if (sym === 'HUNTER') {
      await handleMessage('صائد', cid);
      return;
    }

    // تقرير الأداة
    if (sym === 'REPORT') {
      await tgSend('⏳ جاري تحضير تقرير الأداة...');
      await generateReport();
      return;
    }

    // مساعدة
    if (sym === 'HELP') {
      await tgSend(
        `❓ <b>المساعدة</b>\n──────────────\n` +
        `📊 تحليل سهم: اكتب رمزه مثل <code>NVDA</code>\n` +
        `🎯 صائد الارتداد: <code>صائد</code>\n` +
        `💼 محفظتي: <code>محفظتي</code>\n` +
        `👁 مراقبتي: <code>مراقبتي</code>\n` +
        `📈 تقرير: <code>تقرير</code>\n` +
        `🚪 إغلاق: <code>خرجت AAPL</code>\n` +
        `🗑 حذف: <code>حذف AAPL</code>\n` +
        `──────────────\n` +
        `اكتب <code>1</code> للقائمة`
      );
      return;
    }
  }

  // ── القائمة الرئيسية
  if (action === 'menu') {
    if (sym === 'ANALYZE') {
      sess[cid] = { step: 'waiting_sym' };
      await tgSend('📊 اكتب رمز السهم:\nمثال: <code>NVDA</code>');
      return;
    }
    if (sym === 'PORTFOLIO') {
      const pd   = await fbGet('portfolio');
      const pp   = (pd.trades || []).filter(t => !t.closed);
      if (!pp.length) { await tgSend('📂 محفظتك فارغة'); return; }
      const pst  = await getMultipleStocks(pp.map(t => t.symbol));
      let pm = '💼 <b>محفظتك الآن:</b>\n──────────────\n';
      let ptotal = 0;
      for (const t of pp) {
        const pc  = pst[t.symbol]?.quote?.price || t.entry;
        const pp2 = +((pc - t.entry) / t.entry * 100).toFixed(2);
        ptotal += pp2;
        pm += `${pp2 >= 0 ? '✅' : '❌'} <b>${t.symbol}</b> $${t.entry} → $${pc?.toFixed(2)} (${pp2 >= 0 ? '+' : ''}${pp2}%)\n`;
      }
      pm += `──────────────\nمتوسط P&L: ${+(ptotal / pp.length).toFixed(2)}%`;
      await tgSend(pm);
      return;
    }
    if (sym === 'WATCHLIST') {
      const wd  = await fbGet('watchlist');
      const wl  = wd.symbols || [];
      if (!wl.length) { await tgSend('👁 قائمة المراقبة فارغة'); return; }
      const wst = await getMultipleStocks(wl);
      let wm = '👁 <b>قائمة المراقبة:</b>\n──────────────\n';
      for (const ws of wl) {
        const wq = wst[ws]?.quote;
        if (wq) {
          const wc = +(wq.changePercentage || 0).toFixed(2);
          wm += `• <b>${ws}</b> $${wq.price?.toFixed(2)} ${wc >= 0 ? '▲' : '▼'} ${wc >= 0 ? '+' : ''}${wc}%\n`;
        } else { wm += `• <b>${ws}</b>\n`; }
      }
      await tgSend(wm);
      return;
    }
    if (sym === 'REPORT') {
      await tgSend('⏳ جاري تحضير تقرير الأداة...');
      await generateReport();
      return;
    }
    if (sym === 'HELP') {
      await tgSend(
        '❓ <b>المساعدة</b>\n──────────────\n' +
        'تحليل سهم: اكتب رمزه مثل <code>NVDA</code>\n' +
        'محفظتي: اكتب <code>محفظتي</code>\n' +
        'مراقبتي: اكتب <code>مراقبتي</code>\n' +
        'تقرير: اكتب <code>تقرير</code>\n' +
        'إغلاق: <code>خرجت AAPL</code>\n──────────────\n' +
        'اكتب <code>1</code> للقائمة'
      );
      return;
    }
  }
}

async function handleMessage(text, cid) {
  const s   = sess[cid] || {};
  const low = text.toLowerCase().trim();

  // ── /start أو تحية
  if (text === '/start' || text === 'مرحبا' || text === 'هلا' || text === '/help' || text === '1') {
    sess[cid] = {};
    await tgSendButtons(
      `🦅 <b>RamiMarketX — مرحباً رامي!</b>\nاختر من القائمة:`,
      [
        [{ text: '📊 تحليل سهم',     callback_data: 'menu_analyze'   }],
        [{ text: '🎯 صائد الارتداد', callback_data: 'menu_hunter'    }],
        [{ text: '💼 محفظتي',         callback_data: 'menu_portfolio' }],
        [{ text: '👁 مراقبتي',        callback_data: 'menu_watchlist' }],
        [{ text: '📈 تقرير الأداة',   callback_data: 'menu_report'    }],
        [{ text: '❓ مساعدة',          callback_data: 'menu_help'      }],
      ]
    );
    return;
  }

  // ── صائد الارتداد
  if (text === 'صائد' || text === 'hunter' || text === 'ارتداد') {
    await tgSend('⏳ جاري تشغيل صائد الارتداد...\nسيفحص الأسهم التي عندها RSI منخفض وبيانات ارتداد...');
    const candidates = [
      'NVDA','AMD','TSLA','META','AAPL','MSFT','AMZN','GOOGL',
      'PLTR','CRWD','NET','SNOW','DDOG','APP','SMCI','SOUN',
      'COIN','MARA','RIVN','RKLB','IONQ','ASTS','ACHR','CVNA',
    ];
    const stocksData = await getMultipleStocks(candidates);
    const results    = [];

    for (const sym of candidates) {
      const d = stocksData[sym];
      if (!d?.quote) continue;
      const a = analyzeStock(sym, d.quote, d.closes, null, d.highs, d.lows, d.opens);
      if (!a) continue;

      // شروط الصائد — RSI منخفض + MACD يتحسن + عند الدعم
      const rsiOk    = a.rsi != null && a.rsi < 40;
      const macdOk   = a.macdHist != null && (
        a.macdDir === 'crossing' ||
        (a.macdHist < 0 && a.macdDir === 'contracting') ||
        a.macdHist > 0
      );
      const supOk    = a.support && d.quote.price <= a.support * 1.05;
      const bbOk     = a.bb_lower && d.quote.price <= a.bb_lower * 1.02;
      const stochOk  = a.stochRsi != null && a.stochRsi < 30;

      let hunterScore = 0;
      if (rsiOk)   hunterScore += 30;
      if (macdOk)  hunterScore += 25;
      if (supOk)   hunterScore += 20;
      if (bbOk)    hunterScore += 15;
      if (stochOk) hunterScore += 10;

      if (hunterScore >= 50) {
        const st = calcStopTarget(d.quote.price, a.support, a.resistance, a.atrPct);
        results.push({ sym, name: d.quote.name || sym, score: hunterScore, a, st });
      }
    }

    results.sort((x, y) => y.score - x.score);

    if (!results.length) {
      await tgSend('🎯 <b>صائد الارتداد</b>\n──────────────\nلا توجد فرص ارتداد واضحة الآن\nجرب لاحقاً عند انخفاض السوق');
      return;
    }

    let m = `🎯 <b>صائد الارتداد — ${results.length} فرصة</b>\n──────────────\n`;
    for (const r of results.slice(0, 5)) {
      const chgIcon = r.a.change >= 0 ? '▲' : '▼';
      m += `\n<b>${r.sym}</b> ${r.name}\n`;
      m += `$${r.a.price} ${chgIcon} ${r.a.change}% | Score: ${r.score}\n`;
      m += `RSI: ${r.a.rsi} | Stoch: ${r.a.stochRsi || '—'}\n`;
      m += `🛑 $${r.st.stopLoss} | 🎯 $${r.st.target} | R/R: ${r.st.rr}x\n`;
      m += `MACD: ${r.a.macdHist > 0 ? '✅' : r.a.macdDir === 'contracting' ? '⚠️↗' : '❌'}\n`;
      m += `──────────────\n`;
    }
    m += `\nاكتب رمز السهم للتحليل الكامل`;
    await tgSend(m);
    return;
  }

  // ── محفظتي
  if (text === 'محفظتي' || text === 'portfolio') {
    const data = await fbGet('portfolio');
    const port = (data.trades || []).filter(t => !t.closed);
    if (port.length === 0) { await tgSend('📂 محفظتك فارغة'); return; }

    // جلب الأسعار الحالية
    const syms   = port.map(t => t.symbol);
    const stocks = await getMultipleStocks(syms);

    let m = '💼 <b>محفظتك الآن:</b>\n──────────────\n';
    let totalPnl = 0;
    for (const t of port) {
      const cur  = stocks[t.symbol]?.quote?.price || t.entry;
      const pnl  = +((cur - t.entry) / t.entry * 100).toFixed(2);
      const icon = pnl >= 0 ? '✅' : '❌';
      totalPnl  += pnl;
      const toTarget = t.target ? +((t.target - cur) / cur * 100).toFixed(1) : null;
      m += `${icon} <b>${t.symbol}</b> $${t.entry} → $${cur?.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl}%)`;
      if (toTarget != null) m += ` | للهدف: ${toTarget > 0 ? '+' : ''}${toTarget}%`;
      m += '\n';
    }
    m += `──────────────\n`;
    m += `متوسط P&L: ${totalPnl >= 0 ? '+' : ''}${+(totalPnl / port.length).toFixed(2)}%`;
    await tgSend(m);
    return;
  }

  // ── مراقبتي
  if (text === 'مراقبتي' || text === 'watchlist') {
    const data = await fbGet('watchlist');
    const list = data.symbols || [];
    if (list.length === 0) { await tgSend('👁 قائمة المراقبة فارغة'); return; }

    // جلب الأسعار الحالية
    const stocks = await getMultipleStocks(list);
    let m = '👁 <b>قائمة المراقبة:</b>\n──────────────\n';
    for (const sym of list) {
      const q = stocks[sym]?.quote;
      if (q) {
        const chg  = +(q.changePercentage || 0).toFixed(2);
        const icon = chg >= 0 ? '▲' : '▼';
        m += `• <b>${sym}</b> $${q.price?.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%\n`;
      } else {
        m += `• <b>${sym}</b>\n`;
      }
    }
    m += `──────────────\n`;
    m += `البوت يراقبها كل 10 دقائق 👀`;
    await tgSend(m);
    return;
  }

  // ── تقرير الأداء
  if (text === 'تقرير' || text === 'أداء' || text === 'performance') {
    const history = await fbGetHistory();
    if (!history.length) {
      await tgSend('📊 لا يوجد سجل توصيات بعد\nافتح الأداة وانتظر يوم تداول كامل');
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

    // أفضل وأسوأ توصية
    const best  = wins.sort((a, b)   => (b.pnlPct || 0) - (a.pnlPct || 0))[0];
    const worst = losses.sort((a, b) => (a.pnlPct || 0) - (b.pnlPct || 0))[0];

    // مقارنة الجلستين
    const openRecs = closed.filter(h => h.session === 'افتتاح');
    const midRecs  = closed.filter(h => h.session === 'منتصف');
    const openWR   = openRecs.length ? Math.round(openRecs.filter(h => h.result === 'win').length / openRecs.length * 100) : 0;
    const midWR    = midRecs.length  ? Math.round(midRecs.filter(h => h.result === 'win').length  / midRecs.length  * 100) : 0;

    let m = `📊 <b>تقرير أداء تريدر برو X</b>\n`;
    m    += `──────────────\n`;
    m    += `✅ ناجحة: ${wins.length} | ❌ خاسرة: ${losses.length} | ⏳ معلقة: ${pending.length}\n`;
    m    += `──────────────\n`;
    m    += `🎯 نسبة النجاح: <b>${winRate}%</b>\n`;
    m    += `💰 متوسط الربح: <b>+${avgWin}%</b>\n`;
    m    += `📉 متوسط الخسارة: <b>${avgLoss}%</b>\n`;
    m    += `🧮 التوقع الرياضي: <b>${exp >= 0 ? '+' : ''}${exp}%</b>\n`;
    m    += `──────────────\n`;
    m    += `🌅 الافتتاح: ${openWR}% نجاح (${openRecs.length} صفقة)\n`;
    m    += `🌇 المنتصف: ${midWR}% نجاح (${midRecs.length} صفقة)\n`;
    m    += `──────────────\n`;
    if (best)  m += `🏆 أفضل: ${best.id} +${best.pnlPct}%\n`;
    if (worst) m += `💀 أسوأ: ${worst.id} ${worst.pnlPct}%\n`;
    m    += `──────────────\n`;
    const verdict = exp >= 1.5 ? '✅ الأداة مربحة — استمر' :
                    exp >= 0   ? '⚠️ الأداة متعادلة — راجع المعادلات' :
                                 '❌ الأداة خاسرة — توقف وراجع';
    m += verdict;
    await tgSend(m);
    return;
  }

  // ── إغلاق صفقة
  if (low.startsWith('خرجت') || low.startsWith('بعت')) {
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

        // ── تحديث السجل في Firebase
        const history = await fbGetHistory();
        const rec     = history.findLast(h => h.id === sym && h.result === 'pending');
        if (rec) {
          rec.result      = pnl >= 0 ? 'win' : 'loss';
          rec.resultDate  = new Date().toISOString();
          rec.resultPrice = cur;
          rec.pnlPct      = pnl;
          // حفظ في users/default
          try {
            await getDB().collection('users').doc('default')
              .collection('data').doc('rec_history')
              .set({ records: history, updatedAt: new Date() }, { merge: true });
          } catch (e) {}
        }

        await tgSend(
          `✅ <b>${sym} مغلقة</b>\n` +
          `دخول: $${trade.entry} → خروج: $${cur?.toFixed(2)}\n` +
          `${pnl >= 0 ? '💰 ربح: +' : '📉 خسارة: '}${pnl}%\n` +
          `──────────────\n` +
          `السجل حُدّث ✅\nاكتب <code>تقرير</code> لترى الأداء الكلي`
        );
      } else {
        await tgSend(`⚠️ ${sym} غير موجود في محفظتك`);
      }
    }
    sess[cid] = {};
    return;
  }

  // ── حذف من المراقبة
  if (low.startsWith('حذف') || low.startsWith('أزل')) {
    const sym = text.split(/\s+/)[1]?.toUpperCase();
    if (sym) {
      const data = await fbGet('watchlist');
      const list = (data.symbols || []).filter(s => s !== sym);
      await fbSet('watchlist', { symbols: list });
      await tgSend(`🗑 <b>${sym}</b> حُذف من قائمة المراقبة`);
    }
    return;
  }

  // ── انتظار رمز السهم من القائمة
  if (s.step === 'waiting_sym') {
    const sym2 = text.toUpperCase().replace(/[^A-Z.]/g, '');
    if (sym2.length >= 1 && sym2.length <= 5) {
      sess[cid] = { step: 'ask_bought', sym: sym2 };
      await tgSend(`⏳ جاري تحليل <b>${sym2}</b>...`);
      const d = await getStock(sym2);
      if (!d?.quote) { await tgSend(`⚠️ ${sym2} — لم أجد بيانات`); sess[cid] = {}; return; }
      const a = analyzeStock(sym2, d.quote, d.closes, null, d.highs, d.lows, d.opens);
      if (!a) { await tgSend(`⚠️ ${sym2} — بيانات غير كافية`); sess[cid] = {}; return; }
      sess[cid] = { step: 'ask_bought', sym: sym2, price: d.quote.price, analysis: a };
      const buttons = [
        [{ text: '✅ اشتريت',          callback_data: `bought_${sym2}` }],
        [{ text: '👁 أضف للمراقبة',   callback_data: `watch_${sym2}` }],
        [
          { text: '📅 أسعار الأسبوع', callback_data: `prices7_${sym2}` },
          { text: '📆 أسعار الشهر',   callback_data: `prices30_${sym2}` },
        ],
        [{ text: '🚪 خروج',            callback_data: `exit_${sym2}` }],
      ];
      await tgSendButtons(buildAnalysisMsg(sym2, d.quote.name || sym2, a), buttons);
    } else {
      await tgSend('⚠️ رمز غير صحيح — اكتب مثل: <code>NVDA</code>');
    }
    return;
  }

  // ── خطوات تسجيل الصفقة
  if (s.step === 'ask_bought') {
    if (text === '1' || text === 'نعم') {
      sess[cid] = { ...s, step: 'ask_price' };
      await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);
    } else {
      // أضف للمراقبة
      const data = await fbGet('watchlist');
      const list = data.symbols || [];
      if (!list.includes(s.sym)) {
        list.push(s.sym);
        await fbSet('watchlist', { symbols: list });
      }
      const tips = [];
      if (s.analysis?.rsi > 60)         tips.push('انتظر RSI يهبط دون 50');
      if (s.analysis?.rsi < 40)         tips.push('RSI منخفض — فرصة قريبة');
      if (s.analysis?.macdHist < 0)     tips.push('انتظر MACD يتحول إيجابياً');
      if (s.analysis?.weekly === 'bearish') tips.push('الأسبوعي هابط — تحلى بالصبر');
      if (!tips.length)                  tips.push('راقب كسر المقاومة كإشارة دخول');

      let m = `👁 <b>${s.sym} أضيف للمراقبة</b>\n──────────────\n`;
      tips.forEach(t => { m += `• ${t}\n`; });
      m += `──────────────\n⏰ سأنبهك عند تغير مهم 👀\nاكتب <code>مراقبتي</code> لرؤية قائمتك`;
      await tgSend(m);
      sess[cid] = {};
    }
    return;
  }

  if (s.step === 'ask_price') {
    const entry = parseFloat(text) === 0 ? s.price : (parseFloat(text) || s.price);
    sess[cid]   = { ...s, step: 'ask_qty', entry };
    await tgSend(`كم سهم اشتريت من <b>${s.sym}</b>؟`);
    return;
  }

  if (s.step === 'ask_qty') {
    const qty    = parseInt(text) || 1;
    const st     = calcStopTarget(s.entry, s.analysis?.support, s.analysis?.resistance, s.analysis?.atrPct);
    const stop   = st.stopLoss;
    const target = st.target;
    const pct    = st.profitPct;

    const data = await fbGet('portfolio');
    const port = data.trades || [];
    port.push({
      symbol: s.sym, entry: s.entry, qty, stop, target,
      date: new Date().toISOString(), closed: false,
    });
    await fbSet('portfolio', { trades: port });

    // إزالة من المراقبة إذا كان فيها
    const wData = await fbGet('watchlist');
    const wList = (wData.symbols || []).filter(x => x !== s.sym);
    await fbSet('watchlist', { symbols: wList });

    sess[cid] = {};
    await tgSend(
      `✅ <b>تم تسجيل ${s.sym}</b>\n──────────────\n` +
      `دخول: <b>$${s.entry?.toFixed(2)}</b> × ${qty} سهم\n` +
      `رأس المال: <b>$${(s.entry * qty).toFixed(0)}</b>\n──────────────\n` +
      `🛑 وقف: <b>$${stop}</b> (-${st.lossPct}%)\n` +
      `🎯 هدف: <b>$${target}</b> (+${pct}%)\n` +
      `📐 R/R: <b>${st.rr}x</b>\n` +
      `──────────────\n` +
      `👀 سأراقبه وأنبهك تلقائياً`
    );
    return;
  }

  // ── أسعار آخر أسبوع أو شهر
  const priceMatch = text.match(/^([A-Za-z]{1,5})\s+(أسعار|سعر|تاريخ|history|شهر|month)$/i);
  if (priceMatch) {
    const sym = priceMatch[1].toUpperCase();
    await tgSend(`⏳ جاري جلب أسعار <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`⚠️ ${sym} — لم أجد بيانات`); return; }

    // آخر 7 أيام أو 30 يوم
    const isMonth = /شهر|month/i.test(priceMatch[2]);
    const count   = isMonth ? 30 : 7;
    const lastN   = d.dates.slice(-count);
    const clsN    = d.closes.slice(-count);
    const days    = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

    let m = `📅 <b>${d.quote.name || sym} (${sym})</b> — آخر ${isMonth ? '30 يوم' : '7 أيام'}
`;
    m    += `──────────────
`;

    for (let i = 0; i < lastN.length; i++) {
      const date    = new Date(lastN[i]);
      const dayName = days[date.getDay()];
      const price   = clsN[i];
      const prev    = i > 0 ? clsN[i-1] : price;
      const chg     = +((price - prev) / prev * 100).toFixed(2);
      const icon    = chg > 0 ? '▲' : chg < 0 ? '▼' : '➡️';
      m += `${dayName} ${lastN[i]}
`;
      m += `$${price.toFixed(2)} ${icon} ${chg >= 0 ? '+' : ''}${chg}%
`;
      m += `──────────────
`;
    }

    // السعر الحالي
    const cur    = d.quote.price;
    const curChg = +(d.quote.changePercentage || 0).toFixed(2);
    m += `💰 الآن: <b>$${cur?.toFixed(2)}</b> ${curChg >= 0 ? '▲' : '▼'} ${curChg >= 0 ? '+' : ''}${curChg}%`;
    await tgSend(m);
    return;
  }

  // ── تحليل سهم بالطلب
  const sym = text.toUpperCase().replace(/[^A-Z.]/g, '');
  if (sym.length >= 1 && sym.length <= 5) {
    await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`⚠️ ${sym} — لم أجد بيانات. تحقق من الرمز`); return; }

    const q    = d.quote;
    const name = q.name || sym;
    const a    = analyzeStock(sym, q, d.closes, null, d.highs, d.lows, d.opens);
    if (!a) { await tgSend(`⚠️ ${sym} — بيانات غير كافية`); return; }

    sess[cid] = { step: 'ask_bought', sym, price: q.price, analysis: a };

    // أزرار Inline تحت التحليل
    const buttons = [
      [{ text: '✅ اشتريت', callback_data: `bought_${sym}` }],
      [{ text: '👁 أضف للمراقبة', callback_data: `watch_${sym}` }],
      [
        { text: '📅 أسعار الأسبوع', callback_data: `prices7_${sym}` },
        { text: '📆 أسعار الشهر',   callback_data: `prices30_${sym}` },
      ],
      [{ text: '🚪 خروج', callback_data: `exit_${sym}` }],
    ];

    await tgSendButtons(buildAnalysisMsg(sym, name, a), buttons);
    return;
  }

  // ── مساعدة افتراضية
  await tgSend(
    `🦅 <b>RamiMarketX</b>\n──────────────\n` +
    `اكتب رمز السهم: <code>NVDA</code>\n` +
    `محفظتك: <code>محفظتي</code>\n` +
    `مراقبتي: <code>مراقبتي</code>\n` +
    `تقرير الأداء: <code>تقرير</code>\n` +
    `إغلاق: <code>خرجت AAPL</code>\n` +
    `حذف من المراقبة: <code>حذف AAPL</code>`
  );
}

// ================================================================
// ═══════════════════ MAIN HANDLER ═══════════════════════════════
// ================================================================
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── Cron: مراقبة كل 10 دقائق
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

    // ── callback_query (ضغط زر)
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
