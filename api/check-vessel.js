// Tavily Search API を叩いて船の動静情報を取得する Vercel Serverless Function
// POST /api/check-vessel  body: { vessel, voy, port, origin, source }
// Response: { query, answer, results: [{ title, url, content, score }] }

export default async function handler(req, res) {
  // CORS（同一オリジンで動くが念のため）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'TAVILY_API_KEY が Vercel 環境変数に設定されていません',
      hint: 'Vercelダッシュボード → Settings → Environment Variables で追加してください'
    });
    return;
  }

  const body = req.body || {};
  const vessel = (body.vessel || '').trim();
  const voy    = (body.voy    || '').trim();
  const port   = (body.port   || '').trim();
  const origin = (body.origin || '').trim();
  const source = (body.source || '').trim();

  if (!vessel && !voy && !port) {
    res.status(400).json({ error: '船名・VOY・揚げ地のいずれかを指定してください' });
    return;
  }

  // クエリ組み立て
  const parts = [];
  if (vessel) parts.push(`"${vessel}"`);
  if (voy)    parts.push(voy);
  if (port)   parts.push(port);
  if (origin) parts.push(origin);
  if (source) parts.push(source);
  parts.push('vessel schedule arrival ETA');
  const query = parts.join(' ');

  try {
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!tavilyRes.ok) {
      const text = await tavilyRes.text();
      res.status(tavilyRes.status).json({
        error: `Tavily API error (${tavilyRes.status})`,
        detail: text.slice(0, 500),
      });
      return;
    }

    const data = await tavilyRes.json();

    // 入港日らしき日付を簡易抽出（YYYY-MM-DD / M/D / Apr 13 等）
    const texts = (data.results || []).map(r => `${r.title || ''} ${r.content || ''}`).join(' ');
    const dateCandidates = [];
    const re1 = /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g;
    const re2 = /\b(\d{1,2}[-/]\d{1,2})\b/g;
    const re3 = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*\d{1,2}(,?\s*20\d{2})?\b/gi;
    let m;
    while ((m = re1.exec(texts)) && dateCandidates.length < 10) dateCandidates.push(m[1]);
    while ((m = re2.exec(texts)) && dateCandidates.length < 15) dateCandidates.push(m[1]);
    while ((m = re3.exec(texts)) && dateCandidates.length < 20) dateCandidates.push(m[0]);

    res.status(200).json({
      query,
      answer: data.answer || null,
      dateCandidates: [...new Set(dateCandidates)].slice(0, 10),
      results: (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: (r.content || '').slice(0, 600),
        score: r.score || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
