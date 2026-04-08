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
          generationConfig: { temperature: 0.1, maxOutputTokens: 200, responseMimeType: 'application/json' }
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { url, gl, hl } = body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const prompt = `Eres un experto en SEO. Dada esta URL determina la keyword principal que esta pagina deberia rankear en Google.

URL: ${url}
Mercado: gl=${gl||'es'}, hl=${hl||'es'}

Responde SOLO con JSON:
{
  "keyword": "keyword principal en el idioma correcto para ese mercado",
  "reasoning": "explicacion breve"
}

La keyword debe ser lo que un usuario real escribiria en Google para encontrar esa pagina. No uses el slug literal, interpreta la intencion real.`;

  try {
    const clean = await callGemini(prompt, process.env.GEMINI_KEY);
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
