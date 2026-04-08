const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= maxRequests) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });

  const { q, gl, hl, num } = req.body;
  if (!q || typeof q !== 'string' || q.length > 200) return res.status(400).json({ error: 'Invalid query' });

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_KEY },
    body: JSON.stringify({ q: q.slice(0, 200), gl: gl||'es', hl: hl||'es', num: Math.min(num||10, 10) })
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
