module.exports = async function handler(req, res) {
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://trader-proxy-36nj.vercel.app';
    const r = await fetch(`${base}/api/telegram?action=monitor`);
    const d = await r.json();
    res.status(200).json({ ok: true, result: d });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
};
