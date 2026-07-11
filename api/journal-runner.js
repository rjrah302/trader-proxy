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

const FMP_KEY = process.env.FMP_API_KEY;

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

// لا تعتمد على r.id فقط — بعض السجلات قد تحمل symbol/ticker بدلاً منه
const getRecordSymbol = (r) => r.symbol || r.ticker || r.id;

const BATCH_CHUNK_SIZE = 400;
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// نفس دالة القراءة الموجودة في api/report.js حرفياً — لا تغيير
async function getSmartJournal() {
  try {
    const col = await getDB()
      .collection('users').doc('default')
      .collection('smart_journal_entries')
      .limit(1000)
      .get();
    if (!col.empty) {
      return col.docs
        .map(d => ({ _docId: d.id, ...d.data() }))
        .sort((a, b) => String(a.signalAt || a.createdAt || '').localeCompare(String(b.signalAt || b.createdAt || '')));
    }
    return [];
  } catch (e) {
    console.error('getSmartJournal:', e.message);
    return [];
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

// نفس منطق التقييم في evaluateSmartJournal (api/report.js)،
// لكن مقيّد فقط بالحقول المطلوبة: after30 / after60 / endSession /
// maxGainPct / maxDrawdownPct. لا يلمس decision / score / confidence / recStage إطلاقاً.
function evaluateOnly(record, currentPrice, nowMs) {
  const r = record;
  const cur = currentPrice;
  if (!cur || !r.entry) return { changed: false };

  const before = JSON.stringify({
    after30: r.after30, after60: r.after60, endSession: r.endSession,
    maxGainPct: r.maxGainPct, maxDrawdownPct: r.maxDrawdownPct,
  });

  const start = new Date(r.signalAt || r.createdAt || nowMs).getTime();
  const ageMs = nowMs - start;

  const maxPrice = Math.max(+(r.maxPrice || r.entry), cur);
  const minPrice = Math.min(+(r.minPrice || r.entry), cur);
  const pnlPct = +(((cur - r.entry) / r.entry) * 100).toFixed(2);
  const maxGainPct = +(((maxPrice - r.entry) / r.entry) * 100).toFixed(2);
  const maxDrawdownPct = +(((minPrice - r.entry) / r.entry) * 100).toFixed(2);

  const patch = { maxPrice, minPrice, currentPrice: cur, lastPrice: cur, pnlPct, maxGainPct, maxDrawdownPct };

  if (ageMs >= 30 * 60000 && !r.after30) {
    patch.after30 = { price: cur, pnlPct, at: new Date(nowMs).toISOString() };
  }
  if (ageMs >= 60 * 60000 && !r.after60) {
    patch.after60 = { price: cur, pnlPct, at: new Date(nowMs).toISOString() };
  }
  // endSession هنا لا يُغلق الصفقة (status يبقى كما هو) — فقط يسجل آخر قراءة
  // عند نهاية اليوم كنقطة بيانات إضافية، بدون تغيير status/result كما يفعل report.js
  if (r.markEndSession && !r.endSession) {
    patch.endSession = { price: cur, pnlPct, at: new Date(nowMs).toISOString() };
  }

  const after = JSON.stringify({
    after30: patch.after30 ?? r.after30,
    after60: patch.after60 ?? r.after60,
    endSession: patch.endSession ?? r.endSession,
    maxGainPct: patch.maxGainPct,
    maxDrawdownPct: patch.maxDrawdownPct,
  });

  if (before === after) return { changed: false };
  return { changed: true, patch };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const RUNNER_SECRET = process.env.RUNNER_SECRET;
  if (!RUNNER_SECRET) {
    return res.status(500).json({ ok: false, error: 'RUNNER_SECRET is not configured' });
  }
  const providedSecret = req.headers['x-runner-secret'] || req.query?.token;
  if (providedSecret !== RUNNER_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const result = { ok: true, checked: 0, changed: 0, skipped: 0, skippedNoQuote: 0, skippedNoChange: 0, errors: [] };

  try {
    const records = await getSmartJournal();
    const open = records.filter(r => r.status === 'open');
    result.checked = open.length;

    if (!open.length) {
      return res.status(200).json(result);
    }

    const symbols = [...new Set(open.map(getRecordSymbol).filter(Boolean))];
    const quotes = {};
    for (let i = 0; i < symbols.length; i += 8) {
      await Promise.all(symbols.slice(i, i + 8).map(async sym => {
        try {
          const q = await getQuote(sym);
          if (q?.price) quotes[sym] = +q.price;
        } catch (e) {
          result.errors.push(`quote:${sym}:${e.message}`);
        }
      }));
    }

    const now = Date.now();
    const db = getDB();
    const col = db.collection('users').doc('default').collection('smart_journal_entries');
    const writes = [];

    open.forEach(r => {
      const sym = getRecordSymbol(r);
      const cur = quotes[sym];
      if (!cur) { result.skipped++; result.skippedNoQuote++; return; }
      const evalResult = evaluateOnly(r, cur, now);
      if (!evalResult.changed) { result.skipped++; result.skippedNoChange++; return; }
      const docId = r._docId || journalDocId(r);
      writes.push({ docId, patch: cleanUndefined(evalResult.patch) });
    });

    if (result.skippedNoQuote > 0) {
      const missing = open.map(getRecordSymbol).filter(sym => !quotes[sym]);
      result.missingQuoteSymbols = [...new Set(missing)].slice(0, 20);
    }

    if (writes.length) {
      // تقسيم الكتابات إلى دفعات لا تتجاوز 400 عملية لكل batch (حد Firestore 500)
      const chunks = chunkArray(writes, BATCH_CHUNK_SIZE);
      for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(w => {
          batch.set(col.doc(w.docId), w.patch, { merge: true });
        });
        await batch.commit();
      }
      result.changed = writes.length;
    }

    return res.status(200).json(result);
  } catch (e) {
    result.ok = false;
    result.errors.push(e.message || 'journal-runner error');
    return res.status(200).json(result);
  }
};
