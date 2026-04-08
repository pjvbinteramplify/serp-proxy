const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 15;
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

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const { results, keyword, gl, hl, vertical, userUrl } = body || {};
  if (!results || !Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'Missing results array' });
  }

  const lines = results.map((r, i) =>
    `${i+1}. title: "${String(r.title||'').slice(0,120)}" | url: ${String(r.link||'').slice(0,180)} | snippet: "${String(r.snippet||'').slice(0,100)}"`
  ).join('\n');

  const userUrlLine = userUrl ? `\nURL del usuario: ${userUrl}` : '';

  const prompt = `Experto SEO. Analiza estos resultados reales de Google.
gl=${gl||'es'}, hl=${hl||'es'}${vertical?', '+vertical:''}
Keyword: "${String(keyword||'').slice(0,100)}"${userUrlLine}

${lines}

JSON exacto (sin texto extra):
{
  "keyword": "keyword",
  "dominant_intent": "informational|transactional|commercial|navigational",
  "intent_distribution": {"informational":0,"transactional":0,"commercial":0,"navigational":0},
  "summary": "2 frases sobre el caracter de la SERP",
  "pain_point": "Necesidad principal del usuario",
  "url_profile": "Que clusters dominan. Ej: 6 fichas de producto, 3 comparativas, 1 home",
  "fit_signal": "Si hay URL de usuario: encaja o hay desajuste con el patron dominante. Si no hay URL: null",
  "results": [{"position":1,"url":"url","title":"title","cluster":"home|categoria|ficha-producto|articulo-blog|comparativa|guia|herramienta|directorio|review|landing|foro|wiki|video|news","intent":"informational|transactional|commercial|navigational","intent_detail":"necesidad que cubre"}]
}
intent_distribution suma 10. ${results.length} resultados en orden.`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8000,
            responseMimeType: 'application/json'
          },
          thinkingConfig: { thinkingBudget: 0 }
        })
      }
    );

    const geminiData = await geminiResp.json();
    if (geminiData.error) return res.status(500).json({ error: geminiData.error.message });

    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(500).json({ error: 'JSON parse error: ' + e.message, raw: clean.slice(0, 400) });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
