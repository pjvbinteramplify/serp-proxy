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

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash'
];

async function callGemini(prompt, apiKey) {
  for (const model of MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: 'application/json' }
        })
      }
    );
    const data = await resp.json();
    if (data.error?.code === 429 || data.error?.code === 503) continue;
    if (data.error) throw new Error(data.error.message);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return raw.replace(/```json|```/g, '').trim();
  }
  throw new Error('All models quota exceeded. Try again later.');
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

  const userUrlLine = userUrl ? `\nURL del usuario a evaluar: ${userUrl}` : '';

  const prompt = `Eres un experto senior en SEO especializado en search intent y análisis de SERPs.

Analiza estos ${results.length} resultados reales de Google y devuelve un JSON estructurado.

Contexto: gl=${gl||'es'}, hl=${hl||'es'}${vertical ? ', vertical: '+vertical : ''}
Keyword: "${String(keyword||'').slice(0,100)}"${userUrlLine}

Resultados:
${lines}

INSTRUCCIONES DE CLASIFICACIÓN:

1. Para cada resultado clasifica THREE dimensiones de forma independiente:
   - hierarchy: nivel jerárquico de la página en el sitio → home | seccion | categoria | subcategoria | ficha | post | perfil
   - format: formato o naturaleza del contenido → landing | articulo | guia | comparativa | review | directorio | herramienta | foro | wiki | video | news | ecommerce
   - intent: intención de búsqueda que cubre → informational | commercial | transactional | navigational

2. Para dominant_intent y serp_type:
   - Si una intención supera el 60% de los resultados → esa es la dominante y serp_type = "focused"
   - Si dos intenciones están entre 30-60% cada una → serp_type = "mixed" con las dos intenciones indicadas
   - Si hay 3+ intenciones repartidas sin dominio claro → serp_type = "mixed"

3. Para url_profile describe por separado:
   - Qué jerarquías dominan (ej: "8 de 10 son páginas profundas: fichas y subcategorías")
   - Qué formatos dominan (ej: "predominan comparativas y directorios")
   - Si hay patrón claro o la SERP es heterogénea

4. Para fit_signal (solo si se proporciona URL del usuario):
   Evalúa el encaje en tres dimensiones:
   - Jerarquía: ¿El nivel de la URL del usuario (home/categoría/ficha/post) coincide con las que dominan?
   - Formato: ¿El tipo de contenido encaja con lo que Google premia?
   - Temática: ¿La URL parece cubrir la misma necesidad que los resultados dominantes?
   Concluye con una de estas etiquetas:
   - "ENCAJA" si las tres dimensiones son coherentes con la SERP
   - "DESAJUSTE JERARQUÍA" si el nivel de profundidad no coincide
   - "DESAJUSTE FORMATO" si el tipo de contenido no es el que Google premia
   - "DESAJUSTE TEMÁTICO" si la URL parece cubrir una necesidad diferente
   - "DESAJUSTE MÚLTIPLE" si hay más de un problema
   Seguido de una explicación concisa.
   Si la SERP es mixta y la URL encaja con alguna de las intenciones presentes, indícalo.
   Si no se proporciona URL escribe null.

Devuelve ÚNICAMENTE este JSON sin texto extra:
{
  "keyword": "keyword analizada",
  "dominant_intent": "informational|commercial|transactional|navigational|mixed",
  "serp_type": "focused|mixed",
  "secondary_intent": "segunda intención si serp_type es mixed, si no null",
  "intent_distribution": {"informational":0,"transactional":0,"commercial":0,"navigational":0},
  "summary": "2-3 frases sobre el carácter de esta SERP: qué necesidad cubre el usuario, qué patrón de resultados presenta Google y qué señala sobre la dificultad o naturaleza de rankear aquí",
  "pain_point": "Describe con precisión el problema o necesidad que tiene el usuario al hacer esta búsqueda. No uses lenguaje de marketing, sé concreto.",
  "url_profile": "Descripción del perfil de URLs: jerarquía dominante + formato dominante + heterogeneidad si la hay",
  "fit_signal": "Evaluación del encaje de la URL del usuario según las instrucciones, o null",
  "results": [
    {
      "position": 1,
      "url": "url exacta",
      "title": "title exacto",
      "hierarchy": "home|seccion|categoria|subcategoria|ficha|post|perfil",
      "format": "landing|articulo|guia|comparativa|review|directorio|herramienta|foro|wiki|video|news|ecommerce",
      "intent": "informational|commercial|transactional|navigational",
      "intent_detail": "En una frase: qué problema concreto del usuario resuelve esta URL y por qué Google la premia para esta query"
    }
  ]
}

intent_distribution debe sumar exactamente 10.`;

  try {
    const clean = await callGemini(prompt, process.env.GEMINI_KEY);
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
