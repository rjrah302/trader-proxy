const TG_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID=process.env.TG_CHAT_ID||'6195578236';
const FMP_KEY=process.env.FMP_API_KEY;
const TG_API=`https://api.telegram.org/bot${TG_TOKEN}`;
async function tgSend(text){try{await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT_ID,text,parse_mode:'HTML'})});}catch(e){console.error('tgSend:',e.message);}}
function calcEMA(arr,p){if(!arr||arr.length<p)return null;const k=2/(p+1);let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<arr.length;i++)ema=arr[i]*k+ema*(1-k);return ema;}
function calcRSI(c){if(!c||c.length<15)return null;const d=c.slice(-15).map((v,i,a)=>i>0?v-a[i-1]:0).slice(1);const ag=d.map(x=>x>0?x:0).reduce((a,b)=>a+b,0)/14;const al=d.map(x=>x<0?-x:0).reduce((a,b)=>a+b,0)/14;return al===0?100:100-(100/(1+ag/al));}
function calcHist(c){if(!c||c.length<35)return null;const e12=calcEMA(c,12),e26=calcEMA(c,26);if(!e12||!e26)return null;const arr=[];for(let j=35;j<=c.length;j++){const sl=c.slice(0,j);const a=calcEMA(sl,12),b=calcEMA(sl,26);if(a&&b)arr.push(a-b);}const sig=calcEMA(arr,9);return sig?(e12-e26)-sig:null;}
async function getStock(sym){try{const [q,h]=await Promise.all([fetch(`https://financialmodelingprep.com/api/v3/quote/${sym}?apikey=${FMP_KEY}`).then(r=>r.json()),fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&limit=60&apikey=${FMP_KEY}`).then(r=>r.json())]);return{quote:Array.isArray(q)?q[0]:null,closes:(h?.historical||[]).map(d=>d.close).reverse()};}catch(e){return null;}}
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
if(text==='/start'||text==='مرحبا'||text==='هلا'){sess[cid]={};await tgSend('RamiMarketX مرحبا رامي\nاكتب رمز السهم مثل NVDA');res.status(200).json({ok:true});return;}
if(low.startsWith('خرجت')||low.startsWith('بعت')){const parts=text.split(/\s+/);const sym=parts[1]?.toUpperCase();const price=parseFloat(parts[2])||null;if(sym){const d=await getStock(sym);const cur=price||(d?.quote?.price?.toFixed(2)||'—');await tgSend(`${sym} مغلقة بـ $${cur}`);}sess[cid]={};res.status(200).json({ok:true});return;}
if(text==='تقرير'||text==='توصيات'){await tgSend('افتح الاداة:\nhttps://trader-proxy-36nj.vercel.app');res.status(200).json({ok:true});return;}
if(s.step==='ask_bought'){if(text==='1'||text==='نعم'){sess[cid]={...s,step:'ask_price'};await tgSend(`بكم اشتريت ${s.sym}؟\n0 للسعر الحالي $${s.price?.toFixed(2)}`);}else{sess[cid]={};await tgSend(`${s.sym} للمراقبة فقط`);}res.status(200).json({ok:true});return;}
if(s.step==='ask_price'){const entry=parseFloat(text)===0?s.price:(parseFloat(text)||s.price);sess[cid]={...s,step:'ask_qty',entry};await tgSend(`كم سهم اشتريت من ${s.sym}؟`);res.status(200).json({ok:true});return;}
if(s.step==='ask_qty'){const qty=parseInt(text)||1;const atr=s.atr||3;const stop=(s.entry*(1-atr*2/100)).toFixed(2);const target=(s.entry*(1+atr*3.5/100)).toFixed(2);const pct=((parseFloat(target)-s.entry)/s.entry*100).toFixed(1);const days=Math.ceil(parseFloat(pct)/atr);sess[cid]={};await tgSend(`تم تسجيل ${s.sym}\nدخول: $${s.entry?.toFixed(2)} x ${qty}\nوقف: $${stop}\nهدف: $${target} +${pct}%`);res.status(200).json({ok:true});return;}
const sym=text.toUpperCase().replace(/[^A-Z]/g,'');
if(sym.length>=2&&sym.length<=5){await tgSend(`جاري تحليل ${sym}...`);const d=await getStock(sym);if(!d?.quote){await tgSend(`${sym} لم اجد بيانات`);res.status(200).json({ok:true});return;}const q=d.quote;const rsi=calcRSI(d.closes);const hist=calcHist(d.closes);const chg=q.changesPercentage||0;let m=`${q.name||sym} (${sym})\n$${q.price?.toFixed(2)} ${chg>=0?'+':''}${chg?.toFixed(2)}%\n`;if(rsi!=null)m+=`RSI: ${rsi?.toFixed(1)}${rsi<35?' تشبع بيع':rsi>70?' تشبع شراء':' محايد'}\n`;if(hist!=null)m+=`MACD: ${hist>0?'+':''}${hist?.toFixed(2)}${hist>0?' زخم صاعد':' زخم هابط'}\n`;m+=`هل اشتريت ${sym}؟\n1 نعم\n2 لا`;sess[cid]={step:'ask_bought',sym,price:q.price,atr:Math.max(2,(q.beta||1.5)*1.5)};await tgSend(m);res.status(200).json({ok:true});return;}
await tgSend('اكتب رمز السهم مثل NVDA');
res.status(200).json({ok:true});
}catch(e){console.error('Error:',e.message);res.status(200).json({ok:true});}
};
