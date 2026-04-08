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

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const { results, keyword, gl, hl, vertical } = body || {};
  if (!results || !Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'Missing results array' });
  }

  const lines = results.map((r, i) =>
    `${i+1}. title: "${String(r.title||'').slice(0,150)}" | url: ${String(r.link||'').slice(0,200)} | snippet: "${String(r.snippet||'').slice(0,150)}"`
  ).join('\n');

  const prompt = `Eres un experto en SEO y search intent. Analiza estos resultados reales de Google.
Contexto: gl=${gl||'es'}, hl=${hl||'es'}${vertical ? ', vertical: '+vertical : ''}
Keyword: "${String(keyword||'').slice(0,100)}"

Resultados:
${lines}

Devuelve ÚNICAMENTE un objeto JSON válido, sin markdown, sin texto extra:
{
  "keyword": "keyword analizada",
  "dominant_intent": "informational|transactional|commercial|navigational",
  "intent_distribution": {"informational":0,"transactional":0,"commercial":0,"navigational":0},
  "summary": "2-3 frases sobre el carácter de la SERP y qué señala sobre la intención del usuario",
  "pain_point": "Descripción del punto de dolor o necesidad principal que el usuario tiene cuando hace esta búsqueda",
  "results": [
    {
      "position": 1,
      "url": "url exacta del resultado",
      "title": "title exacto del resultado",
      "cluster": "home|categoría|ficha-producto|artículo-blog|comparativa|guía|herramienta|directorio|review|landing|foro|wiki|vídeo|news",
      "intent": "informational|transactional|commercial|navigational",
      "intent_detail": "qué necesidad o punto de dolor cubre esta URL específica para el usuario"
    }
  ]
}

intent_distribution debe sumar exactamente 10. Devuelve los ${results.length} resultados en el mismo orden.`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
        })
      }
    );

    const geminiData = await geminiResp.json();

    if (geminiData.error) {
      return res.status(500).json({ error: geminiData.error.message });
    }

    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
