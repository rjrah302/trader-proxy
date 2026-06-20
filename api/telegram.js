// ═══════════════════════════════════════════════
// 🦅 RamiFalconX — Vercel Serverless Function
// /api/telegram.js
// ═══════════════════════════════════════════════

const TG_TOKEN   = '8640829693:AAEyEhSjVgW2ydLOfYAqu6epemQeL1nNMa4';
const TG_CHAT_ID = '6195578236';
const FMP_KEY    = '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

// ── إرسال رسالة
async function tgSend(text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

// ── جلب بيانات سهم من FMP
async function getStockData(sym) {
  try {
    const [quoteRes, histRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/quote/${sym}?apikey=${FMP_KEY}`),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`),
    ]);
    const quote = await quoteRes.json();
    const hist  = await histRes.json();
    const q = Array.isArray(quote) ? quote[0] : null;
    const closes = (hist?.historical || []).map(d=>d.close).reverse();
    return { q, closes };
  } catch(e) { return null; }
}

// ── حساب EMA
function calcEMA(arr, period) {
  if(!arr || arr.length < period) return null;
  const k = 2/(period+1);
  let ema = arr.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<arr.length;i++) ema = arr[i]*k + ema*(1-k);
  return ema;
}

// ── حساب RSI
function calcRSI(closes) {
  if(!closes || closes.length < 15) return null;
  const diffs = closes.slice(-15).map((c,i,a)=>i>0?c-a[i-1]:0).slice(1);
  const gains = diffs.map(d=>d>0?d:0);
  const losses = diffs.map(d=>d<0?-d:0);
  const ag = gains.reduce((a,b)=>a+b,0)/14;
  const al = losses.reduce((a,b)=>a+b,0)/14;
  return al===0 ? 100 : 100-(100/(1+ag/al));
}

// ── حساب MACD Histogram
function calcMACDHist(closes) {
  if(!closes || closes.length < 35) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if(!ema12 || !ema26) return null;
  const macd = ema12 - ema26;
  const macdArr = [];
  for(let j=35; j<=closes.length; j++) {
    const sl = closes.slice(0,j);
    const e12 = calcEMA(sl,12), e26 = calcEMA(sl,26);
    if(e12&&e26) macdArr.push(e12-e26);
  }
  const signal = calcEMA(macdArr, 9);
  return signal ? macd - signal : null;
}

// ── state بسيط (في الذاكرة — يُعاد عند كل request لكن يكفي)
const sessions = {};

// ── Handler الرئيسي
export default async function handler(req, res) {
  if(req.method !== 'POST') {
    res.status(200).json({ ok: true, msg: '🦅 RamiFalconX Bot Active' });
    return;
  }

  const body = req.body;
  const msg  = body?.message;
  if(!msg) { res.status(200).json({ ok: true }); return; }

  const text = msg.text?.trim() || '';
  const cid  = String(msg.chat?.id);

  // أمان — فقط رامي
  if(cid !== TG_CHAT_ID) {
    res.status(200).json({ ok: true });
    return;
  }

  const s   = sessions[cid] || {};
  const low = text.toLowerCase();

  // ── /start أو مرحبا
  if(text==='/start' || text==='مرحبا' || text==='هلا') {
    sessions[cid] = {};
    await tgSend(
      `🦅 <b>RamiFalconX — مرحباً رامي!</b>\n` +
      `──────────────\n` +
      `اكتب رمز السهم: <code>NVDA</code>\n` +
      `محفظتك: <code>محفظتي</code>\n` +
      `توصيات اليوم: <code>تقرير</code>\n` +
      `إغلاق صفقة: <code>خرجت ALAB</code>\n` +
      `مساعدة: <code>مساعدة</code>`
    );
    res.status(200).json({ ok: true });
    return;
  }

  // ── تقرير / توصيات
  if(text==='تقرير' || text==='توصيات') {
    await tgSend('📊 افتح الأداة لرؤية التوصيات الكاملة\nhttps://trader-proxy-36nj-iqdey5ovr-trader-rami-s-projects.vercel.app');
    res.status(200).json({ ok: true });
    return;
  }

  // ── خرجت / بعت
  if(low.startsWith('خرجت') || low.startsWith('بعت')) {
    const parts = text.split(/\s+/);
    const sym   = parts[1]?.toUpperCase();
    const price = parseFloat(parts[2]) || null;
    if(!sym) { await tgSend('⚠️ اكتب: خرجت NVDA أو خرجت NVDA 210'); res.status(200).json({ok:true}); return; }
    if(price) {
      await tgSend(`✅ <b>${sym} مغلقة بـ $${price}</b>\nالسجل سيُحدَّث في الأداة 📊`);
    } else {
      const data = await getStockData(sym);
      const cur  = data?.q?.price?.toFixed(2) || '—';
      await tgSend(`✅ <b>${sym} مغلقة</b>\nالسعر الحالي: $${cur}\nسجّل النتيجة في الأداة 📊`);
    }
    sessions[cid] = {};
    res.status(200).json({ ok: true });
    return;
  }

  // ── خطوات تسجيل الصفقة
  if(s.step === 'ask_bought') {
    if(text==='1' || text==='نعم' || text==='اشتريت') {
      sessions[cid] = { ...s, step:'ask_price' };
      await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(أو اكتب 0 لاستخدام السعر الحالي $${s.curPrice?.toFixed(2)})`);
    } else {
      sessions[cid] = {};
      await tgSend(`✅ <b>${s.sym}</b> للمراقبة فقط — سأنبهك عند تغيرات مهمة`);
    }
    res.status(200).json({ ok: true });
    return;
  }

  if(s.step === 'ask_price') {
    const entry = parseFloat(text)===0 ? s.curPrice : (parseFloat(text) || s.curPrice);
    sessions[cid] = { ...s, step:'ask_qty', entry };
    await tgSend(`كم سهم اشتريت من <b>${s.sym}</b>؟`);
    res.status(200).json({ ok: true });
    return;
  }

  if(s.step === 'ask_qty') {
    const qty    = parseInt(text) || 1;
    const entry  = s.entry;
    const atr    = s.atrPct || 3;
    const stop   = (entry*(1-atr*2/100)).toFixed(2);
    const target = (entry*(1+atr*3.5/100)).toFixed(2);
    const profPct= ((target-entry)/entry*100).toFixed(1);
    const days   = Math.ceil((parseFloat(target)-entry)/entry*100/atr);
    const capital= (entry*qty).toFixed(0);

    sessions[cid] = {};
    await tgSend(
      `✅ <b>تم تسجيل ${s.sym}</b>\n` +
      `──────────────\n` +
      `دخول: <b>$${entry?.toFixed(2)}</b>\n` +
      `كمية: <b>${qty} سهم</b>\n` +
      `رأس المال: <b>$${capital}</b>\n` +
      `──────────────\n` +
      `🛑 وقف الخسارة: <b>$${stop}</b>\n` +
      `🎯 هدف الربح: <b>$${target}</b> (+${profPct}%)\n` +
      `⏱️ مدة متوقعة: ${days<=1?'🔥 يومي':days<=3?`⚡ ${days} أيام`:`📅 ${days} أيام`}\n` +
      `──────────────\n` +
      `👀 سأراقبه وأنبهك عند الهدف أو الوقف`
    );
    res.status(200).json({ ok: true });
    return;
  }

  // ── استعلام عن سهم
  const sym = text.toUpperCase().replace(/[^A-Z]/g,'');
  if(sym.length>=2 && sym.length<=5) {
    await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
    const data = await getStockData(sym);
    if(!data?.q) {
      await tgSend(`⚠️ ${sym} — لم أجد بيانات. تأكد من الرمز`);
      res.status(200).json({ ok: true });
      return;
    }
    const q    = data.q;
    const rsi  = calcRSI(data.closes);
    const hist = calcMACDHist(data.closes);
    const chg  = q.changesPercentage || 0;

    let analysis = `📊 <b>${q.name||sym} (${sym})</b>\n`;
    analysis += `💰 السعر: <b>$${q.price?.toFixed(2)}</b> ${chg>=0?'📈':'📉'} ${chg>=0?'+':''}${chg?.toFixed(2)}%\n`;
    analysis += `──────────────\n`;
    if(rsi!=null)  analysis += `RSI: ${rsi<35?'✅':rsi>70?'❌':'⚠️'} <b>${rsi?.toFixed(1)}</b>${rsi<35?' (تشبع بيع — فرصة)':rsi>70?' (تشبع شراء — احذر)':' (محايد)'}\n`;
    if(hist!=null) analysis += `MACD Hist: ${hist>0?'✅':'❌'} <b>${hist>0?'+':''}${hist?.toFixed(2)}</b>${hist>0?' (زخم صاعد)':' (زخم هابط)'}\n`;
    analysis += `──────────────\n`;
    analysis += `هل اشتريت ${sym}؟\n1️⃣ نعم — سجّل صفقة\n2️⃣ لا — معلومات فقط`;

    sessions[cid] = { step:'ask_bought', sym, curPrice:q.price, atrPct: q.beta ? Math.max(2,q.beta*1.5) : 3 };
    await tgSend(analysis);
    res.status(200).json({ ok: true });
    return;
  }

  // ── مساعدة
  await tgSend(
    `🦅 <b>الأوامر المتاحة:</b>\n` +
    `──────────────\n` +
    `📊 تحليل سهم: <code>NVDA</code>\n` +
    `💼 محفظتك: <code>محفظتي</code>\n` +
    `📈 توصيات: <code>تقرير</code>\n` +
    `✅ إغلاق: <code>خرجت ALAB</code>\n` +
    `──────────────\n` +
    `الأداة: https://trader-proxy-36nj-iqdey5ovr-trader-rami-s-projects.vercel.app`
  );
  res.status(200).json({ ok: true });
}
