(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RamiAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function estimateTradeDuration({kind='rec', profitPct=0, atrPct=0, macdHist=0, macdHistDir=null, weeklyTrend=null, actionTone=null, rvol=1, isNight=false} = {}) {
    const profit = Math.max(0, +profitPct || 0);
    const atr = Math.max(0.5, +atrPct || 2.5);
    const momentum =
      macdHist > 0 && macdHistDir === 'expanding' ? 1.18 :
      macdHist > 0 ? 1.0 : 0.82;
    const trend =
      weeklyTrend === 'bullish' ? 1.08 :
      weeklyTrend === 'bearish' ? 0.85 : 0.95;
    const volume =
      rvol >= 3 ? 1.12 :
      rvol >= 1.5 ? 1.04 :
      rvol > 0 && rvol < 0.9 ? 0.9 : 1;
    const action =
      actionTone === 'buy' ? 1.08 :
      actionTone === 'support' ? 0.95 :
      actionTone === 'watch' ? 0.85 : 1;

    const dailyMove = Math.max(0.35, atr * 0.45 * momentum * trend * volume * action);
    let days = Math.ceil(profit / dailyMove);

    const minDays =
      kind === 'hunter' ? (actionTone === 'buy' && !isNight ? 1 : 2) :
      kind === 'spec' ? 3 : 2;
    const maxDays =
      kind === 'hunter' ? 7 :
      kind === 'spec' ? 12 : 10;
    days = Math.max(minDays, Math.min(maxDays, days || minDays));

    const label =
      isNight ? 'بعد الافتتاح' :
      days <= 1 ? 'اليوم / جلسة واحدة' :
      days <= 3 ? days + ' أيام تداول' :
      days <= 7 ? '3-7 أيام تداول' :
      'أكثر من أسبوع';
    const tone =
      days <= 1 ? 'fast' :
      days <= 3 ? 'short' :
      days <= 7 ? 'week' : 'medium';
    return { days, label, tone };
  }

  function calcTradeDecision({kind, symbol, entry, stop, target, rr, action, watchOnly=false, noTrade=false, gainerClass=null, broker='ibkr', capital=0, riskPct=0.5} = {}) {
    if (watchOnly || noTrade || gainerClass === 'chase') riskPct = 0;
    const e = +entry, s = +stop, t = +target;
    const riskPerShare = e > 0 && s > 0 ? Math.max(e - s, 0) : 0;
    const maxRisk = capital > 0 && riskPct > 0 ? capital * riskPct / 100 : 0;
    const qty = riskPerShare > 0 && maxRisk > 0 ? Math.floor(maxRisk / riskPerShare) : 0;
    const positionValue = qty > 0 ? qty * e : 0;
    const potentialLoss = qty > 0 ? qty * riskPerShare : 0;
    const potentialProfit = qty > 0 && t > e ? qty * (t - e) : 0;
    const realRR = riskPerShare > 0 && t > e ? (t - e) / riskPerShare : (+rr || 0);

    let verdict = 'حدد رأس المال';
    let tone = 'neutral';
    let note = 'أدخل رأس مال IBKR أو سهم لتفعيل حساب الكمية.';

    if (noTrade || watchOnly || riskPct <= 0) {
      verdict = 'مراقبة فقط';
      tone = 'watch';
      note = action || 'لا يوجد أمر شراء الآن.';
    } else if (capital <= 0) {
      verdict = 'حدد رأس المال';
      tone = 'neutral';
    } else if (qty <= 0) {
      verdict = 'الكمية صفر';
      tone = 'danger';
      note = 'المسافة للوقف كبيرة بالنسبة للمخاطرة المحددة.';
    } else if (realRR < 1.2) {
      verdict = 'لا يستحق';
      tone = 'danger';
      note = 'العائد مقابل المخاطرة ضعيف؛ لا تدخل.';
    } else {
      verdict = 'قرار منضبط';
      tone = 'ok';
      note = 'لا ترفع الدخول فوق السعر المحدد، والوقف إلزامي.';
    }

    return {broker, capital, riskPct, entry:e, stop:s, target:t, riskPerShare, maxRisk, qty, positionValue, potentialLoss, potentialProfit, rr:realRR, verdict, tone, note, symbol, watchOnly, noTrade, kind};
  }

  return { estimateTradeDuration, calcTradeDecision };
});
