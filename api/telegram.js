// 🦅 RamiMarketX — Vercel Serverless Function (CommonJS)

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6195578236';
const FMP_KEY    = process.env.FMP_API_KEY;
const TG_API     = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch(e) { console.error('tgSend:', e.message); }
}

function calcEMA(arr, p) {
  if(!arr||arr.length<p) return null;
  const k=2/(p+1);
  let ema=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<arr.length;i++) ema=arr[i]*k+ema*(1-k);
  return ema;
}

function calcRSI(c) {
  if(!c||c.length<15) return null;
  const d=c.slice(-15).map((v,i,a)=>i>0?v-a[i-1]:0).slice(1);
  const ag=d.map(x=>x>0?x:0).reduce((a,b)=>a+b,0)/14;
  const al=d.map(x=>x<0?-x:0).reduce((a,b)=>a+b,0)/14;
  return al===0?100:100-(100/(1+ag/al));
}

function calcHist(c) {
  if(!c||c.length<35) return null;
  const e12=calcEMA(c,12),e26=calcEMA(c,26);
