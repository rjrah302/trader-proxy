const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

function cleanUndefined(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cleanUndefined);
  const out = {};
  Object.keys(value).forEach(k => { out[k] = cleanUndefined(value[k]); });
  return out;
}

function journalDocId(r, i = 0) {
  return String(r?.journalId || `${r?.type || 'card'}:${r?.id || 'unknown'}:${r?.signalAt || r?.createdAt || i}`)
    .replace(/[\/\\#?\[\]]/g, '_')
    .slice(0, 180);
}

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
    const col = await getDB()
      .collection('users').doc('default')
      .collection('smart_journal_entries')
      .limit(1000)
      .get();
    if (!col.empty) {
      return col.docs
        .map(d => d.data())
        .sort((a, b) => String(a.signalAt || a.createdAt || '').localeCompare(String(b.signalAt || b.createdAt || '')));
    }
    const snap = await getDB()
      .collection('users').doc('default')
      .collection('data').doc('smart_journal').get();
    return snap.exists ? (snap.data().records || []) : [];
  } catch (e) {
    console.error('getSmartJournal:', e.message);
    return [];
  }
}

function compactRecords(records) {
  return (records || []).slice(-250).map(r => cleanUndefined({
    journalId: r.journalId,
    journalKind: r.journalKind || 'trade',
    id: r.id,
    name: r.name,
    type: r.type,
    decision: r.decision,
    reason: r.reason,
    signalAt: r.signalAt,
    createdAt: r.createdAt,
    entry: r.entry,
    target: r.target,
    stopLoss: r.stopLoss,
    score: r.score,
    status: r.status,
    result: r.result,
    closeReason: r.closeReason,
    closeAt: r.closeAt,
    closePrice: r.closePrice,
    pnlPct: r.pnlPct,
    maxGainPct: r.maxGainPct,
    maxDrawdownPct: r.maxDrawdownPct,
    after30: r.after30,
    after60: r.after60,
    endSession: r.endSession,
    decisionCorrect: r.decisionCorrect,
    dataStatus: r.dataStatus,
    vwapAvailable: r.vwapAvailable,
    lateEntryFlag: r.lateEntryFlag,
    exhaustionFlag: r.exhaustionFlag,
    engineVersion: r.engineVersion,
  }));
}

async function saveSmartJournal(records) {
  try {
    const ref = getDB().collection('users').doc('default');
    await ref.collection('data').doc('smart_journal').set({
      records: compactRecords(records),
      localCount: records.length,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const batch = getDB().batch();
    const col = ref.collection('smart_journal_entries');
    (records || []).slice(-200).forEach((r, i) => {
      batch.set(col.doc(journalDocId(r, i)), cleanUndefined(r), { merge: true });
    });
    await batch.commit();
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
  let changed = false;
  const open = records.filter(r => r.status === 'open');
  if (!open.length) return { records, changed };

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
    const ageMs = now - start;
    const ageDays = ageMs / 86400000;
    const hitTarget = target > 0 && cur >= target;
    const hitStop = stop > 0 && cur <= stop;
    const expired = ageDays >= expectedDays;

    r.currentPrice = cur;
    r.lastPrice = cur;
    r.maxPrice = Math.max(+(r.maxPrice || r.entry), cur);
    r.minPrice = Math.min(+(r.minPrice || r.entry), cur);
    r.pnlPct = +((cur - r.entry) / r.entry * 100).toFixed(2);
    r.maxGainPct = +(((r.maxPrice - r.entry) / r.entry) * 100).toFixed(2);
    r.maxDrawdownPct = +(((r.minPrice - r.entry) / r.entry) * 100).toFixed(2);

    if (ageMs >= 30 * 60000 && !r.after30) {
      r.after30 = { price: cur, pnlPct: r.pnlPct, at: new Date(now).toISOString() };
      changed = true;
    }
    if (ageMs >= 60 * 60000 && !r.after60) {
      r.after60 = { price: cur, pnlPct: r.pnlPct, at: new Date(now).toISOString() };
      changed = true;
    }

    if (hitTarget || hitStop || expired) {
      r.status = 'closed';
      r.result = hitTarget ? (r.journalKind === 'watch_signal' ? 'watch_hit' : 'target')
        : hitStop ? (r.journalKind === 'watch_signal' ? 'watch_failed' : 'stop')
        : (r.journalKind === 'watch_signal' ? 'watch_expired' : 'expired');
      r.closeReason = hitTarget ? 'وصل الهدف' : hitStop ? 'ضرب الوقف' : 'انتهت المدة';
      r.closePrice = cur;
      r.closeAt = new Date(now).toISOString();
      r.closedAt = r.closeAt;
      r.endSession = r.endSession || { price: cur, pnlPct: r.pnlPct, at: r.closeAt };
      r.decisionCorrect = hitTarget || (expired && r.pnlPct >= 0) || (r.journalKind === 'watch_signal' && (r.maxGainPct || 0) >= 1);
      changed = true;
    }
  });

  return { records, changed };
}

function stats(records) {
  const open = records.filter(r => r.status === 'open');
  const closed = records.filter(r => r.status === 'closed');
  const wins = closed.filter(r => r.decisionCorrect === true || r.result === 'target' || r.result === 'watch_hit');
  const losses = closed.filter(r => r.decisionCorrect === false || r.result === 'stop' || r.result === 'watch_failed');
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
  return type === 'rec' ? 'توصيات'
    : type === 'spec' ? 'مجازفة'
    : type === 'daily' ? 'المضاربة اليومية'
    : type === 'hunter' ? 'الصائد'
    : type === 'premarket' ? 'رادار الافتتاح'
    : type || 'بطاقة';
}

async function sendSmartReport(records) {
  const all = stats(records);
  const rec = stats(records.filter(r => r.type === 'rec'));
  const daily = stats(records.filter(r => r.type === 'daily'));
  const spec = stats(records.filter(r => r.type === 'spec'));
  const hunter = stats(records.filter(r => r.type === 'hunter'));
  const open = records.filter(r => r.status === 'open').slice(-8).reverse();

  let msg = '📈 <b>تقرير السجل الذكي</b>\n';
  msg += '──────────────\n';
  msg += `${line('الكل', all)}\n`;
  msg += `${line('التوصيات', rec)}\n`;
  msg += `${line('المضاربة اليومية', daily)}\n`;
  msg += `${line('المجازفة', spec)}\n`;
  msg += `${line('الصائد', hunter)}\n`;

  if (open.length) {
    msg += '──────────────\n';
    msg += '<b>آخر بطاقات مفتوحة:</b>\n';
    open.forEach(r => {
      msg += `• ${r.id} — ${typeLabel(r.type)} | ${r.decision || 'قرار'} | دخول $${(+r.entry || 0).toFixed(2)} | الآن ${r.pnlPct >= 0 ? '+' : ''}${(+r.pnlPct || 0).toFixed(2)}%\n`;
    });
  }

  msg += '──────────────\n';
  msg += 'التقرير يقيس كل بطاقة ظهرت: دخول، مراقبة، انتظار، متأخر، أو مرفوض.';
  await tgSend(msg);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    let records = await getSmartJournal();
    if (!records.length) {
      await tgSend('📈 لا يوجد سجل ذكي بعد\nسيبدأ السجل تلقائياً عند ظهور أول بطاقة من الأداة.');
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
