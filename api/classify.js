const calls = new Map();
const LIMIT = 20;
const WINDOW = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = calls.get(ip) || { count: 0, reset: now + WINDOW };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + WINDOW; }
  entry.count++;
  calls.set(ip, entry);
  if (entry.count > LIMIT) {
    return res.status(429).json({ error: `Límite de ${LIMIT} análisis por hora superado. Inténtalo más tarde.` });
  }

  const { keyword, gl, hl, vertical, results } = req.body;
  if (!keyword || !results?.length) return res.status(400).json({ error: 'Faltan datos' });

  const lines = results.map((r, i) =>
    `${i+1}. title: "${r.title}" | url: ${r.link} | snippet: "${(r.snippet||'').slice(0, 150)}"`
  ).join('\n');

  const prompt = `Eres un experto en SEO y análisis de search intent. Analiza estos ${results.length} resultados reales de Google y devuelve ÚNICAMENTE un objeto JSON válido, sin markdown, sin texto extra.

Parámetros de búsqueda: gl=${gl}, hl=${hl}${vertical ? ', vertical: '+vertical : ''}
Keyword: "${keyword}"

Resultados:
${lines}

JSON requerido:
{
  "keyword": "keyword analizada",
  "dominant_intent": "informational|transactional|commercial|navigational",
  "intent_distribution": {
    "informational": número entero 0-10,
    "transactional": número entero 0-10,
    "commercial": número entero 0-10,
    "navigational": número entero 0-10
  },
  "summary": "2-3 frases sobre el carácter de esta SERP: qué tipo de contenido domina, qué formato premia Google y qué revela sobre la intención real del usuario",
  "pain_point": "Describe en 1-2 frases el punto de dolor principal que el usuario busca resolver con esta búsqueda. Sé específico y orientado al usuario, no al SEO.",
  "results": [
    {
      "position": 1,
      "url": "url completa",
      "title": "title del resultado",
      "cluster": "home|categoría|ficha-producto|artículo-blog|comparativa|guía|herramienta|directorio|review|landing|foro|wiki|vídeo|news",
      "intent": "informational|transactional|commercial|navigational",
      "intent_detail": "frase corta explicando la intención específica de esta URL",
      "pain_point": "qué punto de dolor concreto cubre esta URL específica"
    }
  ]
}

intent_distribution debe sumar exactamente 10.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
        })
      }
    );
    if (!resp.ok) throw new Error('Gemini HTTP ' + resp.status);
    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
