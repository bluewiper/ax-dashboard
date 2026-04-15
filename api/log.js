const https = require('https');

const OWNER  = 'bluewiper';
const REPO   = 'ax-dashboard';
const FILE   = 'data/logs.json';

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${path}`,
      method,
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'User-Agent': 'ax-dashboard',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' });
  }

  // ── GET: 전체 로그 반환 ──────────────────────────────
  if (req.method === 'GET') {
    const { status, body } = await githubRequest('GET', FILE);
    if (status !== 200) return res.status(500).json({ error: '로그 파일을 불러올 수 없습니다.' });
    const logs = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8'));
    return res.status(200).json(logs);
  }

  // ── POST: 새 로그 추가 ───────────────────────────────
  if (req.method === 'POST') {
    const { date, skill, memo, source } = req.body || {};
    if (!date || !skill) return res.status(400).json({ error: 'date, skill 필수' });

    // 현재 파일 읽기
    const { status, body: fileData } = await githubRequest('GET', FILE);
    if (status !== 200) return res.status(500).json({ error: '파일 읽기 실패' });

    const sha  = fileData.sha;
    const logs = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));

    // 새 항목 추가
    const entry = { date, skill, memo: memo || '', source: source || 'manual', at: new Date().toISOString() };
    logs.push(entry);

    // GitHub에 커밋
    const newContent = Buffer.from(JSON.stringify(logs, null, 2) + '\n').toString('base64');
    const { status: putStatus } = await githubRequest('PUT', FILE, {
      message: `log: ${skill} (${date})`,
      content: newContent,
      sha,
    });

    if (putStatus !== 200 && putStatus !== 201) {
      return res.status(500).json({ error: '저장 실패' });
    }

    return res.status(200).json({ success: true, entry, total: logs.length });
  }

  return res.status(405).end();
};
