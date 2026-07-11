(function(root, factory) {
  const api = factory();
  root.DayTradeEngine = api;
  root.LateEntryFilter = api.LateEntryFilter;
  root.ExhaustionFilter = api.ExhaustionFilter;
  root.DayTradeLogger = api.DayTradeLogger;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const LOG_KEY = 'day_trade_engine_log';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, +n || 0));
  const num = (v, fallback = 0) => Number.isFinite(+v) ? +v : fallback;
  const pct = (a, b) => b ? ((a - b) / b) * 100 : 0;
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + (+b || 0), 0) / arr.length : 0;

  function intradayStats(ctx) {
    const bars = Array.isArray(ctx.bars) ? ctx.bars : [];
    const closes = bars.map(b => num(b.close)).filter(Boolean);
    const highs = bars.map(b => num(b.high || b.close)).filter(Boolean);
    const lows = bars.map(b => num(b.low || b.close)).filter(Boolean);
    const vols = bars.map(b => num(b.volume));
    const price = num(ctx.price);
    const vwap = num(ctx.vwap);
    const support = num(ctx.support);
    const resistance = num(ctx.resistance);
    const dayHigh = num(ctx.dayHigh) || (highs.length ? Math.max(...highs) : price);
    const dayLow = num(ctx.dayLow) || (lows.length ? Math.min(...lows) : price);
    const lastClose = closes[closes.length - 1] || price;
    const close15 = closes.length >= 4 ? closes[closes.length - 4] : closes[0] || price;
    const close30 = closes.length >= 7 ? closes[closes.length - 7] : closes[0] || price;
    const last15Pct = pct(lastClose, close15);
    const last30Pct = pct(lastClose, close30);
    const recentLow = lows.slice(-5).length ? Math.min(...lows.slice(-5)) : price;
    const vwapDistancePct = vwap > 0 ? pct(price, vwap) : null;
    const supportDistancePct = support > 0 ? pct(price, support) : 999;
    const resistanceDistancePct = resistance > 0 ? pct(resistance, price) : 999;
    const nearDayHighPct = dayHigh > 0 ? pct(dayHigh, price) : 999;
    const dayRangePct = dayLow > 0 ? pct(dayHigh, dayLow) : 0;
    const prevVolAvg = avg(vols.slice(-7, -3));
    const last3VolAvg = avg(vols.slice(-3));
    const prev3VolAvg = avg(vols.slice(-6, -3));
    const lastBars = bars.slice(-3);
    const upperWickRatio = avg(lastBars.map(b => {
      const high = num(b.high || b.close);
      const low = num(b.low || b.close);
      const open = num(b.open || b.close);
      const close = num(b.close);
      const range = Math.max(high - low, 0.0001);
      return (high - Math.max(open, close)) / range;
    }));
    const pullbackHealthy = !!(
      ctx.higherLow ||
      (vwap > 0 && recentLow <= vwap * 1.008 && price >= vwap) ||
      (support > 0 && supportDistancePct >= -0.2 && supportDistancePct <= 2.2)
    );

    return {
      bars, price, vwap, support, resistance, dayHigh, dayLow,
      last15Pct, last30Pct, recentLow, vwapDistancePct,
      supportDistancePct, resistanceDistancePct, nearDayHighPct,
      dayRangePct, prevVolAvg, last3VolAvg, prev3VolAvg,
      upperWickRatio, pullbackHealthy,
    };
  }

  function LateEntryFilter(ctx) {
    const s = intradayStats(ctx);
    const atr = Math.max(0.5, num(ctx.atrPct, 3));
    const move = num(ctx.movePct);
    const reasons = [];
    const flags = {};
    const hasVwap = s.vwap > 0;
    const hasIntradayBars = Array.isArray(s.bars) && s.bars.length >= 3;

    flags.missingIntradayData = !hasVwap || !hasIntradayBars;
    flags.farFromVwap = s.vwapDistancePct != null && s.vwapDistancePct > Math.max(1.15, Math.min(2.2, atr * 0.35));
    flags.nearHigh = move >= 3 && s.nearDayHighPct <= 0.45;
    flags.fastRise = s.last15Pct >= 2.2 || s.last30Pct >= 3.5;
    flags.noHealthyPullback = move >= 4 && !s.pullbackHealthy;
    flags.afterMove = move >= 6 && (flags.farFromVwap || flags.nearHigh || flags.noHealthyPullback);
    flags.nearResistance = s.resistanceDistancePct <= Math.max(0.7, atr * 0.25);

    if (flags.missingIntradayData) reasons.push('بيانات VWAP أو الشموع اللحظية غير مكتملة');
    if (flags.farFromVwap) reasons.push('السعر بعيد عن VWAP');
    if (flags.nearHigh) reasons.push('السعر قريب من أعلى اليوم');
    if (flags.fastRise) reasons.push('صعود سريع خلال آخر 15-30 دقيقة');
    if (flags.noHealthyPullback) reasons.push('الصعود تم بدون تراجع صحي');
    if (flags.afterMove) reasons.push('البطاقة ظهرت بعد جزء كبير من الحركة');
    if (flags.nearResistance) reasons.push('قريب من مقاومة لحظية');

    const severity = (flags.missingIntradayData ? 2 : 0) +
      (flags.afterMove ? 2 : 0) +
      (flags.farFromVwap ? 1 : 0) +
      (flags.nearHigh ? 1 : 0) +
      (flags.fastRise ? 1 : 0) +
      (flags.noHealthyPullback ? 1 : 0) +
      (flags.nearResistance ? 1 : 0);

    return {
      lateEntryFlag: severity >= 2,
      severity,
      reasons,
      flags,
      stats: s,
      dataReady: !flags.missingIntradayData,
      hasVwap,
      hasIntradayBars,
      dataStatus: flags.missingIntradayData ? 'متأخرة/ناقصة' : 'لحظية',
    };
  }

  function ExhaustionFilter(ctx) {
    const s = intradayStats(ctx);
    const move = num(ctx.movePct);
    const reasons = [];
    const flags = {};

    flags.volumeFade = move >= 3 && s.prev3VolAvg > 0 && s.last3VolAvg < s.prev3VolAvg * 0.75;
    flags.upperWicks = move >= 2.5 && s.upperWickRatio >= 0.42;
    flags.failedResistance = s.resistance > 0 && s.resistanceDistancePct <= 0.8 &&
      s.dayHigh >= s.resistance * 0.995 && s.price < s.resistance;
    flags.momentumWeak = move > 0 && (num(ctx.macd5Hist) <= 0 || s.last15Pct < 0);
    flags.aboveNormalMove = move >= Math.max(6, num(ctx.atrPct, 3) * 1.3);

    if (flags.volumeFade) reasons.push('الفوليوم بدأ يقل بعد الصعود');
    if (flags.upperWicks) reasons.push('شموع علوية طويلة');
    if (flags.failedResistance) reasons.push('فشل قرب مقاومة');
    if (flags.momentumWeak) reasons.push('السعر يصعد لكن الزخم يضعف');
    if (flags.aboveNormalMove) reasons.push('الارتفاع أكبر من حركة السهم المعتادة');

    const severity = (flags.volumeFade ? 1 : 0) +
      (flags.upperWicks ? 1 : 0) +
      (flags.failedResistance ? 2 : 0) +
      (flags.momentumWeak ? 1 : 0) +
      (flags.aboveNormalMove ? 1 : 0);

    return {
      exhaustionFlag: severity >= 2,
      severity,
      reasons,
      flags,
      stats: s,
    };
  }

  function analyze(ctx) {
    const late = LateEntryFilter(ctx);
    const exhaust = ExhaustionFilter(ctx);
    const move = num(ctx.movePct);
    const rvol = num(ctx.rvol);
    const rr = num(ctx.rr);
    const lossPct = num(ctx.lossPct);
    const scoreBoost = num(ctx.baseScore);
    const entryZoneOk = !!ctx.entryZoneOk;
    const supportLost = !!ctx.supportLost;
    const spreadRisk = !!ctx.spreadRisk;
    const gateAllows = ctx.candleAllows !== false;
    const aboveVwap = !!ctx.aboveVwap;
    const breakout15 = !!ctx.breakout15;
    const higherLow = !!ctx.higherLow;
    const macd5Ok = !!ctx.macd5Ok;
    const dataReady = late.dataReady !== false;

    const momentumScore = clamp(
      (move > 0 ? 16 : 0) +
      (move >= 2 ? 12 : 0) +
      (aboveVwap ? 18 : 0) +
      (breakout15 ? 18 : 0) +
      (higherLow ? 14 : 0) +
      (macd5Ok ? 12 : 0) +
      (num(ctx.rs30) >= 0.5 ? 10 : 0),
      0, 100
    );
    const volumeScore = clamp(
      (rvol >= 1 ? 35 : rvol * 30) +
      (rvol >= 1.4 ? 20 : 0) +
      (rvol >= 2.2 ? 25 : 0) +
      (num(ctx.volumeRatio) >= 1.2 ? 10 : 0),
      0, 100
    );
    const timingScore = clamp(
      78 +
      (entryZoneOk ? 16 : -18) +
      (higherLow ? 8 : 0) -
      late.severity * 12 -
      exhaust.severity * 10,
      0, 100
    );
    const riskScore = clamp(
      45 -
      (rr >= 1.5 ? 12 : 0) +
      (rr < 1.2 ? 22 : 0) +
      (lossPct > 3 ? 10 : 0) +
      (supportLost ? 35 : 0) +
      (spreadRisk ? 12 : 0) +
      late.severity * 8 +
      exhaust.severity * 8,
      0, 100
    );
    const dayTradeScore = clamp(
      momentumScore * 0.32 +
      volumeScore * 0.22 +
      timingScore * 0.30 +
      (100 - riskScore) * 0.16 +
      scoreBoost * 0.05,
      0, 100
    );

    let tradeDecision = 'WATCH';
    let reason = 'السهم تحت المتابعة؛ لم تكتمل نقطة دخول يومية نظيفة.';

    if (!dataReady) {
      tradeDecision = 'WATCH';
      reason = 'بيانات VWAP أو الشموع اللحظية غير مكتملة؛ لا دخول حتى تكتمل.';
    } else if (supportLost || spreadRisk || !gateAllows || rvol < 0.8) {
      tradeDecision = 'REJECT';
      reason = supportLost ? 'السعر فقد الدعم؛ لا تدخل.' :
        spreadRisk ? 'مخاطرة السبريد عالية.' :
        !gateAllows ? 'الشموع لا تسمح بدخول آمن.' :
        'الفوليوم ضعيف للمضاربة.';
    } else if (exhaust.exhaustionFlag && late.lateEntryFlag) {
      tradeDecision = 'LATE_DO_NOT_ENTER';
      reason = 'الحركة متأخرة ومعها علامات إنهاك: ' + [...late.reasons, ...exhaust.reasons].slice(0, 3).join('، ');
    } else if (late.lateEntryFlag) {
      tradeDecision = late.severity >= 4 ? 'LATE_DO_NOT_ENTER' : 'WAIT_PULLBACK';
      reason = 'السهم قوي لكن نقطة الدخول متأخرة: ' + late.reasons.slice(0, 3).join('، ');
    } else if (exhaust.exhaustionFlag) {
      tradeDecision = exhaust.severity >= 4 ? 'REJECT' : 'WAIT_PULLBACK';
      reason = 'توجد علامات إنهاك بعد الصعود: ' + exhaust.reasons.slice(0, 3).join('، ');
    } else if (
      momentumScore >= 75 &&
      volumeScore >= 70 &&
      timingScore >= 75 &&
      riskScore <= 55 &&
      entryZoneOk &&
      rr >= 1.2
    ) {
      tradeDecision = 'ENTER_NOW';
      reason = 'زخم وحجم مع نقطة دخول غير متأخرة ومخاطرة مقبولة.';
    } else if (momentumScore >= 70 && volumeScore >= 65 && timingScore >= 50) {
      tradeDecision = 'WAIT_PULLBACK';
      reason = 'السهم قوي، لكن الأفضل انتظار رجوع أقرب لمنطقة الدخول.';
    }

    return {
      dayTradeScore: Math.round(dayTradeScore),
      timingScore: Math.round(timingScore),
      momentumScore: Math.round(momentumScore),
      volumeScore: Math.round(volumeScore),
      riskScore: Math.round(riskScore),
      lateEntryFlag: late.lateEntryFlag,
      exhaustionFlag: exhaust.exhaustionFlag,
      pullbackRisk: late.flags.noHealthyPullback || late.flags.farFromVwap,
      tradeDecision,
      reason,
      dataStatus: late.dataStatus,
      hasVwap: late.hasVwap,
      hasIntradayBars: late.hasIntradayBars,
      dataReady,
      lateEntry: late,
      exhaustion: exhaust,
    };
  }

  function loadLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) { return []; }
  }

  function saveLog(records) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify((records || []).slice(-1200))); } catch(e) {}
  }

  function sessionKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  function updateCheckpoints(record, price, now) {
    const entry = num(record.price);
    if (!entry || !price) return record;
    record.maxPrice = Math.max(num(record.maxPrice, entry), price);
    record.minPrice = Math.min(num(record.minPrice, entry), price);
    record.maxGainPct = +pct(record.maxPrice, entry).toFixed(2);
    record.maxDrawdownPct = +pct(record.minPrice, entry).toFixed(2);
    const ageMin = Math.max(0, (now - new Date(record.time).getTime()) / 60000);
    if (ageMin >= 30 && record.after30m == null) record.after30m = +pct(price, entry).toFixed(2);
    if (ageMin >= 60 && record.after60m == null) record.after60m = +pct(price, entry).toFixed(2);
    return record;
  }

  const DayTradeLogger = {
    record(card, context = {}) {
      if (!card || !card.id) return;
      const now = new Date();
      const records = loadLog();
      const key = [sessionKey(now), card.id, card.action || card.decision || '', +(card.price || 0).toFixed?.(2)].join(':');
      const exists = records.find(r => r.key === key);
      const engine = card.dayEngine || {};
      const item = exists || {
        key,
        symbol: card.id,
        time: now.toISOString(),
        session: sessionKey(now),
      };
      Object.assign(item, {
        price: +(card.price || 0),
        decision: card.action || card.decision || engine.tradeDecision || '',
        lateEntryFlag: !!(card.lateEntryFlag || engine.lateEntryFlag),
        exhaustionFlag: !!(card.exhaustionFlag || engine.exhaustionFlag),
        reason: card.actionNote || card.note || engine.reason || '',
        dayTradeScore: +(engine.dayTradeScore || card.score || 0),
        timingScore: +(engine.timingScore || card.timingScore || 0),
        momentumScore: +(engine.momentumScore || card.momentumScore || 0),
        volumeScore: +(engine.volumeScore || card.volumeScore || 0),
        riskScore: +(engine.riskScore || card.riskScore || 0),
        dataStatus: engine.dataStatus || card.dataStatus || 'غير محددة',
        vwapAvailable: !!(engine.hasVwap || card.vwapAvailable || card.vwap),
        updatedAt: now.toISOString(),
        context,
      });
      if (!exists) records.push(item);
      saveLog(records);
    },

    recordBatch(cards, context = {}) {
      (cards || []).forEach(card => this.record(card, context));
    },

    evaluate(prices = {}) {
      const now = Date.now();
      const records = loadLog();
      records.forEach(r => {
        const price = +(prices[r.symbol]?.price || prices[r.symbol] || 0);
        if (price) updateCheckpoints(r, price, now);
      });
      saveLog(records);
      return records;
    },

    load: loadLog,
    clear() {
      saveLog([]);
    },
  };

  return { analyze, LateEntryFilter, ExhaustionFilter, DayTradeLogger };
});
