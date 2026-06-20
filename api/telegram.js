// 🦅 RamiFalconX — Vercel Serverless Function v2

const TG_TOKEN   = '8975284766:AAFFQWCyE7X8rqG3iU6h-PNy_n95iEmRX-U';
const TG_CHAT_ID = '6195578236';
const FMP_KEY    = '9FDbZgjuTfNCiuOoTlUR4jweViwYAZiG';
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

// ✅ مطلوب لـ Vercel
export const config = { api: { bodyParser: true } };

async function tgSend(text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch(e) { console.error('tgSend error:', e.message); }
}

function calcEMA(arr, p) {
  if(!arr || arr.length < p) return null;
  const k = 2/(p+1);
  let ema = arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<arr.length;i++) ema = arr[i]*k+ema*(1-k);
  return ema;
}

function calcRSI(closes) {
  if(!closes||closes.length<15) return null;
  const diffs = closes.slice(-15).map((c,i,a)=>i>0?c-a[i-1]:0).slice(1);
  const ag = diffs.map(d=>d>0?d:0).reduce((a,b)=>a+b,0)/14;
  const al = diffs.map(d=>d<0?-d:0).reduce((a,b)=>a+b,0)/14;
  return al===0?100:100-(100/(1+ag/al));
}

function calcHist(closes) {
  if(!closes||closes.length<35) return null;
  const e12=calcEMA(closes,12), e26=calcEMA(closes,26);
  if(!e12||!e26) return null;
  const macd=e12-e26;
  const arr=[];
  for(let j=35;j<=closes.length;j++){
    const sl=closes.slice(0,j);
    const a=calcEMA(sl,12),b=calcEMA(sl,26);
    if(a&&b) arr.push(a-b);
  }
  const sig=calcEMA(arr,9);
  return sig?macd-sig:null;
}

async function getStock(sym) {
  try {
    const [q,h] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/quote/${sym}?apikey=${FMP_KEY}`).then(r=>r.json()),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`).then(r=>r.json()),
    ]);
    const quote = Array.isArray(q)?q[0]:null;
    const closes = (h?.historical||[]).map(d=>d.close).reverse();
    return { quote, closes };
  } catch(e) { return null; }
}

// session بسيطة
const sess = {};

export default async function handler(req, res) {
  // ✅ السماح لجميع الطلبات
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST');

  if(req.method === 'GET') {
    res.status(200).json({ ok: true, bot: '🦅 RamiFalconX Active' });
    return;
  }

  if(req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const msg  = body?.message;
    if(!msg) { res.status(200).json({ ok: true }); return; }

    const text = msg.text?.trim() || '';
    const cid  = String(msg.chat?.id);

    if(cid !== TG_CHAT_ID) { res.status(200).json({ ok: true }); return; }

    const s   = sess[cid] || {};
    const low = text.toLowerCase();

    // /start
    if(text==='/start'||text==='مرحبا'||text==='هلا') {
      sess[cid]={};
      await tgSend('🦅 <b>RamiFalconX — مرحباً رامي!</b>\n──────────\nاكتب رمز السهم: <code>NVDA</code>\nمحفظتك: <code>محفظتي</code>\nتوصيات: <code>تقرير</code>\nإغلاق: <code>خرجت ALAB</code>');
      res.status(200).json({ ok: true }); return;
    }

    // خرجت
    if(low.startsWith('خرجت')||low.startsWith('بعت')) {
      const parts=text.split(/\s+/);
      const sym=parts[1]?.toUpperCase();
      const price=parseFloat(parts[2])||null;
      if(sym) {
        const d=await getStock(sym);
        const cur=price||(d?.quote?.price?.toFixed(2)||'—');
        await tgSend(`✅ <b>${sym} مغلقة بـ $${cur}</b>\nسجّل النتيجة في الأداة 📊`);
      }
      sess[cid]={};
      res.status(200).json({ ok: true }); return;
    }

    // تقرير
    if(text==='تقرير'||text==='توصيات') {
      await tgSend('📊 <b>التوصيات</b>\nافتح الأداة للتفاصيل:\nhttps://trader-proxy-36nj-iqdey5ovr-trader-rami-s-projects.vercel.app');
      res.status(200).json({ ok: true }); return;
    }

    // خطوات تسجيل صفقة
    if(s.step==='ask_bought') {
      if(text==='1'||text==='نعم') {
        sess[cid]={...s,step:'ask_price'};
        await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);
      } else {
        sess[cid]={};
        await tgSend(`✅ <b>${s.sym}</b> للمراقبة فقط`);
      }
      res.status(200).json({ ok: true }); return;
    }

    if(s.step==='ask_price') {
      const entry=parseFloat(text)===0?s.price:(parseFloat(text)||s.price);
      sess[cid]={...s,step:'ask_qty',entry};
      await tgSend(`كم سهم اشتريت من <b>${s.sym}</b>؟`);
      res.status(200).json({ ok: true }); return;
    }

    if(s.step==='ask_qty') {
      const qty=parseInt(text)||1;
      const atr=s.atr||3;
      const stop=(s.entry*(1-atr*2/100)).toFixed(2);
      const target=(s.entry*(1+atr*3.5/100)).toFixed(2);
      const pct=((parseFloat(target)-s.entry)/s.entry*100).toFixed(1);
      const days=Math.ceil(parseFloat(pct)/atr);
      sess[cid]={};
      await tgSend(
        `✅ <b>تم تسجيل ${s.sym}</b>\n──────────\n`+
        `دخول: <b>$${s.entry?.toFixed(2)}</b> × ${qty} سهم\n`+
        `رأس المال: <b>$${(s.entry*qty).toFixed(0)}</b>\n──────────\n`+
        `🛑 وقف: <b>$${stop}</b>\n`+
        `🎯 هدف: <b>$${target}</b> (+${pct}%)\n`+
        `⏱️ مدة: ${days<=1?'🔥 يومي':days<=3?`⚡ ${days} أيام`:`📅 ${days} أيام`}\n──────────\n`+
        `👀 سأراقبه وأنبهك`
      );
      res.status(200).json({ ok: true }); return;
    }

    // استعلام سهم
    const sym=text.toUpperCase().replace(/[^A-Z]/g,'');
    if(sym.length>=2&&sym.length<=5) {
      await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
      const d=await getStock(sym);
      if(!d?.quote) {
        await tgSend(`⚠️ ${sym} — لم أجد بيانات`);
        res.status(200).json({ ok: true }); return;
      }
      const q=d.quote;
      const rsi=calcRSI(d.closes);
      const hist=calcHist(d.closes);
      const chg=q.changesPercentage||0;
      let m=`📊 <b>${q.name||sym} (${sym})</b>\n`;
      m+=`💰 $${q.price?.toFixed(2)} ${chg>=0?'📈':'📉'} ${chg>=0?'+':''}${chg?.toFixed(2)}%\n──────────\n`;
      if(rsi!=null) m+=`RSI: ${rsi<35?'✅':rsi>70?'❌':'⚠️'} ${rsi?.toFixed(1)}${rsi<35?' — تشبع بيع':rsi>70?' — تشبع شراء':' — محايد'}\n`;
      if(hist!=null) m+=`MACD: ${hist>0?'✅':'❌'} ${hist>0?'+':''}${hist?.toFixed(2)}${hist>0?' — زخم صاعد':' — زخم هابط'}\n`;
      m+=`──────────\nهل اشتريت ${sym}؟\n1️⃣ نعم\n2️⃣ لا`;
      sess[cid]={step:'ask_bought',sym,price:q.price,atr:Math.max(2,(q.beta||1.5)*1.5)};
      await tgSend(m);
      res.status(200).json({ ok: true }); return;
    }

    // مساعدة
    await tgSend('🦅 اكتب رمز السهم مثل: <code>NVDA</code>');
    res.status(200).json({ ok: true });

  } catch(e) {
    console.error('Handler error:', e.message);
    res.status(200).json({ ok: true }); // دائماً 200 لـ Telegram
  }
}
