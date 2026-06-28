const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let db;
function getDB() {
  if (!db) {
    if (!getApps().length) {
      const raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
      initializeApp({ credential: cert(JSON.parse(raw)) });
    }
    db = getFirestore();
  }
  return db;
}

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6195578236';
const FMP_KEY = process.env.FMP_API_KEY;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text) {
  if (!TG_TOKEN) return;
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('tgSend:', e.message);
  }
}

async function getSmartJournal() {
  try {
    const snap = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('smart_journal').get();
    return snap.exists ? (snap.data().records || []) : [];
  } catch (e) {
    console.error('getSmartJournal:', e.message);
    return [];
  }
}

async function saveSmartJournal(records) {
  try {
    await getDB()
      .collection('users').doc('default')
      .collection('data').doc('smart_journal')
      .set({ records: records.slice(-800), updatedAt: new Date() }, { merge: true });
  } catch (e) {
    console.error('saveSmartJournal:', e.message);
  }
}

async function getQuote(sym) {
  if (!FMP_KEY) return null;
  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(sym)}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    return Array.isArray(d) && d[0]?.price ? d[0] : null;
  } catch (e) {
    return null;
  }
}

async function evaluateSmartJournal(records) {
  const open = records.filter(r => r.status === 'open');
  if (!open.length) return { records, changed: false };

  let changed = false;
  const symbols = [...new Set(open.map(r => r.id).filter(Boolean))];
  const quotes = {};
  for (let i = 0; i < symbols.length; i += 8) {
    await Promise.all(symbols.slice(i, i + 8).map(async sym => {
      const q = await getQuote(sym);
      if (q?.price) quotes[sym] = +q.price;
    }));
  }

  const now = Date.now();
  records.forEach(r => {
    if (r.status !== 'open') return;
    const cur = quotes[r.id];
    if (!cur || !r.entry) return;

    const target = +r.target || 0;
    const stop = +r.stopLoss || 0;
    const expectedDays = Math.max(1, +(r.expectedDays || 5));
    const start = new Date(r.signalAt || r.createdAt || now).getTime();
    const ageDays = (now - start) / 86400000;
    const hitTarget = target > 0 && cur >= target;
    const hitStop = stop > 0 && cur <= stop;
    const expired = ageDays >= expectedDays;

    r.lastPrice = cur;
    r.livePnlPct = +((cur - r.entry) / r.entry * 100).toFixed(2);

    if (hitTarget || hitStop || expired) {
      r.status = hitTarget ? 'target' : hitStop ? 'stop' : 'expired';
      r.result = hitTarget ? 'win' : hitStop ? 'loss' : (r.livePnlPct >= 0 ? 'win' : 'loss');
      r.closePrice = cur;
      r.closedAt = new Date(now).toISOString();
      r.pnlPct = r.livePnlPct;
      changed = true;
    }
  });

  return { records, changed };
}

function stats(records) {
  const open = records.filter(r => r.status === 'open');
  const closed = records.filter(r => r.status && r.status !== 'open');
  const wins = closed.filter(r => r.result === 'win');
  const losses = closed.filter(r => r.result === 'loss');
  const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
  const avgPnl = closed.length
    ? +(closed.reduce((s, r) => s + (+r.pnlPct || 0), 0) / closed.length).toFixed(2)
    : 0;
  return { total: records.length, open: open.length, closed: closed.length, wins: wins.length, losses: losses.length, winRate, avgPnl };
}

function line(label, s) {
  return `${label}: الكل ${s.total} | مفتوحة ${s.open} | مغلقة ${s.closed} | نجاح ${s.winRate}% | متوسط ${s.avgPnl >= 0 ? '+' : ''}${s.avgPnl}%`;
}

function typeLabel(type) {
  return type === 'spec' ? 'مجازفة' : type === 'hunter' ? 'صائد' : 'توصية';
}

async function sendSmartReport(records) {
  const all = stats(records);
  const rec = stats(records.filter(r => r.type === 'rec'));
  const spec = stats(records.filter(r => r.type === 'spec'));
  const hunter = stats(records.filter(r => r.type === 'hunter'));
  const open = records.filter(r => r.status === 'open').slice(-8).reverse();

  let msg = '📈 <b>تقرير السجل الذكي</b>\n';
  msg += '──────────────\n';
  msg += `${line('الكل', all)}\n`;
  msg += `${line('التوصيات', rec)}\n`;
  msg += `${line('المجازفة', spec)}\n`;
  msg += `${line('الصائد', hunter)}\n`;

  if (open.length) {
    msg += '──────────────\n';
    msg += '<b>مفتوحة حالياً:</b>\n';
    open.forEach(r => {
      msg += `• ${r.id} — ${typeLabel(r.type)} | دخول $${(+r.entry || 0).toFixed(2)} | هدف $${(+r.target || 0).toFixed(2)} | وقف $${(+r.stopLoss || 0).toFixed(2)}\n`;
    });
  }

  msg += '──────────────\n';
  msg += 'السجل يقفل تلقائياً عند الهدف أو الوقف أو انتهاء المدة.';
  await tgSend(msg);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    let records = await getSmartJournal();
    if (!records.length) {
      await tgSend('📈 لا يوجد سجل ذكي بعد\nسيبدأ السجل تلقائياً عند ظهور أول بطاقة دخول من الأداة.');
      res.status(200).json({ ok: true, total: 0 });
      return;
    }

    const result = await evaluateSmartJournal(records);
    records = result.records;
    if (result.changed) await saveSmartJournal(records);
    await sendSmartReport(records);

    res.status(200).json({ ok: true, changed: result.changed, total: records.length, stats: stats(records) });
  } catch (e) {
    console.error('report:', e.message);
    await tgSend(`⚠️ خطأ في تقرير السجل الذكي: ${e.message}`);
    res.status(200).json({ ok: false, error: e.message });
  }
};
