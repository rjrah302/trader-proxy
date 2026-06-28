// ================================================================
// telegram.js — RamiMarketX Bot v2
// ================================================================
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');
const RamiAnalysis                       = require('../public/sharedAnalysis.js');

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

// ── آخر نتائج محفوظة من الأداة نفسها: توصيات / مجازفة / صائد
async function fbGetLatestTabs() {
  try {
    const s = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('latest_tabs').get();
    return s.exists ? s.data() : {};
  } catch (e) { return {}; }
}

function htmlSafe(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '—';
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
}

function fmtRR(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}x` : '—';
}

function fmtSavedTime(v) {
  if (!v) return 'غير متاح';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

function getLatestTabItems(data, kind) {
  if (kind === 'recs') return Array.isArray(data?.recs) ? data.recs : [];
  if (kind === 'spec') return Array.isArray(data?.spec) ? data.spec : [];
  if (kind === 'hunter') return Array.isArray(data?.hunter) ? data.hunter : [];
  return [];
}

function latestCardRank(x) {
  const text = `${x?.decision || ''} ${x?.signal || ''} ${x?.actionTone || ''} ${x?.note || ''}`.toLowerCase();
  if (/ادخل|دخول فعلي|شراء قوي|دخول مسموح|buy/.test(text) && !/لا تدخل|لا تطارد|مراقبة فقط|راقب/.test(text)) return 0;
  if (/شراء مشروط|عند الدعم|راقب|مراقبة|انتظار|support|watch/.test(text)) return 1;
  if (/لا تطارد|لا تدخل|ممنوع|تجنب|chase/.test(text)) return 2;
  return 1;
}

function latestCardRankLabel(rank) {
  if (rank === 0) return '✅ دخول';
  if (rank === 1) return '👁 مراقبة';
  return '⛔ لا تطارد';
}

function formatLatestTabsMessage(kind, data) {
  const titles = {
    recs: '🎯 توصيات الأداة',
    spec: '🎲 المجازفة',
    hunter: '🎯 الصائد',
  };
  const empty = {
    recs: 'لا توجد توصيات محفوظة الآن.',
    spec: 'لا توجد فرص مجازفة محفوظة الآن.',
    hunter: 'لا توجد فرص صائد محفوظة الآن.',
  };
  const rawItems = getLatestTabItems(data, kind);
  const decorated = rawItems
    .map((x, i) => ({ x, i, rank: latestCardRank(x) }))
    .sort((a, b) => a.rank - b.rank || Number(b.x?.score || 0) - Number(a.x?.score || 0));
  const actionableCount = decorated.filter(v => v.rank === 0).length;
  const watchCount = decorated.filter(v => v.rank === 1).length;
  const avoidCount = decorated.filter(v => v.rank === 2).length;
  const items = decorated
    .filter(v => v.rank < 2)
    .slice(0, kind === 'hunter' ? 8 : 6);
  const fallbackAvoid = !items.length ? decorated.filter(v => v.rank === 2).slice(0, 3) : [];
  const shown = items.length ? items : fallbackAvoid;
  const market = data?.market || {};
  const savedAt = data?.times?.[kind === 'recs' ? 'recs' : kind] || data?.savedAt;
  const marketLine = `SPY ${fmtPct(market.spyChange)} | QQQ ${fmtPct(market.qqqChange)} | ${market.open ? 'السوق مفتوح' : 'السوق مغلق'}`;

  let m = `<b>${titles[kind]}</b>\n`;
  m += `آخر تحديث: ${fmtSavedTime(savedAt)}\n`;
  m += `${marketLine}\n`;
  m += `دخول: ${actionableCount} | مراقبة: ${watchCount} | لا تطارد: ${avoidCount}\n`;
  m += `──────────────\n`;

  if (!rawItems.length) {
    m += `${empty[kind]}\n`;
    m += `افتح الأداة وانتظر اكتمال التحميل إذا كنت تريد تحديث القائمة.`;
    return m;
  }

  if (!items.length && fallbackAvoid.length) {
    m += `لا توجد فرص دخول أو مراقبة قوية الآن. هذه أكثر أسهم ظهرت لكن قرارها <b>لا تطارد</b>:\n`;
    m += `──────────────\n`;
  }

  shown.forEach(({ x, rank }, i) => {
    const symbol = htmlSafe(x.id || x.symbol || '—');
    const name = htmlSafe(x.name || '');
    const decision = htmlSafe(x.decision || x.signal || 'مراقبة');
    const note = htmlSafe(x.note || '');
    m += `${i + 1}) ${latestCardRankLabel(rank)} <b>${symbol}</b>${name ? ` — ${name}` : ''}\n`;
    m += `القرار: <b>${decision}</b>\n`;
    m += `السعر ${fmtMoney(x.price || x.entry)} | دخول ${fmtMoney(x.entry)} | هدف ${fmtMoney(x.target)} | وقف ${fmtMoney(x.stopLoss)} | R/R ${fmtRR(x.riskReward)}\n`;
    if (Number.isFinite(Number(x.score)) && Number(x.score) > 0) m += `القوة: ${Number(x.score).toFixed(0)}/100\n`;
    if (note) m += `ملاحظة: ${note}\n`;
    m += `──────────────\n`;
  });

  if (avoidCount > fallbackAvoid.length && !items.length) {
    m += `تم إخفاء ${avoidCount - fallbackAvoid.length} بطاقة لا تطارد لتقليل الضجيج.\n`;
  }
  m += `للتفصيل اكتب رمز السهم مثل NVDA، أو افتح البطاقة كاملة في الأداة.`;
  return m;
}

// ================================================================
// ═══════════════════ FMP HELPERS ════════════════════════════════
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

// ── تحليل شامل لسهم
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

  // ── نقاط الإشارة
  let buy = 0, sell = 0;
  const signals = [], risks = [];

  if (macd.hist > 0 && macd.dir === 'expanding')  { buy += 2; signals.push('MACD زخم صاعد قوي ↑'); }
  else if (macd.hist > 0)                          { buy++;    signals.push('MACD صاعد يضعف'); }
  else if (macd.hist < 0 && macd.dir === 'expanding') { sell += 2; risks.push('MACD هابط يتوسع ↓'); }
  else if (macd.hist < 0)                          { sell++;   risks.push('MACD هابط'); }

  if (rsi !== null) {
    if (rsi < 30)       { buy += 2;  signals.push('RSI '+rsi+' — تشبع بيع شديد 🔥'); }
    else if (rsi < 40)  { buy++;     signals.push('RSI '+rsi+' — منطقة شراء'); }
    else if (rsi > 75)  { sell += 2; risks.push('RSI '+rsi+' — تشبع شراء ⚠️'); }
    else if (rsi > 65)  { sell++;    risks.push('RSI '+rsi+' — مرتفع'); }
  }

  if (weekly === 'bullish') { buy++;   signals.push('أسبوعي صاعد ✅'); }
  else                      { sell++;  risks.push('أسبوعي هابط ❌'); }

  if (green >= 4) { buy++;   signals.push(green+' شموع خضراء من 5'); }
  else if (green <= 1) { sell++; risks.push('شموع حمراء متتالية'); }

  // ✅ حجب: RSI مرتفع + قريب من المقاومة
  const nearRes = levels.resistance && price >= levels.resistance * 0.98;
  if (rsi !== null && rsi > 70 && nearRes) { sell += 4; risks.push('RSI مرتفع + قريب من المقاومة ⛔'); }
  else if (rsi !== null && rsi > 72)       { sell += 2; risks.push('RSI مرتفع جداً ⚠️'); }

  const score   = buy - sell;
  let verdict, vIcon;
  if      (score >= 3) { verdict = 'إشارة شراء قوية';        vIcon = '✅'; }
  else if (score >= 1) { verdict = 'إيجابي — يمكن الدخول';   vIcon = '⚠️'; }
  else if (score === 0){ verdict = 'إشارات متضاربة — انتظر'; vIcon = '⏳'; }
  else                  { verdict = 'سلبي — تجنب الدخول';    vIcon = '❌'; }

  // ── اكتشاف التغييرات الجوهرية (للتنبيه)
  const changes = [];
  if (prevAnalysis) {
    // MACD تحول
    if (prevAnalysis.macdHist < 0 && macd.hist > 0)
      changes.push('🚀 MACD تحوّل إيجابياً — إشارة شراء جديدة!');
    if (prevAnalysis.macdHist > 0 && macd.hist < 0)
      changes.push('⚠️ MACD تحوّل سلبياً — كن حذراً');
    // MACD اتجاه
    if (prevAnalysis.macdDir === 'contracting' && macd.dir === 'expanding' && macd.hist > 0)
      changes.push('📈 زخم MACD بدأ يتوسع — الزخم يتسارع');
    // RSI
    if (prevAnalysis.rsi > 40 && rsi < 35)
      changes.push('🎯 RSI دخل منطقة تشبع البيع — فرصة اقتربت');
    if (prevAnalysis.rsi < 70 && rsi > 75)
      changes.push('🔔 RSI دخل منطقة تشبع الشراء — راقب الخروج');
    // السعر عند الدعم
    if (levels.support && price <= levels.support * 1.015 && prevAnalysis.price > levels.support * 1.015)
      changes.push('🛡 السعر لامس الدعم $' + levels.support + ' — نقطة دخول محتملة');
    // حركة سعر قوية منذ آخر فحص
    if (prevAnalysis.price > 0) {
      const priceMove = +((price - prevAnalysis.price) / prevAnalysis.price * 100).toFixed(2);
      if (priceMove >= 3) changes.push('🚀 السعر تحرك +' + priceMove + '% منذ آخر فحص — راقب تأكيد الحجم والزخم');
      if (priceMove <= -3) changes.push('⚠️ السعر تراجع ' + priceMove + '% منذ آخر فحص — راقب الدعم والوقف');
    }
    // تحول الاتجاه الأسبوعي
    if (prevAnalysis.weekly === 'bearish' && weekly === 'bullish')
      changes.push('🌟 الاتجاه الأسبوعي تحوّل صاعداً!');
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
    changes,  // التغييرات الجوهرية — للتنبيه
  };
}

// ================================================================
// ═══════════════════ MESSAGE BUILDERS ═══════════════════════════
// ================================================================

// رسالة تحليل سهم كامل (عند الطلب)
function estimateTradeDuration({kind='rec', profitPct=0, atrPct=0, macdHist=0, macdHistDir=null, weeklyTrend=null, actionTone=null, rvol=1, isNight=false}) {
  return RamiAnalysis.estimateTradeDuration({
    kind, profitPct, atrPct, macdHist, macdHistDir, weeklyTrend, actionTone, rvol, isNight
  });
}

function formatTelegramDuration(duration) {
  if (!duration) return '3-7 أيام تداول';
  if (duration.label === 'بعد الافتتاح') return 'بعد الافتتاح';
  if (duration.days <= 1) return 'اليوم / جلسة واحدة';
  if (duration.days <= 3) return `${duration.days} أيام تداول`;
  if (duration.days <= 7) return '3-7 أيام تداول';
  return 'أكثر من أسبوع';
}

function formatDecisionLabel(decision) {
  const label = decision?.recDecision?.label || 'راقب';
  if (label === 'ادخل الآن') return '✅ ادخل الآن';
  if (label === 'ادخل بشرط') return '🟦 ادخل بشرط';
  if (label === 'استعد') return '🟡 استعد';
  if (label === 'مرفوض') return '⛔ لا تدخل الآن';
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
  // ✅ إذا قريب من المقاومة → الهدف 5% فوقها (بعد كسرها)
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
    signal: a.score >= 3 ? 'شراء قوي' : a.score >= 1 ? 'شراء' : 'انتظار',
    macdHist: a.macdHist,
    volR: 1,
    change: a.change,
    nearSupport: !!(a.support && a.price <= a.support * 1.03),
    distToSupport,
    nearResistance: !!isNearRes,
    priceText: '$' + a.price,
    idealEntryText: a.support ? '$' + a.support : '$' + a.price,
  });

  let m = `📊 <b>${name || sym} (${sym})</b>\n`;
  m    += `💰 <b>$${a.price}</b> ${a.change >= 0 ? '📈' : '📉'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `──────────────\n`;
  m    += `<b>${formatDecisionLabel(unifiedDecision)}</b>\n`;
  m    += `${unifiedDecision.finalEntryNote}\n`;
  m    += `R/R: <b>${riskReward ? riskReward + 'x' : 'غير متاح'}</b> | جودة: <b>${Math.min(100, Math.round(tradeQuality))}%</b>\n`;
  m    += `──────────────\n`;

  if (a.macdHist != null) {
    const mIcon = a.macdHist > 0 ? '✅' : '❌';
    const mDir  = a.macdDir === 'expanding' ? '↑ يتوسع' : '↓ يضيق';
    m += `MACD: ${mIcon} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${mDir}\n`;
  }
  if (a.rsi != null) {
    const rIcon = a.rsi < 35 ? '✅' : a.rsi > 70 ? '❌' : '⚠️';
    const rNote = a.rsi < 35 ? 'تشبع بيع' : a.rsi > 70 ? 'تشبع شراء' : 'محايد';
    m += `RSI: ${rIcon} ${a.rsi} — ${rNote}\n`;
  }
  m += `أسبوعي: ${a.weekly === 'bullish' ? '✅ صاعد' : '❌ هابط'}\n`;
  m += `شموع: 🕯 ${a.green} خضراء من آخر 5\n`;
  m += `──────────────\n`;
  if (a.support)    m += `🟢 دعم: <b>$${a.support}</b>\n`;
  if (a.resistance) m += `🔴 مقاومة: <b>$${a.resistance}</b>\n`;
  if (isNearRes)    m += `⚠️ السعر قريب من المقاومة — انتظر كسرها\n`;
  if (stopLoss)     m += `🛑 وقف مقترح: <b>$${stopLoss}</b>\n`;
  if (target)       m += `🎯 هدف مقترح: <b>$${target}</b> (+${profitPct}%)\n`;
  m += `⏱️ مدة الاحتفاظ: <b>${durationLabel}</b>\n`;
  m += `──────────────\n`;
  m += `🤖 <b>التحليل:</b>\n`;
  a.signals.forEach(s => { m += `✅ ${s}\n`; });
  a.risks.forEach(r   => { m += `❌ ${r}\n`; });
  m += `──────────────\n`;
  m += `${a.vIcon} ${a.verdict}\n`;
  m += `──────────────\n`;
  m += `هل اشتريت ${sym}؟\n`;
  m += `1️⃣ نعم — سجّل الصفقة\n`;
  m += `2️⃣ لا — أضفه للمراقبة`;
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

    if (allSymbols.length === 0) {
      return { watch: 0, portfolio: 0, symbols: 0, messages: 0, sent: 0, note: 'لا توجد أسهم في المراقبة أو المحفظة' };
    }

    // جلب البيانات من FMP
    const stocksData = await getMultipleStocks(allSymbols);
    const newState   = {};
    const messages   = [];

    // ── معالجة قائمة المراقبة
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
        score:    a.score,
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
      const a    = analyzeStock(sym, d.quote, d.closes, prev, d.highs, d.lows);
      if (!a) continue;

      newState[sym] = {
        price:    a.price,
        rsi:      a.rsi,
        macdHist: a.macdHist,
        macdDir:  a.macdDir,
        weekly:   a.weekly,
        score:    a.score,
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

    return {
      watch: watchList.length,
      portfolio: portfolio.length,
      symbols: allSymbols.length,
      messages: messages.length,
      sent: messages.length,
      time: new Date().toISOString(),
    };

  } catch (e) {
    console.error('runMonitor:', e.message);
    return { error: e.message, time: new Date().toISOString() };
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
    if (!lastN.length || !clsN.length) {
      const cur = +d.quote.price;
      const curChg = +(d.quote.changePercentage || 0).toFixed(2);
      await tgSend(`💰 <b>${d.quote.name || sym} (${sym})</b>\nالسعر الحالي: <b>$${cur.toFixed(2)}</b> ${curChg >= 0 ? '▲' : '▼'} ${curChg >= 0 ? '+' : ''}${curChg}%\n⚠️ لا توجد بيانات تاريخية كافية لعرض ${isMonth ? 'الشهر' : 'الأسبوع'}.`);
      return;
    }
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
    // آخر نتائج محفوظة من الأداة
    if (sym === 'LATEST_RECS' || sym === 'LATEST_SPEC' || sym === 'LATEST_HUNTER') {
      const latest = await fbGetLatestTabs();
      const kind = sym === 'LATEST_RECS' ? 'recs' : sym === 'LATEST_SPEC' ? 'spec' : 'hunter';
      await tgSend(formatLatestTabsMessage(kind, latest));
      return;
    }

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

    // تقرير الأداة
    if (sym === 'REPORT') {
      await tgSend('⏳ جاري تحضير تقرير الأداة...');
      await generateReport();
      return;
    }

    // مساعدة
    if (sym === 'HELP') {
      await tgSend(
        `❓ <b>المساعدة</b>
──────────────
` +
        `🎯 توصيات: آخر بطاقات التوصيات من الأداة
` +
        `🎲 مجازفة: آخر بطاقات المجازفة
` +
        `🎯 صائد: آخر بطاقات الصائد
` +
        `📊 تحليل سهم: اكتب رمزه مثل <code>NVDA</code>
` +
        `💼 محفظتي: اكتب <code>محفظتي</code>
` +
        `👁 مراقبتي: اكتب <code>مراقبتي</code>
` +
        `📈 تقرير: اكتب <code>تقرير</code>
` +
        `🚪 إغلاق صفقة: <code>خرجت AAPL</code>
` +
        `🗑 حذف من المراقبة: <code>حذف AAPL</code>
` +
        `──────────────
` +
        `اكتب <code>1</code> للقائمة الرئيسية`
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
        [
          { text: '🎯 توصيات', callback_data: 'menu_latest_recs' },
          { text: '🎲 مجازفة', callback_data: 'menu_latest_spec' },
        ],
        [{ text: '🎯 الصائد', callback_data: 'menu_latest_hunter' }],
        [{ text: '📊 تحليل سهم',     callback_data: 'menu_analyze'   }],
        [{ text: '💼 محفظتي',         callback_data: 'menu_portfolio' }],
        [{ text: '👁 مراقبتي',        callback_data: 'menu_watchlist' }],
        [{ text: '📈 تقرير الأداة',   callback_data: 'menu_report'    }],
        [{ text: '❓ مساعدة',          callback_data: 'menu_help'      }],
      ]
    );
    return;
  }

  // ── عرض آخر تبويبات الأداة المحفوظة
  if (['توصيات', 'التوصيات', 'recs', 'recommendations'].includes(low)) {
    const latest = await fbGetLatestTabs();
    await tgSend(formatLatestTabsMessage('recs', latest));
    return;
  }

  if (['مجازفة', 'المجازفه', 'المجازفة', 'spec'].includes(low)) {
    const latest = await fbGetLatestTabs();
    await tgSend(formatLatestTabsMessage('spec', latest));
    return;
  }

  if (['صائد', 'الصائد', 'hunter'].includes(low)) {
    const latest = await fbGetLatestTabs();
    await tgSend(formatLatestTabsMessage('hunter', latest));
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
    const sym2 = text.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (sym2.length >= 1 && sym2.length <= 10) {
      sess[cid] = { step: 'ask_bought', sym: sym2 };
      await tgSend(`⏳ جاري تحليل <b>${sym2}</b>...`);
      const d = await getStock(sym2);
      if (!d?.quote) { await tgSend(`⚠️ ${sym2} — لم أجد بيانات`); sess[cid] = {}; return; }
      const a = analyzeStock(sym2, d.quote, d.closes, null, d.highs, d.lows);
      if (!a) {
        await tgSend(`💰 <b>${d.quote.name || sym2} (${sym2})</b>\nالسعر الحالي: <b>$${(+d.quote.price).toFixed(2)}</b>\n⚠️ لم تتوفر بيانات تاريخية كافية للتحليل الفني.`);
        sess[cid] = {};
        return;
      }
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
    const atr    = s.analysis?.atrPct || 3;
    const support = s.analysis?.support || null;
    const resistance = s.analysis?.resistance || null;
    const nearSupport = !!(support && s.entry <= support * 1.03);
    const tooCloseToResistance = !!(resistance && s.entry >= resistance * 0.98);
    const specScore = Math.max(0, Math.min(100, 45 + (s.analysis?.score || 0) * 12));
    const specMetrics = RamiAnalysis.calcSpecTradeMetrics({
      price: s.entry,
      support,
      resistance,
      atrPct: atr,
    });
    const fallbackStop = +(s.entry * (1 - atr * 2 / 100)).toFixed(2);
    const fallbackTarget = +(s.entry * (1 + atr * 3.5 / 100)).toFixed(2);
    const stop   = specMetrics.targetOk ? specMetrics.stopLoss : fallbackStop;
    const target = specMetrics.targetOk ? specMetrics.target : fallbackTarget;
    const pct    = specMetrics.targetOk ? specMetrics.profitPct : +((target - s.entry) / s.entry * 100).toFixed(1);
    const lossPct = specMetrics.targetOk ? specMetrics.lossPct : +((s.entry - stop) / s.entry * 100).toFixed(1);
    const riskReward = specMetrics.targetOk ? specMetrics.riskReward : +(pct / Math.max(lossPct, 0.1)).toFixed(2);
    const specPlan = RamiAnalysis.buildSpecEntryPlan({
      price: s.entry,
      support,
      nearSupport,
      tooCloseToResistance,
      score: specScore,
      riskReward,
    });
    const specVerdict = RamiAnalysis.buildSpecVerdict({
      marketClosed: false,
      isWatch: specPlan.isWatch,
      entryTiming: specPlan.entryTiming,
      riskReward,
      score: specScore,
      entryNote: specPlan.entryNote,
    });
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
      riskReward, decision: specVerdict.label,
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
      `قرار النظام: <b>${specVerdict.label}</b>\n` +
      `${specVerdict.displayEntryNote}\n` +
      (specMetrics.targetOk ? '' : `⚠️ الهدف احتياطي لأن المقاومة/الهدف لم يكتمل في البيانات.\n`) +
      `🛑 وقف: <b>$${stop}</b> (-${lossPct}%)\n` +
      `🎯 هدف: <b>$${target}</b> (+${pct}%)\n` +
      `R/R: <b>${riskReward}x</b>\n` +
      `⏱️ مدة: ${durationLabel}\n` +
      `──────────────\n` +
      `👀 سأراقبه وأنبهك تلقائياً`
    );
    return;
  }

  // ── أسعار آخر أسبوع أو شهر
  const priceMatch = text.match(/^([A-Za-z0-9.\-]{1,10})\s+(أسعار|سعر|تاريخ|history|شهر|month|week|أسبوع|اسبوع)$/i);
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
    if (!lastN.length || !clsN.length) {
      const cur = +d.quote.price;
      const curChg = +(d.quote.changePercentage || 0).toFixed(2);
      await tgSend(`💰 <b>${d.quote.name || sym} (${sym})</b>\nالسعر الحالي: <b>$${cur.toFixed(2)}</b> ${curChg >= 0 ? '▲' : '▼'} ${curChg >= 0 ? '+' : ''}${curChg}%\n⚠️ لا توجد بيانات تاريخية كافية لعرض ${isMonth ? 'الشهر' : 'الأسبوع'}.`);
      return;
    }
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
  const sym = text.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  if (sym.length >= 1 && sym.length <= 10) {
    await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`⚠️ ${sym} — لم أجد بيانات. تحقق من الرمز`); return; }

    const q    = d.quote;
    const name = q.name || sym;
    const a    = analyzeStock(sym, q, d.closes);
    if (!a) {
      await tgSend(`💰 <b>${name} (${sym})</b>\nالسعر الحالي: <b>$${(+q.price).toFixed(2)}</b>\n⚠️ لم تتوفر بيانات تاريخية كافية للتحليل الفني.`);
      return;
    }

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
    const result = await runMonitor();
    res.status(200).json({ ok: !result?.error, action: 'monitor', result, time: new Date().toISOString() });
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
