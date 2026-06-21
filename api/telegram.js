// ================================================================
// telegram.js — RamiMarketX Bot v2
// ================================================================
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

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

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6195578236';
const FMP_KEY    = process.env.FMP_API_KEY;
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text, chatId = TG_CHAT_ID) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('tgSend:', e.message); }
}

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

async function fbGetHistory() {
  try {
    const s = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('rec_history').get();
    return s.exists ? (s.data().records || []) : [];
  } catch (e) { return []; }
}

async function getStock(sym) {
  try {
    const [q, h] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);
    const quote  = Array.isArray(q) ? q[0] : null;
    const closes = Array.isArray(h) ? h.map(d => d.close).reverse() : [];
    return { quote, closes };
  } catch (e) { return null; }
}

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

function calcEMA(arr, p) {
  if (!arr || arr.length < p) return null;
  const k = 2 / (p + 1);
  let ema  = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes) {
  if (!closes || closes.length < 15) return null;
  const diffs = closes.slice(-15).map((v, i, a) => i > 0 ? v - a[i - 1] : 0).slice(1);
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
    const a = calcEMA(sl, 12), b = calcEMA(sl, 26);
    if (a && b) macdArr.push(a - b);
  }
  const sig = calcEMA(macdArr, 9);
  if (!sig) return { hist: null, dir: null, signal: null };
  const hist    = (e12 - e26) - sig;
  const prevArr = macdArr.slice(0, -1);
  const prevSig = calcEMA(prevArr, 9);
  const prevHist = prevArr.length ? prevArr[prevArr.length - 1] - prevSig : null;
  const dir = prevHist != null ? (Math.abs(hist) > Math.abs(prevHist) ? 'expanding' : 'contracting') : null;
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

function calcSupRes(closes) {
  if (!closes || closes.length < 20) return { support: null, resistance: null };
  const last20 = closes.slice(-20);
  return { support: +Math.min(...last20).toFixed(2), resistance: +Math.max(...last20).toFixed(2) };
}

function calcATR(closes) {
  if (!closes || closes.length < 15) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) trs.push(Math.abs(closes[i] - closes[i - 1]));
  const atr   = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const price = closes[closes.length - 1];
  return price > 0 ? +(atr / price * 100).toFixed(2) : null;
}

function calcGreenCandles(closes) {
  if (!closes || closes.length < 5) return 0;
  const last = closes.slice(-5);
  let green = 0;
  for (let i = 1; i < last.length; i++) if (last[i] > last[i - 1]) green++;
  return green;
}

function analyzeStock(sym, quote, closes, prevAnalysis = null) {
  if (!quote || !closes.length) return null;
  const price  = quote.price;
  const change = quote.changePercentage || 0;
  const rsi    = calcRSI(closes);
  const macd   = calcMACD(closes);
  const weekly = calcWeeklyTrend(closes);
  const levels = calcSupRes(closes);
  const atrPct = calcATR(closes);
  const green  = calcGreenCandles(closes);

  let buy = 0, sell = 0;
  const signals = [], risks = [];

  if (macd.hist > 0 && macd.dir === 'expanding')      { buy += 2; signals.push('MACD زخم صاعد قوي ↑'); }
  else if (macd.hist > 0)                              { buy++;    signals.push('MACD صاعد يضعف'); }
  else if (macd.hist < 0 && macd.dir === 'expanding') { sell += 2; risks.push('MACD هابط يتوسع ↓'); }
  else if (macd.hist < 0)                              { sell++;   risks.push('MACD هابط'); }

  if (rsi !== null) {
    if (rsi < 30)      { buy += 2;  signals.push('RSI ' + rsi + ' — تشبع بيع شديد 🔥'); }
    else if (rsi < 40) { buy++;     signals.push('RSI ' + rsi + ' — منطقة شراء'); }
    else if (rsi > 75) { sell += 2; risks.push('RSI ' + rsi + ' — تشبع شراء ⚠️'); }
    else if (rsi > 65) { sell++;    risks.push('RSI ' + rsi + ' — مرتفع'); }
  }

  if (weekly === 'bullish') { buy++;  signals.push('أسبوعي صاعد ✅'); }
  else                      { sell++; risks.push('أسبوعي هابط ❌'); }

  if (green >= 4)      { buy++;  signals.push(green + ' شموع خضراء من 5'); }
  else if (green <= 1) { sell++; risks.push('شموع حمراء متتالية'); }

  const score = buy - sell;
  let verdict, vIcon;
  if      (score >= 3) { verdict = 'إشارة شراء قوية';        vIcon = '✅'; }
  else if (score >= 1) { verdict = 'إيجابي — يمكن الدخول';   vIcon = '⚠️'; }
  else if (score === 0){ verdict = 'إشارات متضاربة — انتظر'; vIcon = '⏳'; }
  else                 { verdict = 'سلبي — تجنب الدخول';     vIcon = '❌'; }

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

  return { price: +price.toFixed(2), change: +change.toFixed(2), rsi, macdHist: macd.hist, macdDir: macd.dir, macdLine: macd.macdLine, weekly, support: levels.support, resistance: levels.resistance, atrPct, green, signals, risks, score, verdict, vIcon, changes };
}

function buildAnalysisMsg(sym, name, a) {
  const stopLoss = a.support ? +(a.support * 0.985).toFixed(2) : null;
  const target   = a.resistance || +(a.price * 1.08).toFixed(2);
  const atr      = a.atrPct;
  const days     = atr ? Math.max(1, Math.ceil(((target - a.price) / a.price * 100) / atr)) : 3;

  let m = `📊 <b>${name || sym} (${sym})</b>\n`;
  m    += `💰 <b>$${a.price}</b> ${a.change >= 0 ? '📈' : '📉'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
  m    += `──────────────\n`;
  if (a.macdHist != null) m += `MACD: ${a.macdHist > 0 ? '✅' : '❌'} ${a.macdHist > 0 ? '+' : ''}${a.macdHist} ${a.macdDir === 'expanding' ? '↑ يتوسع' : '↓ يضيق'}\n`;
  if (a.rsi != null)      m += `RSI: ${a.rsi < 35 ? '✅' : a.rsi > 70 ? '❌' : '⚠️'} ${a.rsi} — ${a.rsi < 35 ? 'تشبع بيع' : a.rsi > 70 ? 'تشبع شراء' : 'محايد'}\n`;
  m += `أسبوعي: ${a.weekly === 'bullish' ? '✅ صاعد' : '❌ هابط'}\n`;
  m += `شموع: 🕯 ${a.green} خضراء من آخر 5\n`;
  m += `──────────────\n`;
  if (a.support)    m += `🟢 دعم: <b>$${a.support}</b>\n`;
  if (a.resistance) m += `🔴 مقاومة: <b>$${a.resistance}</b>\n`;
  if (stopLoss)     m += `🛑 وقف مقترح: <b>$${stopLoss}</b>\n`;
  m += `⏱️ مدة الاحتفاظ: <b>${days <= 1 ? '🔥 يومي' : days <= 3 ? `⚡ ${days} أيام` : `📅 ${days} أيام`}</b>\n`;
  m += `──────────────\n🤖 <b>التحليل:</b>\n`;
  a.signals.forEach(s => { m += `✅ ${s}\n`; });
  a.risks.forEach(r   => { m += `❌ ${r}\n`; });
  m += `──────────────\n${a.vIcon} ${a.verdict}\n──────────────\n`;
  m += `هل اشتريت ${sym}؟\n1️⃣ نعم — سجّل الصفقة\n2️⃣ لا — أضفه للمراقبة`;
  return m;
}

async function runMonitor() {
  try {
    const [watchData, portData, prevStateData] = await Promise.all([
      fbGet('watchlist'), fbGet('portfolio'), fbGet('monitor_state'),
    ]);
    const watchList = watchData.symbols || [];
    const portfolio = (portData.trades  || []).filter(t => !t.closed);
    const prevState = prevStateData.stocks || {};
    const allSymbols = [...new Set([...watchList, ...portfolio.map(t => t.symbol)])];
    if (!allSymbols.length) return;

    const stocksData = await getMultipleStocks(allSymbols);
    const newState   = {};
    const messages   = [];

    for (const sym of watchList) {
      const d = stocksData[sym];
      if (!d?.quote) continue;
      const a = analyzeStock(sym, d.quote, d.closes, prevState[sym] || null);
      if (!a) continue;
      newState[sym] = { price: a.price, rsi: a.rsi, macdHist: a.macdHist, macdDir: a.macdDir, weekly: a.weekly, updatedAt: new Date().toISOString() };
      if (a.changes?.length > 0) {
        let m = `👁 <b>تحديث ${sym}</b>\n──────────────\n💰 $${a.price} ${a.change >= 0 ? '▲' : '▼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
        if (a.macdHist != null) m += `MACD: ${a.macdHist > 0 ? '✅' : '❌'} ${a.macdHist > 0 ? '+' : ''}${a.macdHist}\n`;
        if (a.rsi != null)      m += `RSI: ${a.rsi}\n`;
        m += `──────────────\n`;
        a.changes.forEach(c => { m += `${c}\n`; });
        m += `${a.vIcon} ${a.verdict}`;
        messages.push(m);
      }
    }

    for (const trade of portfolio) {
      const sym = trade.symbol;
      const d   = stocksData[sym];
      if (!d?.quote) continue;
      const a   = analyzeStock(sym, d.quote, d.closes, prevState[sym] || null);
      if (!a) continue;
      newState[sym] = { price: a.price, rsi: a.rsi, macdHist: a.macdHist, macdDir: a.macdDir, weekly: a.weekly, updatedAt: new Date().toISOString() };
      const pnl = +((a.price - trade.entry) / trade.entry * 100).toFixed(2);

      if (trade.target && a.price >= trade.target) {
        messages.push(`🎯 <b>${sym} وصل الهدف!</b>\n$${trade.entry} → $${a.price}\nربح: +${pnl}% 🎉\nاكتب: <code>خرجت ${sym}</code>`);
      } else if (trade.stop && a.price <= trade.stop) {
        messages.push(`🚨 <b>${sym} كسر الوقف!</b>\n$${a.price} < $${trade.stop}\nخسارة: ${pnl}%\nاخرج فوراً! اكتب: <code>خرجت ${sym}</code>`);
      } else if (trade.stop && a.price <= trade.stop * 1.02) {
        messages.push(`⚠️ <b>${sym} اقترب من الوقف!</b>\nالسعر: $${a.price} | وقف: $${trade.stop}\nP&L: ${pnl}%`);
      } else if (a.changes?.length > 0) {
        let m = `💼 <b>تحديث ${sym}</b>\n──────────────\n💰 $${a.price} ${a.change >= 0 ? '▲' : '▼'} ${a.change >= 0 ? '+' : ''}${a.change}%\n`;
        m    += `P&L: <b>${pnl >= 0 ? '+' : ''}${pnl}%</b>\n──────────────\n`;
        a.changes.forEach(c => { m += `${c}\n`; });
        messages.push(m);
      }
    }

    await fbSet('monitor_state', { stocks: newState, lastRun: new Date().toISOString() });
    for (const msg of messages) {
      await tgSend(msg);
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) { console.error('runMonitor:', e.message); }
}

const sess = {};

async function handleMessage(text, cid) {
  const s   = sess[cid] || {};
  const low = text.toLowerCase().trim();

  if (text === '/start' || text === 'مرحبا' || text === 'هلا' || text === '/help') {
    sess[cid] = {};
    await tgSend(`🦅 <b>RamiMarketX — مرحباً رامي!</b>\n──────────────\n📊 تحليل سهم: <code>NVDA</code>\n💼 محفظتك: <code>محفظتي</code>\n👁 المراقبة: <code>مراقبتي</code>\n📈 أداء الأداة: <code>تقرير</code>\n🚪 خروج: <code>خرجت AAPL</code>\n🗑 حذف من المراقبة: <code>حذف AAPL</code>\n──────────────\nيراقب محفظتك تلقائياً كل 10 دقائق 👀`);
    return;
  }

  if (text === 'محفظتي') {
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
    m += `──────────────\nمتوسط P&L: ${totalPnl >= 0 ? '+' : ''}${+(totalPnl / port.length).toFixed(2)}%`;
    await tgSend(m);
    return;
  }

  if (text === 'مراقبتي') {
    const data   = await fbGet('watchlist');
    const list   = data.symbols || [];
    if (!list.length) { await tgSend('👁 قائمة المراقبة فارغة'); return; }
    const stocks = await getMultipleStocks(list);
    let m = '👁 <b>قائمة المراقبة:</b>\n──────────────\n';
    for (const sym of list) {
      const q = stocks[sym]?.quote;
      if (q) {
        const chg = +(q.changePercentage || 0).toFixed(2);
        m += `• <b>${sym}</b> $${q.price?.toFixed(2)} ${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : ''}${chg}%\n`;
      } else { m += `• <b>${sym}</b>\n`; }
    }
    m += `──────────────\nيراقبها كل 10 دقائق 👀`;
    await tgSend(m);
    return;
  }

  if (text === 'تقرير' || text === 'أداء') {
    const history = await fbGetHistory();
    if (!history.length) { await tgSend('📊 لا يوجد سجل توصيات بعد\nافتح الأداة وانتظر يوم تداول كامل'); return; }
    const closed  = history.filter(h => h.result !== 'pending');
    const wins    = closed.filter(h => h.result === 'win');
    const losses  = closed.filter(h => h.result === 'loss');
    const pending = history.filter(h => h.result === 'pending');
    const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
    const avgWin  = wins.length   ? +(wins.reduce((s, h) => s + (h.pnlPct || 0), 0) / wins.length).toFixed(2)   : 0;
    const avgLoss = losses.length ? +(losses.reduce((s, h) => s + (h.pnlPct || 0), 0) / losses.length).toFixed(2) : 0;
    const exp     = closed.length ? +((winRate / 100 * avgWin) + ((1 - winRate / 100) * avgLoss)).toFixed(2) : 0;
    const best    = [...wins].sort((a, b) => (b.pnlPct || 0) - (a.pnlPct || 0))[0];
    const worst   = [...losses].sort((a, b) => (a.pnlPct || 0) - (b.pnlPct || 0))[0];
    const openR   = closed.filter(h => h.session === 'افتتاح');
    const midR    = closed.filter(h => h.session === 'منتصف');
    const openWR  = openR.length ? Math.round(openR.filter(h => h.result === 'win').length / openR.length * 100) : 0;
    const midWR   = midR.length  ? Math.round(midR.filter(h => h.result === 'win').length  / midR.length  * 100) : 0;

    let m = `📊 <b>تقرير أداء تريدر برو X</b>\n──────────────\n`;
    m    += `✅ ناجحة: ${wins.length} | ❌ خاسرة: ${losses.length} | ⏳ معلقة: ${pending.length}\n──────────────\n`;
    m    += `🎯 نسبة النجاح: <b>${winRate}%</b>\n`;
    m    += `💰 متوسط الربح: <b>+${avgWin}%</b>\n`;
    m    += `📉 متوسط الخسارة: <b>${avgLoss}%</b>\n`;
    m    += `🧮 التوقع الرياضي: <b>${exp >= 0 ? '+' : ''}${exp}%</b>\n──────────────\n`;
    m    += `🌅 الافتتاح: ${openWR}% (${openR.length} صفقة)\n`;
    m    += `🌇 المنتصف: ${midWR}% (${midR.length} صفقة)\n──────────────\n`;
    if (best)  m += `🏆 أفضل: ${best.id} +${best.pnlPct}%\n`;
    if (worst) m += `💀 أسوأ: ${worst.id} ${worst.pnlPct}%\n──────────────\n`;
    m += exp >= 1.5 ? '✅ الأداة مربحة — استمر' : exp >= 0 ? '⚠️ الأداة متعادلة — راجع المعادلات' : '❌ الأداة خاسرة — توقف وراجع';
    await tgSend(m);
    return;
  }

  if (low.startsWith('خرجت') || low.startsWith('بعت')) {
    const parts = text.split(/\s+/);
    const sym   = parts[1]?.toUpperCase();
    if (sym) {
      const data  = await fbGet('portfolio');
      const port  = data.trades || [];
      const trade = port.find(x => x.symbol === sym && !x.closed);
      if (trade) {
        const d   = await getStock(sym);
        const cur = parseFloat(parts[2]) || d?.quote?.price || trade.target;
        const pnl = +((cur - trade.entry) / trade.entry * 100).toFixed(2);
        trade.closed = true; trade.closePrice = cur; trade.closeDate = new Date().toISOString(); trade.pnlPct = pnl;
        await fbSet('portfolio', { trades: port });
        const history = await fbGetHistory();
        const rec = history.findLast(h => h.id === sym && h.result === 'pending');
        if (rec) {
          rec.result = pnl >= 0 ? 'win' : 'loss'; rec.resultDate = new Date().toISOString(); rec.resultPrice = cur; rec.pnlPct = pnl;
          try { await getDB().collection('users').doc('default').collection('data').doc('rec_history').set({ records: history, updatedAt: new Date() }, { merge: true }); } catch (e) {}
        }
        await tgSend(`✅ <b>${sym} مغلقة</b>\nدخول: $${trade.entry} → خروج: $${cur?.toFixed(2)}\n${pnl >= 0 ? '💰 ربح: +' : '📉 خسارة: '}${pnl}%\n──────────────\nاكتب <code>تقرير</code> لترى الأداء الكلي`);
      } else { await tgSend(`⚠️ ${sym} غير موجود في محفظتك`); }
    }
    sess[cid] = {}; return;
  }

  if (low.startsWith('حذف') || low.startsWith('أزل')) {
    const sym = text.split(/\s+/)[1]?.toUpperCase();
    if (sym) {
      const data = await fbGet('watchlist');
      await fbSet('watchlist', { symbols: (data.symbols || []).filter(s => s !== sym) });
      await tgSend(`🗑 <b>${sym}</b> حُذف من المراقبة`);
    }
    return;
  }

  if (s.step === 'ask_bought') {
    if (text === '1' || text === 'نعم') {
      sess[cid] = { ...s, step: 'ask_price' };
      await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);
    } else {
      const data = await fbGet('watchlist');
      const list = data.symbols || [];
      if (!list.includes(s.sym)) { list.push(s.sym); await fbSet('watchlist', { symbols: list }); }
      const tips = [];
      if (s.analysis?.rsi > 60)              tips.push('انتظر RSI يهبط دون 50');
      if (s.analysis?.rsi < 40)              tips.push('RSI منخفض — فرصة قريبة');
      if (s.analysis?.macdHist < 0)          tips.push('انتظر MACD يتحول إيجابياً');
      if (s.analysis?.weekly === 'bearish')  tips.push('الأسبوعي هابط — تحلى بالصبر');
      if (!tips.length)                       tips.push('راقب كسر المقاومة كإشارة دخول');
      let m = `👁 <b>${s.sym} أضيف للمراقبة</b>\n──────────────\n`;
      tips.forEach(t => { m += `• ${t}\n`; });
      m += `──────────────\n⏰ سأنبهك عند تغير مهم 👀`;
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
    const data   = await fbGet('portfolio');
    const port   = data.trades || [];
    port.push({ symbol: s.sym, entry: s.entry, qty, stop, target, date: new Date().toISOString(), closed: false });
    await fbSet('portfolio', { trades: port });
    const wData = await fbGet('watchlist');
    await fbSet('watchlist', { symbols: (wData.symbols || []).filter(x => x !== s.sym) });
    sess[cid] = {};
    await tgSend(`✅ <b>تم تسجيل ${s.sym}</b>\n──────────────\nدخول: <b>$${s.entry?.toFixed(2)}</b> × ${qty} سهم\nرأس المال: <b>$${(s.entry * qty).toFixed(0)}</b>\n──────────────\n🛑 وقف: <b>$${stop}</b> (-${(atr * 2).toFixed(1)}%)\n🎯 هدف: <b>$${target}</b> (+${pct}%)\n⏱️ مدة: ${days <= 1 ? '🔥 يومي' : days <= 3 ? `⚡ ${days} أيام` : `📅 ${days} أيام`}\n──────────────\n👀 سأراقبه وأنبهك تلقائياً`);
    return;
  }

  const sym = text.toUpperCase().replace(/[^A-Z.]/g, '');
  if (sym.length >= 1 && sym.length <= 5) {
    await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
    const d = await getStock(sym);
    if (!d?.quote) { await tgSend(`⚠️ ${sym} — لم أجد بيانات`); return; }
    const a = analyzeStock(sym, d.quote, d.closes);
    if (!a) { await tgSend(`⚠️ ${sym} — بيانات غير كافية`); return; }
    sess[cid] = { step: 'ask_bought', sym, price: d.quote.price, analysis: a };
    await tgSend(buildAnalysisMsg(sym, d.quote.name || sym, a));
    return;
  }

  await tgSend(`🦅 <b>RamiMarketX</b>\n──────────────\nاكتب رمز السهم: <code>NVDA</code>\nمحفظتك: <code>محفظتي</code>\nمراقبتي: <code>مراقبتي</code>\nتقرير: <code>تقرير</code>\nإغلاق: <code>خرجت AAPL</code>`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && req.query.action === 'monitor') {
    await runMonitor();
    res.status(200).json({ ok: true, action: 'monitor' });
    return;
  }
  if (req.method === 'GET') { res.status(200).json({ ok: true, bot: 'RamiMarketX v2' }); return; }
  if (req.method !== 'POST') { res.status(200).json({ ok: true }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const msg  = body?.message;
    if (!msg) { res.status(200).json({ ok: true }); return; }
    const text = msg.text?.trim() || '';
    const cid  = String(msg.chat?.id);
    if (cid !== TG_CHAT_ID) { res.status(200).json({ ok: true }); return; }
    await handleMessage(text, cid);
    res.status(200).json({ ok: true });
  } catch (e) { console.error('Handler:', e.message); res.status(200).json({ ok: true }); }
};
