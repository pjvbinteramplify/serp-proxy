export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const prompt = `Experto SEO. Analiza estos resultados.
gl=es, hl=es
Keyword: "casinos online"

1. title: "Mejores Casinos Online" | url: https://casino.org/es/ | snippet: "Top casinos"

JSON exacto:
{
  "keyword": "keyword",
  "dominant_intent": "informational|transactional|commercial|navigational",
  "intent_distribution": {"informational":0,"transactional":0,"commercial":0,"navigational":0},
  "summary": "2 frases",
  "pain_point": "necesidad",
  "url_profile": "clusters",
  "fit_signal": null,
  "results": [{"position":1,"url":"url","title":"title","cluster":"home","intent":"commercial","intent_detail":"detalle"}]
}
intent_distribution suma 10. 1 resultado.`;

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: 'application/json' }
        })
      }
    );

    const status = geminiResp.status;
    const geminiData = await geminiResp.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({
      gemini_status: status,
      gemini_error: geminiData.error || null,
      raw_text: raw.slice(0, 800),
      parse_attempt: (() => { try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) { return 'PARSE ERROR: ' + e.message; } })()
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
