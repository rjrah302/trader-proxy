// ================================================================
// report.js — تقرير أسبوعي كل جمعة 11م
// يفصل بين التوصيات العادية والمجازفة
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

async function tgSend(text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('tgSend:', e.message); }
}

async function getHistory() {
  try {
    const s = await getDB().collection('users').doc('default')
      .collection('data').doc('rec_history').get();
    return s.exists ? (s.data().records || []) : [];
  } catch (e) { return []; }
}

async function saveHistory(records) {
  try {
    await getDB().collection('users').doc('default')
      .collection('data').doc('rec_history')
      .set({ records, updatedAt: new Date() }, { merge: true });
  } catch (e) {}
}

async function getCurrentPrice(sym) {
  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
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
    const maxDays   = h.type === 'spec' ? 7 : 5;
    const daysSince = (Date.now() - new Date(h.recDate)) / (1000 * 60 * 60 * 24);
    const pnlPct    = +((cur - h.recPrice) / h.recPrice * 100).toFixed(2);
    const hitTarget = h.target   && cur >= h.target;
    const hitStop   = h.stopLoss && cur <= h.stopLoss;
    const expired   = daysSince  >= maxDays;
    if (hitTarget || hitStop || expired) {
      h.result      = pnlPct >= 0 ? 'win' : 'loss';
      h.resultDate  = new Date().toISOString();
      h.resultPrice = cur;
      h.pnlPct      = pnlPct;
      h.closedBy    = hitTarget ? 'target' : hitStop ? 'stop' : 'expired';
      changed       = true;
    } else { h.pnlPct = pnlPct; }
  });

  return { history, changed };
}

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
  const withRR  = recs.filter(h => h.riskReward);
  const avgRR   = withRR.length ? +(withRR.reduce((s, h) => s + h.riskReward, 0) / withRR.length).toFixed(2) : null;
  const withLP  = recs.filter(h => h.lossPct);
  const avgLP   = withLP.length ? +(withLP.reduce((s, h) => s + h.lossPct, 0) / withLP.length).toFixed(2) : null;
  const openR   = closed.filter(h => h.session === 'افتتاح');
  const midR    = closed.filter(h => h.session === 'منتصف');
  const openWR  = openR.length ? Math.round(openR.filter(h => h.result === 'win').length / openR.length * 100) : null;
  const midWR   = midR.length  ? Math.round(midR.filter(h => h.result === 'win').length  / midR.length  * 100) : null;
  return {
    total: recs.length, wins: wins.length, losses: losses.length,
    pending: recs.filter(h => h.result === 'pending').length,
    winRate, avgWin, avgLoss, exp, best, worst, avgRR, avgLP,
    openWR, midWR, openCount: openR.length, midCount: midR.length,
  };
}

function getVerdict(exp, winRate, isSpec = false) {
  if (isSpec) {
    if (exp >= 3 && winRate >= 55) return '✅ المجازفة مربحة جداً — استمر';
    if (exp >= 1 && winRate >= 45) return '⚠️ المجازفة متعادلة — راجع الشروط';
    return '❌ المجازفة خاسرة — شدد شرط R/R أو score';
  }
  if (exp >= 2 && winRate >= 60) return '✅ الأداة ممتازة — استمر';
  if (exp >= 1 && winRate >= 50) return '✅ الأداة مربحة — جيد';
  if (exp >= 0 && winRate >= 45) return '⚠️ الأداة متعادلة — راجع المعادلات';
  if (winRate >= 40)             return '⚠️ أداء ضعيف — خفف المخاطرة';
  return '❌ الأداة خاسرة — أوقف وراجع الكود';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    let history = await getHistory();
    if (!history.length) {
      await tgSend('📊 <b>تقرير تريدر برو X</b>\n──────────────\n⏳ لا يوجد سجل توصيات بعد\nافتح الأداة في يوم تداول وانتظر توليد التوصيات');
      res.status(200).json({ ok: true }); return;
    }

    const { history: updated, changed } = await updatePendingResults(history);
    if (changed) { await saveHistory(updated); history = updated; }

    const recAll  = history.filter(h => (h.type || 'rec') === 'rec');
    const specAll = history.filter(h => h.type === 'spec');
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recWeek    = recAll.filter(h  => new Date(h.recDate) >= oneWeekAgo);
    const specWeek   = specAll.filter(h => new Date(h.recDate) >= oneWeekAgo);

    const rw = calcStats(recWeek);
    const ra = calcStats(recAll);
    const sw = calcStats(specWeek);
    const sa = calcStats(specAll);

    const dateStr = new Date().toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // ── رسالة 1: التوصيات
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
    msg1 += `\n${getVerdict(ra.exp, ra.winRate)}\n`;
    msg1 += `━━━━━━━━━━━━━━━━\n\n💡 <b>ملاحظة:</b>\n`;
    if (rw.winRate < 40 && (rw.wins + rw.losses) >= 3)
      msg1 += `• نسبة نجاح منخفضة — راجع confidence في calcRecs\n• جرب رفعه من 60% إلى 70%\n`;
    else if (rw.avgLoss < -5 && rw.losses > 0)
      msg1 += `• خسائر كبيرة — راجع معادلة ATR للوقف\n• جرب ATR×1.5 بدل ATR×2\n`;
    else if (rw.openWR !== null && rw.midWR !== null && rw.midWR < rw.openWR - 20)
      msg1 += `• المنتصف أضعف من الافتتاح — شدد شروطه\n`;
    else if (rw.winRate >= 60)
      msg1 += `• أداء ممتاز 🎯 استمر بنفس المعادلات\n`;
    else
      msg1 += `• أداء طبيعي — تحتاج 20+ صفقة للتقييم الموثوق\n`;
    await tgSend(msg1);

    // ── رسالة 2: المجازفة
    if (sa.total > 0) {
      let msg2 = `🎲 <b>المجازفة</b>\n━━━━━━━━━━━━━━━━\n\n`;
      msg2 += `🗓 <b>هذا الأسبوع (${sw.total} فرصة)</b>\n──────────────\n`;
      if (!sw.wins && !sw.losses) {
        msg2 += `⏳ لا توجد نتائج بعد\n`;
      } else {
        msg2 += `✅ ${sw.wins} ناجحة  ❌ ${sw.losses} خاسرة  ⏳ ${sw.pending} معلقة\n`;
        msg2 += `🎯 نسبة النجاح: <b>${sw.winRate}%</b>\n`;
        msg2 += `💰 متوسط الربح: <b>+${sw.avgWin}%</b>\n`;
        msg2 += `📉 متوسط الخسارة: <b>${sw.avgLoss}%</b>\n`;
        if (sw.avgRR) msg2 += `📐 متوسط R/R: <b>1:${sw.avgRR}</b>\n`;
        if (sw.avgLP) msg2 += `⚠️ متوسط المخاطرة: <b>${sw.avgLP}%</b> لكل صفقة\n`;
        msg2 += `🧮 التوقع الرياضي: <b>${sw.exp >= 0 ? '+' : ''}${sw.exp}%</b>\n`;
        if (sw.best)  msg2 += `──────────────\n🏆 أفضل: <b>${sw.best.id}</b> +${sw.best.pnlPct}%\n`;
        if (sw.worst) msg2 += `💀 أسوأ: <b>${sw.worst.id}</b> ${sw.worst.pnlPct}%\n`;
      }
      msg2 += `\n${getVerdict(sw.exp, sw.winRate, true)}\n\n━━━━━━━━━━━━━━━━\n\n`;
      msg2 += `📈 <b>الكلي (${sa.total} فرصة)</b>\n──────────────\n`;
      msg2 += `✅ ${sa.wins}  ❌ ${sa.losses}  ⏳ ${sa.pending}\n`;
      msg2 += `🎯 نسبة النجاح: <b>${sa.winRate}%</b>\n`;
      if (sa.avgRR) msg2 += `📐 متوسط R/R: <b>1:${sa.avgRR}</b>\n`;
      msg2 += `🧮 التوقع الرياضي: <b>${sa.exp >= 0 ? '+' : ''}${sa.exp}%</b>\n`;
      msg2 += `\n${getVerdict(sa.exp, sa.winRate, true)}\n`;
      msg2 += `━━━━━━━━━━━━━━━━\n\n💡 <b>ملاحظة المجازفة:</b>\n`;
      if (sa.winRate < 40 && sa.total >= 5)
        msg2 += `• نسبة نجاح منخفضة — جرب رفع score من 40 إلى 50\n`;
      else if (sa.avgLP && sa.avgLP > 8)
        msg2 += `• وقف الخسارة واسع — جرب ATR×1.5 بدل ATR×2\n`;
      else if (sa.avgRR && sa.avgRR < 2.5)
        msg2 += `• R/R منخفض — جرب رفع الحد من 2 إلى 2.5\n`;
      else if (sa.winRate >= 55)
        msg2 += `• أداء ممتاز للمجازفة 🚀 استمر\n`;
      else
        msg2 += `• تحتاج 10+ صفقة للتقييم الموثوق\n`;
      await tgSend(msg2);
    }

    console.log('[Report] أُرسل — توصيات:', recAll.length, '| مجازفة:', specAll.length);
    res.status(200).json({ ok: true, rec: recAll.length, spec: specAll.length });

  } catch (e) {
    console.error('report:', e.message);
    await tgSend(`⚠️ خطأ في التقرير: ${e.message}`);
    res.status(200).json({ ok: false, error: e.message });
  }
};
