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

  const prompt = `Eres un experto en SEO. Dada esta URL, determina cuál es la keyword principal o grupo semántico principal que esta página debería estar rankeando en Google.

URL: ${url}
País/mercado: gl=${gl||'es'}, hl=${hl||'es'}

Responde SOLO con un objeto JSON:
{
  "keyword": "la keyword principal en el idioma correcto para ese mercado",
  "reasoning": "explicación breve de por qué esa keyword"
}

La keyword debe ser la que un usuario real escribiría en Google para encontrar esa página. Considera el dominio, la estructura de la URL, el mercado y el idioma. No uses el slug literal — interpreta la intención real.`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
        })
      }
    );

    const data = await geminiResp.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
