export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly this JSON and nothing else: {"status":"ok"}' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 50, responseMimeType: 'application/json' }
        })
      }
    );

    const status = geminiResp.status;
    const raw = await geminiResp.text();
    return res.status(200).json({ gemini_status: status, gemini_raw: raw.slice(0, 1000) });

  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
