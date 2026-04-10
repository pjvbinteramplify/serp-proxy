const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash'
];

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  return clean;
}

async function callGemini(prompt, apiKey) {
  for (const model of MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        })
      }
    );
    const data = await resp.json();
    if (data.error?.code === 429 || data.error?.code === 503) continue;
    if (data.error) throw new Error(data.error.message);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return extractJSON(raw);
  }
  throw new Error('All models quota exceeded. Try again later.');
}

async function fetchPageMeta(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEO-Analyzer/1.0)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000)
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const title = (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)||[])[1]?.trim() || '';
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i)||
                  html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i)||[])[1]?.trim() || '';
    const h1 = (html.match(/<h1[^>]*>([^<]{1,150})<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim() || '';
    const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i)||
                     html.match(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:title["']/i)||[])[1]?.trim() || '';
    return { title, desc, h1, ogTitle };
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { url, gl, hl } = body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let parsedUrl = {};
  try {
    const u = new URL(url);
    parsedUrl = {
      domain: u.hostname.replace('www.', ''),
      segments: u.pathname.split('/').filter(s => s.length > 0)
    };
  } catch(e) {}

  const meta = await fetchPageMeta(url);

  const metaSection = meta
    ? `Metadatos reales de la página:
- Title: ${meta.title || '(vacío)'}
- OG Title: ${meta.ogTitle || '(vacío)'}
- Meta description: ${meta.desc || '(vacío)'}
- H1: ${meta.h1 || '(vacío)'}`
    : `Metadatos: no accesibles`;

  const prompt = `Eres un experto en SEO. Determina la keyword principal que esta URL debería rankear en Google.

URL: ${url}
Dominio: ${parsedUrl.domain || ''}
Segmentos del path: ${(parsedUrl.segments || []).join(' > ')}
Mercado: gl=${gl||'es'}, hl=${hl||'es'}

${metaSection}

INSTRUCCIONES:
- Usa los metadatos como fuente principal si están disponibles
- Combina dominio + path + metadatos para entender el contexto completo
- La keyword debe ser lo que un usuario real escribiría en Google para llegar a esta página
- Usa el idioma correcto para el mercado indicado
- Si es ecommerce o la intención lo sugiere, incluye modificador transaccional (kaufen, comprar, buy...)
- Si el title o H1 es muy corto o ambiguo (ej: solo "Large" o "Mini"), combínalo con el dominio y el path para construir una keyword con sentido completo — por ejemplo si el dominio es snushof.ch y el path es /snus/mini, la keyword debe incluir "snus mini" como mínimo

Responde SOLO con este JSON, sin texto antes ni después:
{
  "keyword": "keyword principal",
  "reasoning": "1 frase",
  "meta_used": true
}`;

  try {
    const clean = await callGemini(prompt, process.env.GEMINI_KEY);
    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(500).json({ error: 'JSON parse error: ' + e.message, raw: clean.slice(0, 200) });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
