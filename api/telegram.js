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
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);
    const quote    = Array.isArray(q) ? q[0] : null;
    const history  = Array.isArray(h) ? h : [];
    const closes   = history.map(d => d.close).reverse();
    const dates    = history.map(d => d.date).reverse(); // ← تواريخ
    return { quote, closes, dates };
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

function calcSupRes(closes, price) {
  if (!closes || closes.length < 20) return { support: null, resistance: null };
  const last20     = closes.slice(-20);
  const support    = +Math.min(...last20).toFixed(2);
  const resistance = +Math.max(...last20).toFixed(2);
  return { support, resistance };
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
function analyzeStock(sym, quote, closes, prevAnalysis = null) {
  if (!quote || !closes.length) return null;

  const price  = quote.price;
  const change = quote.changePercentage || 0;
  const rsi    = calcRSI(closes);
  const macd   = calcMACD(closes);
  const weekly = calcWeeklyTrend(closes);
  const levels = calcSupRes(closes, price);
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
function buildAnalysisMsg(sym, name, a, levels) {
  const stopLoss = a.support ? +(a.support * 0.985).toFixed(2) : null;
  const target   = a.resistance || +(a.price * 1.08).toFixed(2);
  const atr      = a.atrPct;
  const days     = atr ? Math.max(1, Math.ceil(((target - a.price) / a.price * 100) / atr)) : 3;

  let m = `📊 <b>${name || sym} (${sym})</b>\n`;
  m    += `💰 <b>$${a.price}</b> ${a.change >= 0 ? '📈' : '📉'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
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
  if (stopLoss)     m += `🛑 وقف مقترح: <b>$${stopLoss}</b>\n`;
  m += `⏱️ مدة الاحتفاظ: <b>${days <= 1 ? '🔥 يومي' : days <= 3 ? `⚡ ${days} أيام` : `📅 ${days} أيام`}</b>\n`;
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
      const a    = analyzeStock(sym, d.quote, d.closes, prev);
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
      const a    = analyzeStock(sym, d.quote, d.closes, prev);
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
}

async function handleMessage(text, cid) {
  const s   = sess[cid] || {};
  const low = text.toLowerCase().trim();

  // ── /start أو تحية
  if (text === '/start' || text === 'مرحبا' || text === 'هلا' || text === '/help') {
    sess[cid] = {};
    await tgSend(
      `🦅 <b>RamiMarketX — مرحباً رامي!</b>\n` +
      `──────────────\n` +
      `📊 تحليل سهم: <code>NVDA</code>\n` +
      `💼 محفظتك: <code>محفظتي</code>\n` +
      `👁 المراقبة: <code>مراقبتي</code>\n` +
      `📈 أداء الأداة: <code>تقرير</code>\n` +
      `🚪 خروج من سهم: <code>خرجت AAPL</code>\n` +
      `──────────────\n` +
      `البوت يراقب محفظتك ومراقبتك تلقائياً كل 10 دقائق 👀`
    );
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
    const stop   = +(s.entry * (1 - atr * 2 / 100)).toFixed(2);
    const target = +(s.entry * (1 + atr * 3.5 / 100)).toFixed(2);
    const pct    = +((target - s.entry) / s.entry * 100).toFixed(1);
    const days   = Math.ceil(parseFloat(pct) / atr);

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
      `🛑 وقف: <b>$${stop}</b> (-${(atr * 2).toFixed(1)}%)\n` +
      `🎯 هدف: <b>$${target}</b> (+${pct}%)\n` +
      `⏱️ مدة: ${days <= 1 ? '🔥 يومي' : days <= 3 ? `⚡ ${days} أيام` : `📅 ${days} أيام`}\n` +
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
    const a    = analyzeStock(sym, q, d.closes);
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
