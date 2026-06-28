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

  function buildRecCardDecision({
    confidence=0,
    tradeQuality=0,
    riskReward=0,
    profitPct=0,
    entryTiming='انتظر',
    entryNote='',
    isCooldown=false,
    tooCloseToResistance=false,
    trendOk=true,
    newsOk=true,
    newsBlocked=false,
    signal='انتظار',
    macdHist=null,
    volR=0,
    change=0,
    nearSupport=false,
    distToSupport=999,
    nearResistance=false,
    minEntryRR=1.5,
    minEntryQuality=50,
    minEntryADX=18,
    priceText='السعر الحالي',
    idealEntryText='الدعم',
  } = {}) {
    const signalQuality = confidence >= 70 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW';
    const rrOkForEntry = riskReward >= minEntryRR;
    const qualityOkForEntry = tradeQuality >= minEntryQuality;
    const timingOkForEntry = entryTiming === 'ادخل الآن' || entryTiming === 'مقبول';
    const entryBlockReasons = [];

    if (!rrOkForEntry) entryBlockReasons.push('R/R أقل من ' + minEntryRR + 'x');
    if (!qualityOkForEntry) entryBlockReasons.push('جودة الصفقة أقل من ' + minEntryQuality + '%');
    if (!trendOk) entryBlockReasons.push('ADX ضعيف ولا يوجد دعم كاف');
    if (!newsOk) entryBlockReasons.push('خبر سلبي مؤثر');
    if (!timingOkForEntry) entryBlockReasons.push('التوقيت غير مناسب');

    const activeBuy = !isCooldown && !tooCloseToResistance && signalQuality === 'HIGH' &&
      rrOkForEntry && qualityOkForEntry && trendOk && newsOk && timingOkForEntry;
    const blockEntry = isCooldown || signalQuality === 'LOW' || entryTiming === 'متأخر' || newsBlocked;
    const earlyMomentum = (macdHist != null && macdHist > 0) || (volR >= 1.2 && (change || 0) > 0);
    const earlyNear = nearSupport || distToSupport <= 6;
    const conditionalBuy = !activeBuy && !blockEntry && !tooCloseToResistance &&
      newsOk && signal !== 'بيع' && signal !== 'بيع قوي' &&
      riskReward >= 1.3 && profitPct >= 2 && confidence >= 58 && tradeQuality >= 35 &&
      (entryTiming === 'مقبول' || entryTiming === 'انتظر' || earlyNear) &&
      (earlyMomentum || earlyNear);
    const ignitionReady = earlyMomentum && (volR >= 1.5 || nearSupport || distToSupport <= 4);
    const earlyMoveOk = change <= 12 || ignitionReady || (volR >= 2 && !nearResistance);
    const earlyRadar = !activeBuy && !conditionalBuy && !blockEntry && !tooCloseToResistance &&
      newsOk && riskReward >= 1.15 && profitPct >= 2 && confidence >= 50 &&
      (earlyNear || earlyMomentum) && earlyMoveOk;
    const watchOnly = !activeBuy && !blockEntry;
    const recStage = activeBuy ? 'confirmed' : conditionalBuy ? 'conditional' : earlyRadar ? 'early' : 'reject';

    const decision = activeBuy
      ? {label:'ادخل الآن', tone:'buy', note:entryNote}
      : conditionalBuy
        ? {label:'ادخل بشرط', tone:'conditional', note:'ادخل فقط إذا ثبت فوق ' + priceText + ' أو رجع قرب ' + idealEntryText + ' مع حجم داعم.'}
        : earlyRadar
          ? {label:'استعد', tone:'early', note:'بداية حركة محتملة؛ انتظر تأكيد الحجم أو رجوع فوق نقطة الدخول.'}
          : {label:'مرفوض', tone:'reject', note:'لم تكتمل شروط التوصية.'};

    const finalEntryNote = activeBuy
      ? entryNote
      : conditionalBuy || earlyRadar
        ? decision.note
        : entryBlockReasons.length
          ? 'لا تدخل الآن - ' + entryBlockReasons.join('، ')
          : entryNote;

    return {
      signalQuality, rrOkForEntry, qualityOkForEntry, timingOkForEntry,
      entryBlockReasons, activeBuy, blockEntry, watchOnly, conditionalBuy,
      earlyRadar, recStage, recDecision: decision, finalEntryNote,
      earlyMomentum, earlyNear, ignitionReady, earlyMoveOk,
    };
  }

  function calcRecTradeMetrics({price=0, support=null, resistance=null, atrPct=null, nearSupport=false, nearResistance=false} = {}) {
    price = +price || 0;
    support = support != null ? +support : null;
    resistance = resistance != null ? +resistance : null;
    atrPct = atrPct != null ? +atrPct : null;
    if (price <= 0) {
      return {
        stopLoss: 0, target: 0, profitPct: 0, lossPct: 0, riskReward: 0,
        roomToResistance: 999, minRoomToResistance: 3, tooCloseToResistance: false,
        tradeQuality: 0, distToSupport: 999, entryTiming: 'انتظر',
        entryNote: 'لا توجد بيانات سعر كافية', idealEntry: 0,
      };
    }

    const atrMultFinal = atrPct ? (atrPct < 2 ? 1.5 : atrPct < 4 ? 2.0 : 2.5) : 1.5;
    const atrStop = atrPct ? Math.min(atrPct * atrMultFinal, 15) : 2;
    const atrBasedStop = price * (1 - atrStop / 100);
    const supBasedStop = support ? support * 0.99 : null;
    const stopLoss = Math.max(
      supBasedStop && supBasedStop > atrBasedStop ? supBasedStop : atrBasedStop,
      price * 0.75
    );
    const minTarget = price * 1.03;
    const atrTarget = price * (1 + Math.max(atrStop * 2, 3) / 100);
    const atrRealist = price + (atrPct ? price * atrPct / 100 * 3.5 : price * 0.08);
    const resValid = resistance && resistance > price * 1.02 && resistance > minTarget;
    const resTarget = resValid ? resistance : null;
    const roomToResistance = resistance && resistance > price
      ? (resistance - price) / price * 100
      : 999;
    const minRoomToResistance = Math.max(3, (atrPct || 2) * 0.8);
    const tooCloseToResistance = resistance && roomToResistance < minRoomToResistance;
    const target = resTarget
      ? Math.min(resTarget * 0.98, atrRealist > minTarget ? atrRealist : resTarget * 0.98)
      : Math.max(atrTarget, minTarget);
    const profitPct = (target - price) / price * 100;
    const lossPct = (price - stopLoss) / price * 100;
    const riskReward = lossPct > 0 ? profitPct / lossPct : 0;

    let tradeQuality = 0;
    if (riskReward >= 3.0) tradeQuality += 40;
    else if (riskReward >= 2.0) tradeQuality += 30;
    else if (riskReward >= 1.5) tradeQuality += 20;
    else if (riskReward >= 1.0) tradeQuality += 10;
    if (nearSupport) tradeQuality += 25;
    if (profitPct >= 5) tradeQuality += 20;
    else if (profitPct >= 3) tradeQuality += 15;
    else if (profitPct >= 2) tradeQuality += 8;
    if (tooCloseToResistance) tradeQuality -= 25;
    if (atrPct != null && atrPct < 2) tradeQuality += 15;
    else if (atrPct != null && atrPct < 3) tradeQuality += 8;
    tradeQuality = Math.min(100, Math.max(0, tradeQuality));

    const distToSupport = support > 0 ? (price - support) / price * 100 : 999;
    let entryTiming, entryNote;
    if (tooCloseToResistance || nearResistance) {
      entryTiming = 'انتظر';
      entryNote = 'السعر قريب من المقاومة - انتظر كسرها أو تراجع';
    } else if (nearSupport) {
      entryTiming = 'ادخل الآن';
      entryNote = 'السعر عند الدعم - أفضل نقطة دخول';
    } else if (distToSupport <= 5) {
      entryTiming = 'مقبول';
      entryNote = support ? 'انتظر تراجعاً بسيطاً نحو $' + support.toFixed(2) + ' أفضل' : 'قريب من منطقة دخول مقبولة';
    } else if (distToSupport <= 10) {
      entryTiming = 'انتظر';
      entryNote = support ? 'السعر بعيد عن الدعم - انتظر تراجعاً لـ $' + support.toFixed(2) : 'انتظر نقطة دخول أوضح';
    } else {
      entryTiming = 'متأخر';
      entryNote = support ? 'الدخول الآن محفوف بالمخاطر - الدعم عند $' + support.toFixed(2) : 'الدخول الآن متأخر';
    }
    const idealEntry = nearSupport ? price : (support ? support * 1.01 : price);

    return {
      stopLoss:+stopLoss.toFixed(2),
      target:+target.toFixed(2),
      profitPct:+profitPct.toFixed(2),
      lossPct:+lossPct.toFixed(2),
      riskReward:+riskReward.toFixed(2),
      roomToResistance:+roomToResistance.toFixed(2),
      minRoomToResistance:+minRoomToResistance.toFixed(2),
      tooCloseToResistance:!!tooCloseToResistance,
      tradeQuality,
      distToSupport:+distToSupport.toFixed(2),
      entryTiming,
      entryNote,
      idealEntry:+idealEntry.toFixed(2),
    };
  }

  function calcSpecTradeMetrics({price=0, support=null, resistance=null, atrPct=null} = {}) {
    price = +price || 0;
    support = support != null ? +support : null;
    resistance = resistance != null ? +resistance : null;
    atrPct = Math.max(0.5, +(atrPct || 3));

    if (price <= 0) {
      return {
        stopLoss:0, target:0, profitPct:0, lossPct:0, riskReward:0,
        resValidSpec:false, targetOk:false, targetRejectReason:'لا توجد بيانات سعر كافية',
      };
    }

    const atrStop = atrPct * 1.5;
    const rawStop = support && support < price
      ? Math.min(support * 0.985, price * (1 - atrStop / 100))
      : price * (1 - atrStop / 100);
    const stopLoss = Math.max(rawStop, price * 0.65);
    const lossPct = (price - stopLoss) / price * 100;

    const resValidSpec = resistance && resistance > price * 1.05;
    const atrExtTarget = price * (1 + atrPct * 2.5 / 100);
    const minRRTarget = price * (1 + lossPct * 1.6 / 100);

    let target = null;
    if (resValidSpec && resistance > minRRTarget) {
      target = resistance;
    } else if (atrExtTarget > minRRTarget) {
      target = atrExtTarget;
    }

    if (!target) {
      return {
        stopLoss:+stopLoss.toFixed(2), target:0, profitPct:0,
        lossPct:+lossPct.toFixed(2), riskReward:0,
        resValidSpec:!!resValidSpec, targetOk:false,
        targetRejectReason:'لا يوجد هدف حقيقي مناسب للمخاطرة',
      };
    }

    if (!resValidSpec && resistance && resistance > price && resistance < target) {
      target = resistance * 0.97;
    }

    const profitPct = (target - price) / price * 100;
    const riskReward = lossPct > 0 ? profitPct / lossPct : 0;

    return {
      stopLoss:+stopLoss.toFixed(2),
      target:+target.toFixed(2),
      profitPct:+profitPct.toFixed(2),
      lossPct:+lossPct.toFixed(2),
      riskReward:+riskReward.toFixed(2),
      resValidSpec:!!resValidSpec,
      targetOk:true,
      targetRejectReason:'',
    };
  }

  function buildSpecEntryPlan({price=0, support=null, nearSupport=false, tooCloseToResistance=false, score=0, riskReward=0} = {}) {
    price = +price || 0;
    support = support != null ? +support : null;
    score = +score || 0;
    riskReward = +riskReward || 0;

    const distToSupport = support > 0 && price > 0 ? (price - support) / price * 100 : 999;
    let entryTiming, entryNote;

    if (nearSupport) {
      entryTiming = 'ادخل الآن';
      entryNote = support ? 'السعر عند الدعم $' + support.toFixed(2) + ' — أفضل نقطة دخول' : 'السعر عند الدعم — أفضل نقطة دخول';
    } else if (distToSupport <= 8) {
      entryTiming = 'مقبول';
      entryNote = support ? 'قريب من الدعم — يمكن الدخول أو انتظار $' + support.toFixed(2) : 'قريب من الدعم — يمكن الدخول أو الانتظار';
    } else if (distToSupport <= 18) {
      entryTiming = 'انتظر';
      entryNote = support ? 'انتظر تراجعاً نحو $' + support.toFixed(2) + ' للدخول بأمان' : 'انتظر تراجعاً للدخول بأمان';
    } else {
      entryTiming = 'متأخر';
      entryNote = 'بعيد عن الدعم — الدخول محفوف بالمخاطر';
    }

    const isWatch = !!tooCloseToResistance || score < 45 || riskReward < 1.45 || entryTiming === 'انتظر' || entryTiming === 'متأخر';
    const label = isWatch ? '👀 مراقبة مجازفة' :
      score >= 80 ? '🚀 انفجار محتمل' :
      score >= 65 ? '🔥 زخم قوي' :
      score >= 50 ? '⚡ فرصة نشطة' :
      '🎲 مجازفة';
    const allocPct = isWatch ? 0 : score >= 70 ? 0.10 : score >= 55 ? 0.07 : 0.05;

    return {
      distToSupport:+distToSupport.toFixed(2),
      entryTiming,
      entryNote,
      isWatch,
      label,
      allocPct,
    };
  }

  function selectRecommendations(candidates=[], {
    minEntryRR=1.5,
    minEntryQuality=50,
    minEntryADX=18,
    maxRecs=10,
  } = {}) {
    const list = (Array.isArray(candidates) ? candidates : [])
      .filter(Boolean)
      .filter(s => s.recStage === 'confirmed' || s.recStage === 'conditional' || s.recStage === 'early')
      .filter(s => s.signal === 'شراء قوي' || s.signal === 'شراء' || s.conditionalBuy || s.earlyRadar)
      .filter(s => s.activeBuy ? s.confidence >= 70 : s.confidence >= 50)
      .filter(s => s.activeBuy ? s.tradeQuality >= minEntryQuality : s.tradeQuality >= 30)
      .filter(s => s.profitPct >= 2)
      .filter(s => s.activeBuy ? s.riskReward >= minEntryRR : s.riskReward >= 1.15)
      .filter(s => {
        const beta = s.beta || 1;
        const earnings = s.earnings ?? 999;
        if (beta >= 1.5) return earnings > 21;
        if (beta >= 1.2) return earnings > 14;
        return earnings > 5;
      })
      .filter(s => {
        const ch = s.change || 0;
        if (ch <= 8) return true;
        const supportedMove = (s.volR || 0) >= 1.8 || s.nearSupport || s.ignitionReady;
        const tooExtendedNow = s.tooCloseToResistance && !s.nearSupport;
        if (s.activeBuy) return ch <= 14 || (supportedMove && !tooExtendedNow);
        return ch <= 18 || ((s.volR || 0) >= 2.2 && !tooExtendedNow);
      })
      .filter(s => {
        const gain30d = s.gain30d || 0;
        const supportedTrend = s.nearSupport || (s.volR || 0) >= 1.8 || s.ignitionReady;
        const limit = s.activeBuy ? 60 : 90;
        return gain30d <= limit || (supportedTrend && !s.tooCloseToResistance);
      })
      .filter(s => s.entryTiming === 'ادخل الآن' || s.entryTiming === 'مقبول' || s.conditionalBuy || s.earlyRadar)
      .filter(s => !s.tooCloseToResistance && (s.roomToResistance == null || s.roomToResistance >= Math.max(4, s.minRoomToResistance || 0)))
      .filter(s => s.ma50 == null || s.price >= s.ma50 * 0.97)
      .filter(s => s.nearSupport || s.adx == null || s.adx >= minEntryADX || (s.macdHist != null && s.macdHist > 0))
      .filter(s => !s.newsImpact?.block && s.newsImpact?.level !== 'neg')
      .filter(s => (s.dataQuality || 0) >= 100)
      .filter(s => {
        const avg = s.avgVolume || 0;
        return avg === 0 || avg >= 500000;
      });

    list.sort((a,b) => {
      const timingBonus = (s) =>
        s.entryTiming === 'ادخل الآن' ? 15 :
        s.entryTiming === 'مقبول' ? 5 : 0;
      const convictionBonus = (s) => s.isConviction ? 10 : 0;
      const candleBonus = (s) => {
        if(!s.candlePatterns?.length) return 0;
        const top = s.candlePatterns[0];
        return top.signal === 'bullish' ? top.strength * 2 : top.signal === 'bearish' ? -top.strength * 2 : 0;
      };
      const rsBonus = (s) => s.relativeStrength ? Math.max(-10, Math.min(15, s.relativeStrength.score)) : 0;
      const analystBonus = (s) => s.analystView ? Math.max(-8, Math.min(8, s.analystView.bias * 3)) : 0;
      const stageBonus = (s) => s.recStage === 'confirmed' ? 25 : s.recStage === 'conditional' ? 10 : 0;
      const scoreA = a.strength*0.4 + a.confidence*0.3 + a.tradeQuality*0.2
                   + timingBonus(a) + convictionBonus(a) + candleBonus(a) + rsBonus(a) + analystBonus(a) + stageBonus(a);
      const scoreB = b.strength*0.4 + b.confidence*0.3 + b.tradeQuality*0.2
                   + timingBonus(b) + convictionBonus(b) + candleBonus(b) + rsBonus(b) + analystBonus(b) + stageBonus(b);
      return scoreB - scoreA;
    });

    const recs = [];
    const usedSectors = new Set();
    for (const c of list) {
      if (recs.length >= maxRecs) break;
      if (!usedSectors.has(c.sector)) {
        recs.push(c);
        usedSectors.add(c.sector);
      }
    }
    for (const c of list) {
      if (recs.length >= maxRecs) break;
      if (!recs.find(r => r.id === c.id)) recs.push(c);
    }
    return recs;
  }

  return { estimateTradeDuration, calcTradeDecision, buildRecCardDecision, calcRecTradeMetrics, calcSpecTradeMetrics, buildSpecEntryPlan, selectRecommendations };
});
