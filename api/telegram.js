const TG_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID=process.env.TG_CHAT_ID||'6195578236';
const FMP_KEY=process.env.FMP_API_KEY;
const TG_API=`https://api.telegram.org/bot${TG_TOKEN}`;
async function tgSend(text){try{await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT_ID,text,parse_mode:'HTML'})});}catch(e){console.error('tgSend:',e.message);}}
function calcEMA(arr,p){if(!arr||arr.length<p)return null;const k=2/(p+1);let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<arr.length;i++)ema=arr[i]*k+ema*(1-k);return ema;}
function calcRSI(c){if(!c||c.length<15)return null;const d=c.slice(-15).map((v,i,a)=>i>0?v-a[i-1]:0).slice(1);const ag=d.map(x=>x>0?x:0).reduce((a,b)=>a+b,0)/14;const al=d.map(x=>x<0?-x:0).reduce((a,b)=>a+b,0)/14;return al===0?100:100-(100/(1+ag/al));}
function calcMACDHist(c){if(!c||c.length<35)return{hist:null,dir:null};const e12=calcEMA(c,12),e26=calcEMA(c,26);if(!e12||!e26)return{hist:null,dir:null};const arr=[];for(let j=26;j<=c.length;j++){const sl=c.slice(0,j);const a=calcEMA(sl,12),b=calcEMA(sl,26);if(a&&b)arr.push(a-b);}const sig=calcEMA(arr,9);if(!sig)return{hist:null,dir:null};const hist=(e12-e26)-sig;const prevArr=arr.slice(0,-1);const prevSig=calcEMA(prevArr,9);const prevHist=prevArr.length?prevArr[prevArr.length-1]-prevSig:null;const dir=prevHist!=null?(Math.abs(hist)>Math.abs(prevHist)?'expanding':'contracting'):null;return{hist,dir};}
function calcWeeklyTrend(dailyCloses){if(!dailyCloses||dailyCloses.length<10)return null;const weeks=[];for(let i=0;i<dailyCloses.length;i+=5){const w=dailyCloses.slice(i,i+5);if(w.length>0)weeks.push(w[w.length-1]);}if(weeks.length<3)return null;const last=weeks[weeks.length-1],prev=weeks[weeks.length-2];return last>prev?'bullish':'bearish';}
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
if(text==='/start'||text==='مرحبا'||text==='هلا'){sess[cid]={};await tgSend('🦅 <b>RamiMarketX — مرحباً رامي!</b>\n──────────────\nاكتب رمز السهم: <code>NVDA</code>\nمحفظتك: <code>محفظتي</code>\nتقرير: <code>تقرير</code>\nإغلاق: <code>خرجت ALAB</code>');res.status(200).json({ok:true});return;}
if(low.startsWith('خرجت')||low.startsWith('بعت')){const parts=text.split(/\s+/);const sym=parts[1]?.toUpperCase();const price=parseFloat(parts[2])||null;if(sym){const d=await getStock(sym);const cur=price||(d?.quote?.price?.toFixed(2)||'—');await tgSend(`✅ <b>${sym} مغلقة بـ $${cur}</b>\nسجّل النتيجة في الأداة 📊`);}sess[cid]={};res.status(200).json({ok:true});return;}
if(text==='تقرير'||text==='اليوم'){await tgSend('📊 افتح الأداة:\nhttps://trader-proxy-36nj.vercel.app');res.status(200).json({ok:true});return;}
if(s.step==='ask_bought'){if(text==='1'||text==='نعم'){sess[cid]={...s,step:'ask_price'};await tgSend(`بكم اشتريت <b>${s.sym}</b>؟\n(اكتب 0 للسعر الحالي $${s.price?.toFixed(2)})`);}else{sess[cid]={};await tgSend(`✅ <b>${s.sym}</b> للمراقبة فقط`);}res.status(200).json({ok:true});return;}
if(s.step==='ask_price'){const entry=parseFloat(text)===0?s.price:(parseFloat(text)||s.price);sess[cid]={...s,step:'ask_qty',entry};await tgSend(`كم سهم اشتريت من <b>${s.sym}</b>؟`);res.status(200).json({ok:true});return;}
if(s.step==='ask_qty'){const qty=parseInt(text)||1;const atr=s.atr||3;const stop=(s.entry*(1-atr*2/100)).toFixed(2);const target=(s.entry*(1+atr*3.5/100)).toFixed(2);const pct=((parseFloat(target)-s.entry)/s.entry*100).toFixed(1);const days=Math.ceil(parseFloat(pct)/atr);sess[cid]={};await tgSend(`✅ <b>تم تسجيل ${s.sym}</b>\n──────────────\nدخول: <b>$${s.entry?.toFixed(2)}</b> × ${qty} سهم\nرأس المال: <b>$${(s.entry*qty).toFixed(0)}</b>\n──────────────\n🛑 وقف: <b>$${stop}</b> (-${(atr*2).toFixed(1)}%)\n🎯 هدف: <b>$${target}</b> (+${pct}%)\n⏱️ مدة: ${days<=1?'🔥 يومي':days<=3?`⚡ ${days} أيام`:`📅 ${days} أيام`}\n──────────────\n👀 سأراقبه وأنبهك`);res.status(200).json({ok:true});return;}
const sym=text.toUpperCase().replace(/[^A-Z]/g,'');
if(sym.length>=2&&sym.length<=5){await tgSend(`⏳ جاري تحليل <b>${sym}</b>...`);const d=await getStock(sym);if(!d?.quote){await tgSend(`⚠️ ${sym} — لم أجد بيانات`);res.status(200).json({ok:true});return;}const q=d.quote;const rsi=calcRSI(d.closes);const{hist,dir}=calcMACDHist(d.closes);const weekly=calcWeeklyTrend(d.closes);const chg=q.changePercentage||0;let m=`📊 <b>${q.name||sym} (${sym})</b>\n💰 <b>$${q.price?.toFixed(2)}</b> ${chg>=0?'📈':'📉'} ${chg>=0?'+':''}${chg?.toFixed(2)}%\n──────────────\n`;if(hist!=null)m+=`MACD: ${hist>0?'✅':'❌'} ${hist>0?'+':''}${hist?.toFixed(2)} ${dir==='expanding'?'↑ يتوسع':'↓ يضيق'}\n`;if(rsi!=null)m+=`RSI: ${rsi<35?'✅':rsi>70?'❌':'⚠️'} ${rsi?.toFixed(1)}${rsi<35?' — تشبع بيع':rsi>70?' — تشبع شراء':' — محايد'}\n`;if(weekly)m+=`أسبوعي: ${weekly==='bullish'?'✅ صاعد':'❌ هابط'}\n`;m+=`──────────────\nهل اشتريت ${sym}؟\n1️⃣ نعم\n2️⃣ لا`;sess[cid]={step:'ask_bought',sym,price:q.price,atr:Math.max(2,(q.beta||1.5)*1.5)};await tgSend(m);res.status(200).json({ok:true});return;}
await tgSend('🦅 اكتب رمز السهم مثل: <code>NVDA</code>');
res.status(200).json({ok:true});
}catch(e){console.error('Error:',e.message);res.status(200).json({ok:true});}
};
