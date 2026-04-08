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

Devuelve un objeto JSON con esta estructura exacta:
{
  "keyword": "keyword analizada",
  "dominant_intent": "informational",
  "intent_distribution": {"informational":0,"transactional":0,"commercial":0,"navigational":0},
  "summary": "2-3 frases sobre el caracter de la SERP",
  "pain_point": "Punto de dolor principal del usuario al hacer esta busqueda",
  "results": [
    {
      "position": 1,
      "url": "url exacta",
      "title": "title exacto",
      "cluster": "home|categoria|ficha-producto|articulo-blog|comparativa|guia|herramienta|directorio|review|landing|foro|wiki|video|news",
      "intent": "informational|transactional|commercial|navigational",
      "intent_detail": "que necesidad cubre esta URL para el usuario"
    }
  ]
}

intent_distribution debe sumar exactamente 10. Devuelve los ${results.length} resultados en orden.`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const geminiData = await geminiResp.json();
    console.log('GEMINI_STATUS:', geminiResp.status);
    console.log('GEMINI_RAW:', JSON.stringify(geminiData).slice(0, 500));

    if (geminiData.error) return res.status(500).json({ error: geminiData.error.message });

    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('GEMINI_TEXT:', raw.slice(0, 300));

    const clean = raw.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch(e) {
      console.log('PARSE_ERROR:', e.message, 'RAW:', clean.slice(0, 200));
      return res.status(500).json({ error: 'JSON parse error: ' + e.message, raw: clean.slice(0, 400) });
    }

  } catch(e) {
    console.log('FETCH_ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
