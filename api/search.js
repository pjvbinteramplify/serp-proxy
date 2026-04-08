const calls = new Map();
const LIMIT = 50;
const WINDOW = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = calls.get(ip) || { count: 0, reset: now + WINDOW };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + WINDOW; }
  entry.count++;
  calls.set(ip, entry);
  if (entry.count > LIMIT) {
    return res.status(429).json({ error: `Límite de ${LIMIT} búsquedas por hora superado.` });
  }

  const { q, gl, hl, num } = req.body;
  if (!q) return res.status(400).json({ error: 'Falta el parámetro q' });

  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_KEY },
    body: JSON.stringify({ q, gl, hl, num: num || 10 })
  });

  const data = await resp.json();
  res.status(resp.status).json(data);
}
