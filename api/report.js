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

async function tgSend(text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('tgSend:', e.message); }
}

async function getHistory() {
  try {
    const s = await getDB().collection('users').doc('default').collection('data').doc('rec_history').get();
    return s.exists ? (s.data().records || []) : [];
  } catch (e) { return []; }
}

async function saveHistory(records) {
  try {
    await getDB().collection('users').doc('default').collection('data').doc('rec_history')
      .set({ records, updatedAt: new Date() }, { merge: true });
  } catch (e) {}
}

async function getCurrentPrice(sym) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    return Array.isArray(d) && d[0]?.price ? +d[0].price : null;
  } catch (e) { return null; }
}

async function updatePendingResults(history) {
  let changed  = false;
  const pending = history.filter(h => h.result === 'pending');
  if (!pending.length) return { history, changed };

  const symbols = [...new Set(pending.map(h => h.id))];
  const prices  = {};
  for (let i = 0; i < symbols.length; i += 8) {
    await Promise.all(symbols.slice(i, i + 8).map(async sym => {
      const p = await getCurrentPrice(sym);
      if (p) prices[sym] = p;
    }));
  }

  history.forEach(h => {
    if (h.result !== 'pending') return;
    const cur = prices[h.id];
    if (!cur) return;
    const daysSince = (Date.now() - new Date(h.recDate)) / (1000 * 60 * 60 * 24);
    const pnlPct    = +((cur - h.recPrice) / h.recPrice * 100).toFixed(2);
    const hitTarget = h.target   && cur >= h.target;
    const hitStop   = h.stopLoss && cur <= h.stopLoss;
    const expired   = daysSince  >= 7;
    if (hitTarget || hitStop || expired) {
      h.result = pnlPct >= 0 ? 'win' : 'loss';
      h.resultDate = new Date().toISOString(); h.resultPrice = cur; h.pnlPct = pnlPct;
      h.closedBy = hitTarget ? 'target' : hitStop ? 'stop' : 'expired';
      changed = true;
    } else { h.pnlPct = pnlPct; }
  });

  return { history, changed };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    let history = await getHistory();
    if (!history.length) {
      await tgSend('📊 <b>تقرير تريدر برو X</b>\n──────────────\n⏳ لا يوجد سجل توصيات بعد');
      res.status(200).json({ ok: true }); return;
    }

    const { history: updated, changed } = await updatePendingResults(history);
    if (changed) { await saveHistory(updated); history = updated; }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thisWeek   = history.filter(h => new Date(h.recDate) >= oneWeekAgo);

    function stats(recs) {
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
      return {
        total: recs.length, wins: wins.length, losses: losses.length,
        pending: recs.filter(h => h.result === 'pending').length,
        winRate, avgWin, avgLoss, exp, best, worst,
        openWR: openR.length ? Math.round(openR.filter(h => h.result === 'win').length / openR.length * 100) : null,
        midWR:  midR.length  ? Math.round(midR.filter(h => h.result === 'win').length  / midR.length  * 100) : null,
        openCount: openR.length, midCount: midR.length,
      };
    }

    const w = stats(thisWeek);
    const a = stats(history);

    const dateStr = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let msg = `📊 <b>تقرير تريدر برو X</b>\n📅 ${dateStr}\n━━━━━━━━━━━━━━━━\n\n`;

    msg += `🗓 <b>هذا الأسبوع (${w.total} توصية)</b>\n──────────────\n`;
    if (!w.wins && !w.losses) {
      msg += `⏳ لا توجد صفقات مغلقة بعد\n`;
    } else {
      msg += `✅ ${w.wins} ناجحة  ❌ ${w.losses} خاسرة  ⏳ ${w.pending} معلقة\n`;
      msg += `🎯 نسبة النجاح: <b>${w.winRate}%</b>\n`;
      msg += `💰 متوسط الربح: <b>+${w.avgWin}%</b>\n`;
      msg += `📉 متوسط الخسارة: <b>${w.avgLoss}%</b>\n`;
      msg += `🧮 التوقع الرياضي: <b>${w.exp >= 0 ? '+' : ''}${w.exp}%</b>\n`;
      if (w.openWR !== null) msg += `──────────────\n🌅 الافتتاح: ${w.openWR}% (${w.openCount})\n🌇 المنتصف: ${w.midWR}% (${w.midCount})\n`;
      if (w.best)  msg += `──────────────\n🏆 أفضل: <b>${w.best.id}</b> +${w.best.pnlPct}%\n`;
      if (w.worst) msg += `💀 أسوأ: <b>${w.worst.id}</b> ${w.worst.pnlPct}%\n`;
    }

    const wV = w.exp >= 2 && w.winRate >= 60 ? '✅ الأداة ممتازة — استمر' :
               w.exp >= 1 && w.winRate >= 50 ? '✅ الأداة مربحة — جيد' :
               w.exp >= 0 && w.winRate >= 45 ? '⚠️ الأداة متعادلة — راجع المعادلات' :
               w.winRate >= 40               ? '⚠️ أداء ضعيف — خفف المخاطرة' :
                                               '❌ الأداة خاسرة — أوقف وراجع الكود';
    msg += `\n${wV}\n\n━━━━━━━━━━━━━━━━\n\n`;

    msg += `📈 <b>الأداء الكلي (${a.total} توصية)</b>\n──────────────\n`;
    msg += `✅ ${a.wins}  ❌ ${a.losses}  ⏳ ${a.pending}\n`;
    msg += `🎯 نسبة النجاح: <b>${a.winRate}%</b>\n`;
    msg += `🧮 التوقع الرياضي: <b>${a.exp >= 0 ? '+' : ''}${a.exp}%</b>\n`;

    const aV = a.exp >= 2 && a.winRate >= 60 ? '✅ الأداة ممتازة — استمر' :
               a.exp >= 1 && a.winRate >= 50 ? '✅ الأداة مربحة — جيد' :
               a.exp >= 0 && a.winRate >= 45 ? '⚠️ الأداة متعادلة — راجع المعادلات' :
               a.winRate >= 40               ? '⚠️ أداء ضعيف — خفف المخاطرة' :
                                               '❌ الأداة خاسرة — أوقف وراجع الكود';
    msg += `\n${aV}\n━━━━━━━━━━━━━━━━\n\n💡 <b>ملاحظة:</b>\n`;

    if (w.winRate < 40 && (w.wins + w.losses) >= 3)
      msg += `• نسبة نجاح منخفضة — راجع شرط confidence في calcRecs\n• جرب رفعه من 60% إلى 70%\n`;
    else if (w.avgLoss < -5 && w.losses > 0)
      msg += `• متوسط الخسارة مرتفع — راجع معادلة ATR للوقف\n• جرب تضييق الوقف من ATR×2 إلى ATR×1.5\n`;
    else if (w.openWR !== null && w.midWR !== null && w.midWR < w.openWR - 20)
      msg += `• توصيات المنتصف أضعف — فكر في تشديد شروطها\n`;
    else if (w.winRate >= 60)
      msg += `• أداء ممتاز 🎯 استمر بنفس المعادلات\n`;
    else
      msg += `• أداء طبيعي — تحتاج 20+ صفقة للتقييم الموثوق\n`;

    await tgSend(msg);
    res.status(200).json({ ok: true, total: history.length });
  } catch (e) {
    console.error('report:', e.message);
    await tgSend(`⚠️ خطأ في التقرير: ${e.message}`);
    res.status(200).json({ ok: false });
  }
};
