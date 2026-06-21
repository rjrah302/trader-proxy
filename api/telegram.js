const {initializeApp,cert,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
let db;
function getDB(){
  if(!db){
    if(!getApps().length){
      const sa=JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT,'base64').toString('utf8'));
      initializeApp({credential:cert(sa)});
    }
    db=getFirestore();
  }
  return db;
}
const TG_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID=process.env.TG_CHAT_ID||'6195578236';
const FMP_KEY=process.env.FMP_API_KEY;
const TG_API=`https://api.telegram.org/bot${TG_TOKEN}`;
async function tgSend(text){try{await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT_ID,text,parse_mode:'HTML'})});}catch(e){console.error('tgSend:',e.message);}}
async function fbGet(doc){try{const s=await getDB().collection('bot').doc(doc).get();return s.exists?s.data():{};}catch(e){console.error('fbGet:',e.message);return{};}}
async function fbSet(doc,data){try{await getDB().collection('bot').doc(doc).set(data,{merge:true});}catch(e){console.error('fbSet:',e.message);}}
function calcEMA(arr,p){if(!arr||arr.length<p)return null;const k=2/(p+1);let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<arr.length;i++)ema=arr[i]*k+ema*(1-k);return ema;}
function calcRSI(c){if(!c||c.length<15)return null;const d=c.slice(-15).map((v,i,a)=>i>0?v-a[i-1]:0).slice(1);const ag=d.map(x=>x>0?x:0).reduce((a,b)=>a+b,0)/14;const al=d.map(x=>x<0?-x:0).reduce((a,b)=>a+b,0)/14;return al===0?100:100-(100/(1+ag/al));}
function calcMACDHist(c){if(!c||c.length<35)return{hist:null,dir:null};const e12=calcEMA(c,12),e26=calcEMA(c,26);if(!e12||!e26)return{hist:null,dir:null};const arr=[];for(let j=26;j<=c.length;j++){const sl=c.slice(0,j);const a=calcEMA(sl,12),b=calcEMA(sl,26);if(a&&b)arr.push(a-b);}const sig=calcEMA(arr,9);if(!sig)return{hist:null,dir:null};const hist=(e12-e26)-sig;const prevArr=arr.slice(0,-1);const prevSig=calcEMA(prevArr,9);const prevHist=prevArr.length?prevArr[prevArr.length-1]-prevSig:null;const dir=prevHist!=null?(Math.abs(hist)>Math.abs(prevHist)?'expanding':'contracting'):null;return{hist,dir};}
function calcWeeklyTrend(c){if(!c||c.length<10)return null;const weeks=[];for(let i=0;i<c.length;i+=5){const w=c.slice(i,i+5);if(w.length>0)weeks.push(w[w.length-1]);}if(weeks.length<3)return null;return weeks[weeks.length-1]>weeks[weeks.length-2]?'bullish':'bearish';}
function calcCandles(c){if(!c||c.length<5)return{green:0,red:0};const last=c.slice(-5);let green=0,red=0;for(let i=1;i<last.length;i++){if(last[i]>last[i-1])green++;else red++;}return{green,red};}
function getSignal(rsi,hist,dir,weekly,candles){const signals=[];const risks=[];if(hist>0&&dir==='expanding')signals.push('زخم MACD صاعد قوي');else if(hist>0&&dir==='contracting')signals.push('زخم MACD صاعد يضعف');else if(hist<0&&dir==='expanding')risks.push('زخم MACD هابط يتسع');else if(hist<0)risks.push('زخم MACD هابط');if(rsi<35)signals.push('RSI تشبع بيع — فرصة');else if(rsi>70)risks.push('RSI تشبع شراء — خطر');else if(rsi>=40&&rsi<=60)signals.push('RSI محايد آمن');if(weekly==='bullish')signals.push('أسبوعي صاعد');else risks.push('أسبوعي هابط');if(candles.green>=3)signals.push(`${candles.green} شموع خضراء`);else if(candles.red>=3)risks.push(`${candles.red} شموع حمراء`);const score=signals.length-risks.length;let verdict,icon;if(score>=3){verdict='إشارة شراء قوية';icon='✅';}else if(score>=1){verdict='إيجابي — يمكن الدخول بحذر';icon='⚠️';}else if(score===0){verdict='إشارات متضاربة — انتظر';icon='⏳';}else{verdict='سلبي — تجنب الدخول';icon='❌';}return{signals,risks,verdict,icon};}
function getWatchAdvice(rsi,hist,weekly){const tips=[];if(rsi>60)tips.push('انتظر RSI يهبط دون 50');if(rsi<40)tips.push('RSI منخفض — فرصة قريبة');if(hist<0)tips.push('انتظر MACD يتحول إيجابياً');if(weekly==='bearish')tips.push('الأسبوعي هابط — تحلى بالصبر');if(tips.length===0)tips.push('راقب كسر المقاومة كإشارة دخول');return tips;}
async function getStock(sym){try{const [q,h]=await Promise.all([fetch(`https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`).then(r=>r.json()),fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`).then(r=>r.json())]);const closes=Array.isArray(h)?h.map(d=>d.close).reverse():[];return{quote:Array.isArray(q)?q[0]:null,closes};}catch(e){return null;}}
const sess={};
module.exports=async function handler(req,res){
res.setHeader('Access-Control-Allow-Origin','*');
if(req.method==='GET'){res.status(200).json({ok:true,bot:'RamiMarketX Active'});return;}
if(req.method!=='POST'){res.status(200).json({ok:true});return;}
try{
const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
const msg=body?.message;
if(!msg){res.status(200).json({ok:true});return;}
const text=msg.text?.trim()||'';
const cid=String(msg.chat?.id);
if(cid!==TG_CHAT_ID){res.status(200).json({ok:true});return;}
const s=sess[cid]||{};
const low=text.toLowerCase();
if(text==='/start'||text==='مرحبا'||text==='هلا'){sess[cid]={};await tgSend('🦅 <b>RamiMarketX — مرحباً رامي!</b>\n──────────────\nاكتب رمز السهم: <code>NVDA</code>\nمحفظتك: <code>محفظتي</code>\nمراقبتي: <code>مراقبتي</code>\nإغلاق: <code>خرجت ALAB</code>');res.status(200).json({ok:true});return;}
if(text==='محفظتي'){
const data=await fbGet('portfolio');
const port=(data.trades||[]).filter(t=>!t.closed);
if(port.length===0){await tgSend('📂 محفظتك فارغة');res.status(200).json({ok:true});return;}
let m='💼 <b>محفظتك:</b>\n──────────────\n';
for(const t of port){const d=await getStock(t.symbol);const cur=d?.quote?.price||t.entry;const pnl=((cur-t.entry)/t.entry*100).toFixed(2);m+=`${pnl>0?'✅':'❌'} <b>${t.symbol}</b> دخول $${t.entry} → $${cur?.toFixed(2)} (${pnl>0?'+':''}${pnl}%)\n`;}
await tgSend(m);res.status(200).json({ok:true});return;}
if(text==='مراقبتي'){
const data=await fbGet('watchlist');
const list=data.symbols||[];
if(list.length===0){await tgSend('👁 قائمة المراقبة فارغة');res.status(200).json({ok:true});return;}
await tgSend(`👁 <b>قائمة المراقبة:</b>\n──────────────\n${list.map(s=>`• ${s}`).join('\n')}`);
res.status(200).json({ok:true});return;}
if(low.startsWith('خرجت')||low.startsWith('بعت')){const parts=text.split(/\s+/);const sym=parts[1]?.toUpperCase();if(sym){const data=await fbGet('portfolio');const port=data.trades||[];const t=port.find(x=>x.symbol===sym&&!x.closed);if(t){const d=await getStock(sym);const cur=parseFloat(parts[2])||d?.quote?.price||t.target;const pnl=((cur-t.entry)/t.entry*100).toFixed(2);t.closed=true;t.closePrice=cur;t.closeDate=new Date().toISOString();await fbSet('portfolio',{trades:port});await tgSend(`✅ <b>${sym} مغلقة</b>\nدخول: $${t.entry} → خروج: $${cur}\n${pnl>0?'ربح +':'خسارة '}${pnl}%`);}else{await tgSend(`⚠️ ${sym} غير موجود في محفظتك`);}}sess[cid]={};res.status(200).json({ok:true});return;}
if(s.step==='ask_bought'){
if(text==='1'||text==='نعم'){sess[cid]={...s,step:'ask_price'};await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);}
else{
const data=await fbGet('watchlist');
const list=data.symbols||[];
if(!list.includes(s.sym)){list.push(s.sym);await fbSet('watchlist',{symbols:list});}
const tips=getWatchAdvice(s.rsi,s.hist,s.weekly);
let m=`👁 <b>${s.sym} أضيف للمراقبة</b>\n──────────────\n`;
tips.forEach(t=>{m+=`• ${t}\n`;});
m+=`──────────────\n⏰ اكتب <code>مراقبتي</code> لرؤية قائمتك`;
await tgSend(m);sess[cid]={};}
res.status(200).json({ok:true});return;}
if(s.step==='ask_price'){const entry=parseFloat(text)===0?s.price:(parseFloat(text)||s.price);sess[cid]={...s,step:'ask_qty',entry};await tgSend(`كم سهم اشتريت من <b>${s.sym}</b>؟`);res.status(200).json({ok:true});return;}
if(s.step==='ask_qty'){const qty=parseInt(text)||1;const atr=s.atr||3;const stop=parseFloat((s.entry*(1-atr*2/100)).toFixed(2));const target=parseFloat((s.entry*(1+atr*3.5/100)).toFixed(2));const pct=((target-s.entry)/s.entry*100).toFixed(1);const days=Math.ceil(parseFloat(pct)/atr);const data=await fbGet('portfolio');const port=data.trades||[];port.push({symbol:s.sym,entry:s.entry,qty,stop,target,date:new Date().toISOString(),closed:false});await fbSet('portfolio',{trades:port});sess[cid]={};await tgSend(`✅ <b>تم تسجيل ${s.sym}</b>\n──────────────\nدخول: <b>$${s.entry?.toFixed(2)}</b> × ${qty} سهم\nرأس المال: <b>$${(s.entry*qty).toFixed(0)}</b>\n──────────────\n🛑 وقف: <b>$${stop}</b> (-${(atr*2).toFixed(1)}%)\n🎯 هدف: <b>$${target}</b> (+${pct}%)\n⏱️ مدة: ${days<=1?'🔥 يومي':days<=3?`⚡ ${days} أيام`:`📅 ${days} أيام`}\n──────────────\n👀 سأراقبه وأنبهك`);res.status(200).json({ok:true});return;}
const sym=text.toUpperCase().replace(/[^A-Z]/g,'');
if(sym.length>=2&&sym.length<=5){
await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);
const d=await getStock(sym);
if(!d?.quote){await tgSend(`⚠️ ${sym} — لم أجد بيانات`);res.status(200).json({ok:true});return;}
const q=d.quote;
const rsi=calcRSI(d.closes);
const{hist,dir}=calcMACDHist(d.closes);
const weekly=calcWeeklyTrend(d.closes);
const candles=calcCandles(d.closes);
const sig=getSignal(rsi,hist,dir,weekly,candles);
const chg=q.changePercentage||0;
let m=`📊 <b>${q.name||sym} (${sym})</b>\n💰 <b>$${q.price?.toFixed(2)}</b> ${chg>=0?'📈':'📉'} ${chg>=0?'+':''}${chg?.toFixed(2)}%\n──────────────\n`;
if(hist!=null)m+=`MACD: ${hist>0?'✅':'❌'} ${hist>0?'+':''}${hist?.toFixed(2)} ${dir==='expanding'?'↑ يتوسع':'↓ يضيق'}\n`;
if(rsi!=null)m+=`RSI: ${rsi<35?'✅':rsi>70?'❌':'⚠️'} ${rsi?.toFixed(1)}${rsi<35?' — تشبع بيع':rsi>70?' — تشبع شراء':' — محايد'}\n`;
if(weekly)m+=`أسبوعي: ${weekly==='bullish'?'✅ صاعد':'❌ هابط'}\n`;
m+=`شموع: 🕯 ${candles.green>candles.red?candles.green+' خضراء':candles.red+' حمراء'} من آخر 5\n`;
m+=`──────────────\n🤖 <b>التحليل:</b>\n`;
sig.signals.forEach(s=>{m+=`✅ ${s}\n`;});
sig.risks.forEach(r=>{m+=`❌ ${r}\n`;});
m+=`──────────────\n${sig.icon} ${sig.verdict}\n──────────────\nهل اشتريت ${sym}؟\n1️⃣ نعم — سجّل الصفقة\n2️⃣ لا — أضفه للمراقبة`;
sess[cid]={step:'ask_bought',sym,price:q.price,atr:Math.max(2,(q.beta||1.5)*1.5),rsi,hist,weekly};
await tgSend(m);res.status(200).json({ok:true});return;}
await tgSend('🦅 اكتب رمز السهم مثل: <code>NVDA</code>');
res.status(200).json({ok:true});
}catch(e){console.error('Error:',e.message);res.status(200).json({ok:true});}
};
