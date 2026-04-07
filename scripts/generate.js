const https = require('https');
const http = require('http');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
const notionToken = process.env.NOTION_TOKEN;
const notionDbId = process.env.NOTION_DB_ID;

const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today = now.getFullYear() + '\u5e74' +
  String(now.getMonth() + 1).padStart(2, '0') + '\u6708' +
  String(now.getDate()).padStart(2, '0') + '\u65e5';

console.log('Generating news for:', today);

// ── カテゴリと RSS 設定 ──────────────────────────────────────
const categories = [
  {
    id: 'tech',
    name: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc',
    nameZh: '\u79d1\u6280',
    rss: ['https://www3.nhk.or.jp/rss/news/cat3.xml'],
    keywords: [],
    source: 'NHK'
  },
  {
    id: 'urban',
    name: '\u90fd\u5e02\u518d\u958b\u767a',
    nameZh: '\u90fd\u5e02\u518d\u958b\u767a',
    rss: [
      'https://www.ur-net.go.jp/news/ur_release.xml',
      'https://suumo.jp/journal/feed/'
    ],
    keywords: ['\u518d\u958b\u767a', '\u307e\u3061\u3065\u304f\u308a', '\u5e02\u8857\u5730', '\u90fd\u5e02\u518d\u751f', '\u56e3\u5730', '\u5efa\u66ff', '\u6574\u5099', '\u5730\u533a\u6d3b\u6027\u5316', '\u8857\u3065\u304f\u308a', '\u5efa\u8a2d', '\u9053\u8def', '\u99c5\u524d', '\u30bf\u30ef\u30fc', '\u8907\u5408\u65bd\u8a2d'],
    source: 'UR\u90fd\u5e02\u6a5f\u69cb / SUUMO'
  },
  {
    id: 'realestate',
    name: '\u4e0d\u52d5\u7523\u5e02\u5834',
    nameZh: '\u4e0d\u52d5\u7522\u5e02\u5834',
    rss: ['https://suumo.jp/journal/feed/'],
    keywords: [],
    source: 'SUUMO\u30b8\u30e3\u30fc\u30ca\u30eb'
  },
  {
    id: 'economy',
    name: '\u7d4c\u6e08',
    nameZh: '\u7d93\u6fdf',
    rss: ['https://www3.nhk.or.jp/rss/news/cat5.xml'],
    keywords: [],
    source: 'NHK'
  },
  {
    id: 'agri',
    name: '\u8fb2\u696d',
    nameZh: '\u8fb2\u696d',
    rss: [
      'https://www.maff.go.jp/j/press/rss.xml',
      'https://www3.nhk.or.jp/rss/news/cat7.xml'
    ],
    keywords: [],
    source: '\u8fb2\u6797\u6c34\u7523\u7701 / NHK'
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HTTP リクエスト ──────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsLearningBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('RSS fetch timeout: ' + url)); });
  });
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── RSS パース ───────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const block = match[1] || match[2];
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const descMatch = block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)
      || block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
    if (titleMatch) {
      const title = titleMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      const desc = descMatch ? descMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim().slice(0, 200) : '';
      if (title && title.length > 3) items.push({ title, desc });
    }
  }
  return items;
}

// ── RSS 取得 & キーワードフィルタ ───────────────────────────
async function fetchRSS(cat) {
  const allItems = [];

  for (const url of cat.rss) {
    try {
      console.log('  Fetching:', url);
      const xml = await httpGet(url);
      const items = parseRSS(xml);
      console.log('  Got', items.length, 'items from', url);
      allItems.push(...items);
    } catch(e) {
      console.error('  RSS fetch failed:', url, '-', e.message);
    }
  }

  if (allItems.length === 0) {
    console.log('  No items fetched for', cat.id);
    return [];
  }

  // キーワードフィルタがある場合は関連ニュースのみ使用
  if (cat.keywords && cat.keywords.length > 0) {
    const filtered = allItems.filter(item =>
      cat.keywords.some(kw => item.title.includes(kw) || item.desc.includes(kw))
    );
    console.log('  Keyword filtered:', filtered.length, '/', allItems.length, 'items for', cat.id);
    // フィルタ結果があればそれのみ使用
    // なければ全件をそのままGeminiに渡し、prompt側で判断させる
    return filtered.length > 0 ? filtered.slice(0, 5) : allItems.slice(0, 5);
  }

  return allItems.slice(0, 5);
}

// ── Gemini API ───────────────────────────────────────────────
function callGemini(prompt) {
  return new Promise(async (resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: 16000,
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    try {
      const res = await httpRequest(options, body);
      const parsed = JSON.parse(res.body);
      if (parsed.error) {
        reject(new Error('API Error: ' + (parsed.error.message || JSON.stringify(parsed.error))));
        return;
      }
      let text = '';
      for (const part of parsed.candidates[0].content.parts) {
        if (part.text) text += part.text;
      }
      resolve(text.trim());
    } catch(e) {
      reject(e);
    }
  });
}

// ── Prompt 構築 ──────────────────────────────────────────────
function buildPrompt(today, rssItems) {
  const newsContextParts = [];
  for (const cat of categories) {
    const items = rssItems[cat.id] || [];
    newsContextParts.push('【' + cat.name + '】 (source: ' + cat.source + ')');
    if (items.length > 0) {
      items.forEach((item, i) => {
        newsContextParts.push((i + 1) + '. ' + item.title);
        if (item.desc) newsContextParts.push('   ' + item.desc);
      });
    } else {
      // urban の場合は都市再開発系で生成するよう明示
      if (cat.id === 'urban') {
        newsContextParts.push('（RSS\u53d6\u5f97\u5931\u6557 - \u90fd\u5e02\u518d\u958b\u767a\u30fb\u307e\u3061\u3065\u304f\u308a\u95a2\u9023\u306e\u6700\u65b0\u30cb\u30e5\u30fc\u30b9\u3092\u81ea\u5206\u3067\u751f\u6210\u3059\u308b\u3053\u3068\uff09');
      } else {
        newsContextParts.push('（RSS\u53d6\u5f97\u5931\u6557 - \u6700\u65b0\u30cb\u30e5\u30fc\u30b9\u3092\u81ea\u5206\u3067\u751f\u6210\u3059\u308b\u3053\u3068\uff09');
      }
    }
  }

  return [
    'You are an expert Japanese language teacher specializing in business Japanese for Taiwanese professionals.',
    'Today is ' + today + '.',
    '',
    'REAL NEWS from RSS feeds:',
    newsContextParts.join('\n'),
    '',
    'TASK: Generate advanced Japanese learning content for ALL 5 categories.',
    '',
    '=== CRITICAL RULE FOR "urban" CATEGORY (\u90fd\u5e02\u518d\u958b\u767a) ===',
    'The "urban" category MUST cover topics related to: \u5e02\u8857\u5730\u518d\u958b\u767a\u4e8b\u696d, \u307e\u3061\u3065\u304f\u308a, \u90fd\u5e02\u518d\u751f, \u56e3\u5730\u5efa\u66ff, \u99c5\u524d\u518d\u958b\u767a, \u5efa\u7bc9\u8a08\u753b, \u5730\u533a\u6d3b\u6027\u5316, \u95a2\u9023\u5354\u5b9a',
    'DO NOT use AI, economy, agriculture, or any other unrelated topics for the "urban" category.',
    'If the RSS news above contains relevant urban/redevelopment items, use them.',
    'If not, CREATE a realistic urban redevelopment news story based on actual recent projects in Japan (e.g. \u9ad8\u8f2a\u30b2\u30fc\u30c8\u30a6\u30a7\u30a4\u30b7\u30c6\u30a3, \u6e0b\u8c37\u518d\u958b\u767a, \u864e\u30ce\u9580\u30d2\u30eb\u30ba, \u6771\u6b66\u66f3\u8239\u99c5\u524d\u518d\u958b\u767a, \u4e2d\u91ce\u99c5\u65b0\u5317\u53e3 etc.)',
    'NEVER substitute the "urban" category with AI news, technology news, or any other off-topic content.',
    '=== END CRITICAL RULE ===',
    '',
    'CONTENT REQUIREMENTS (all categories):',
    '- titleJp: Use actual Japanese headline from RSS, or create a realistic one based on real Japan news.',
    '- summaryJp: DETAILED 5-6 sentence summary (~500 Japanese characters). Formal written Japanese. Specific facts and context.',
    '- summaryZh: Detailed Traditional Chinese translation.',
    '- vocabulary: N1-level or business Japanese words only. No basic N2.',
    '- grammarPoints: Advanced N1 patterns (\u301c\u306b\u969b\u3057\u3066, \u301c\u3092\u3082\u3063\u3066, \u301c\u306b\u57fa\u3065\u304d, \u301c\u3092\u4f59\u5100\u306a\u304f\u3055\u308c\u308b etc.)',
    '- keySentences: Complex sentences with advanced grammar worth studying.',
    '- note: Detailed grammar explanation in Traditional Chinese.',
    '',
    'STRICT FORMAT RULES:',
    '- Output ONLY a single valid JSON object. No extra text.',
    '- ALL Chinese must be Traditional Chinese (\u7e41\u9ad4\u4e2d\u6587), NOT Simplified.',
    '- Japanese: plain text only. NO furigana in parentheses. NO HTML tags.',
    '- Only "reading" field in vocabulary contains hiragana.',
    '- No newlines or control characters inside JSON string values.',
    '',
    'JSON structure (fill ALL 5 categories completely):',
    '{',
    '  "date": "' + today + '",',
    '  "articles": [',
    '    {',
    '      "category": "tech",',
    '      "titleJp": "NHK\u304b\u3089\u306e\u30c6\u30af\u30ce\u30ed\u30b8\u30fc\u30cb\u30e5\u30fc\u30b9\u898b\u51fa\u3057",',
    '      "titleZh": "\u7e41\u9ad4\u4e2d\u6587\u6a19\u984c",',
    '      "summaryJp": "5\u30186\u6587\u306e\u8a73\u7d30\u8981\u7d04\u3002\u66f8\u304d\u8a00\u8449\u3002\u7d044500\u6587\u5b57\u3002",',
    '      "summaryZh": "\u8a73\u7d30\u306a\u7e41\u9ad4\u4e2d\u6587\u6458\u8981",',
    '      "source": "NHK",',
    '      "vocabulary": [',
    '        {"word": "N1\u30d3\u30b8\u30cd\u30b9\u6f22\u5b57", "reading": "\u3088\u307f", "meaning": "\u7e41\u9ad4\u610f\u601d", "example": "\u4f8b\u6587"},',
    '        {"word": "N1\u30d3\u30b8\u30cd\u30b9\u6f22\u5b57", "reading": "\u3088\u307f", "meaning": "\u7e41\u9ad4\u610f\u601d", "example": "\u4f8b\u6587"},',
    '        {"word": "N1\u30d3\u30b8\u30cd\u30b9\u6f22\u5b57", "reading": "\u3088\u307f", "meaning": "\u7e41\u9ad4\u610f\u601d", "example": "\u4f8b\u6587"},',
    '        {"word": "N1\u30d3\u30b8\u30cd\u30b9\u6f22\u5b57", "reading": "\u3088\u307f", "meaning": "\u7e41\u9ad4\u610f\u601d", "example": "\u4f8b\u6587"},',
    '        {"word": "N1\u30d3\u30b8\u30cd\u30b9\u6f22\u5b57", "reading": "\u3088\u307f", "meaning": "\u7e41\u9ad4\u610f\u601d", "example": "\u4f8b\u6587"}',
    '      ],',
    '      "grammarPoints": [',
    '        {"pattern": "\u301cN1\u6587\u6cd5", "meaning": "\u7e41\u9ad4\u8aaa\u660e", "example": "\u4f8b\u6587", "exampleZh": "\u7e41\u9ad4\u7ffb\u8b6f"},',
    '        {"pattern": "\u301cN1\u6587\u6cd5", "meaning": "\u7e41\u9ad4\u8aaa\u660e", "example": "\u4f8b\u6587", "exampleZh": "\u7e41\u9ad4\u7ffb\u8b6f"},',
    '        {"pattern": "\u301cN1\u6587\u6cd5", "meaning": "\u7e41\u9ad4\u8aaa\u660e", "example": "\u4f8b\u6587", "exampleZh": "\u7e41\u9ad4\u7ffb\u8b6f"}',
    '      ],',
    '      "keySentences": [',
    '        {"jp": "\u8907\u96d1\u306a\u6587", "zh": "\u7e41\u9ad4\u7ffb\u8b6f", "note": "\u8a73\u7d30\u306a\u6587\u6cd5\u89e3\u8aac\uff08\u7e41\u9ad4\uff09"},',
    '        {"jp": "\u8907\u96d1\u306a\u6587", "zh": "\u7e41\u9ad4\u7ffb\u8b6f", "note": "\u6587\u6cd5\u89e3\u8aac\uff08\u7e41\u9ad4\uff09"},',
    '        {"jp": "\u8907\u96d1\u306a\u6587", "zh": "\u7e41\u9ad4\u7ffb\u8b6f", "note": "\u6587\u6cd5\u89e3\u8aac\uff08\u7e41\u9ad4\uff09"}',
    '      ]',
    '    },',
    '    {',
    '      "category": "urban",',
    '      "titleJp": "*** MUST BE urban redevelopment topic - \u5e02\u8857\u5730\u518d\u958b\u767a\u30fb\u307e\u3061\u3065\u304f\u308a\u95a2\u9023\u306e\u30cb\u30e5\u30fc\u30b9 ***",',
    '      "titleZh": "\u7e41\u9ad4\u6a19\u984c",',
    '      "summaryJp": "5\u30186\u6587\u306e\u8a73\u7d30\u8981\u7d04",',
    '      "summaryZh": "\u7e41\u9ad4\u6458\u8981",',
    '      "source": "UR\u90fd\u5e02\u6a5f\u69cb / SUUMO",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "realestate",',
    '      "titleJp": "SUUMO\u304b\u3089\u306e\u4e0d\u52d5\u7523\u5e02\u5834\u30cb\u30e5\u30fc\u30b9",',
    '      "titleZh": "\u7e41\u9ad4\u6a19\u984c",',
    '      "summaryJp": "5\u30186\u6587\u306e\u8a73\u7d30\u8981\u7d04",',
    '      "summaryZh": "\u7e41\u9ad4\u6458\u8981",',
    '      "source": "SUUMO\u30b8\u30e3\u30fc\u30ca\u30eb",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "economy",',
    '      "titleJp": "NHK\u304b\u3089\u306e\u7d4c\u6e08\u30cb\u30e5\u30fc\u30b9",',
    '      "titleZh": "\u7e41\u9ad4\u6a19\u984c",',
    '      "summaryJp": "5\u30186\u6587\u306e\u8a73\u7d30\u8981\u7d04",',
    '      "summaryZh": "\u7e41\u9ad4\u6458\u8981",',
    '      "source": "NHK",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "agri",',
    '      "titleJp": "\u8fb2\u6797\u6c34\u7523\u7701 / NHK\u304b\u3089\u306e\u8fb2\u696d\u30cb\u30e5\u30fc\u30b9",',
    '      "titleZh": "\u7e41\u9ad4\u6a19\u984c",',
    '      "summaryJp": "5\u30186\u6587\u306e\u8a73\u7d30\u8981\u7d04",',
    '      "summaryZh": "\u7e41\u9ad4\u6458\u8981",',
    '      "source": "\u8fb2\u6797\u6c34\u7523\u7701 / NHK",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    }',
    '  ]',
    '}',
    '',
    'REMINDER: Fill ALL fields completely. "urban" category MUST be about urban redevelopment/まちづくり ONLY. Traditional Chinese throughout.'
  ].join('\n');
}

// ── JSON クリーン ────────────────────────────────────────────
function cleanJSON(text) {
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```/gm, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found. Got: ' + text.slice(0, 200));
  let jsonStr = text.slice(start, end);
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    const code = jsonStr.charCodeAt(i);
    if (escape) { result += ch; escape = false; }
    else if (ch === '\\') { result += ch; escape = true; }
    else if (ch === '"') { result += ch; inString = !inString; }
    else if (inString && code < 32) {
      if (code === 9 || code === 10 || code === 13) result += ' ';
    } else { result += ch; }
  }
  return JSON.parse(result);
}

function stripFurigana(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\uff08[ぁ-ん\u30A0-\u30FF]+\uff09/g, '').replace(/\([ぁ-ん\u30A0-\u30FF]+\)/g, '').trim();
}

function cleanArticles(articles) {
  for (const a of articles) {
    a.titleJp   = stripFurigana(a.titleJp || '');
    a.summaryJp = stripFurigana(a.summaryJp || '');
    if (a.grammarPoints) for (const g of a.grammarPoints) g.example = stripFurigana(g.example || '');
    if (a.keySentences)  for (const s of a.keySentences)  s.jp = stripFurigana(s.jp || '');
    if (a.vocabulary) {
      for (const v of a.vocabulary) {
        v.example = stripFurigana(v.example || '');
        if (v.word && v.reading) {
          v.word = '<ruby>' + v.word + '<rt>' + v.reading + '</rt></ruby>';
        }
      }
    }
  }
  return articles;
}

// ── Notion ───────────────────────────────────────────────────
function notionRequest(path, method, payload) {
  const body = JSON.stringify(payload);
  const options = {
    hostname: 'api.notion.com',
    path: path,
    method: method,
    headers: {
      'Authorization': 'Bearer ' + notionToken,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  return httpRequest(options, body);
}

function t(text) { return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }]; }
function h2(text) { return { object: 'block', type: 'heading_2', heading_2: { rich_text: t(text) } }; }
function h3(text) { return { object: 'block', type: 'heading_3', heading_3: { rich_text: t(text) } }; }
function p(text)  { return { object: 'block', type: 'paragraph',  paragraph:  { rich_text: t(text) } }; }
function hr()     { return { object: 'block', type: 'divider',    divider:    {} }; }

function buildNotionBlocks(article) {
  const catNames = { tech: 'テクノロジー', urban: '都市再開発', realestate: '不動産市場', economy: '経済', agri: '農業' };
  const blocks = [];
  blocks.push(h2('【' + (catNames[article.category] || article.category) + '】 ' + article.titleJp));
  blocks.push(p(article.titleZh + '（' + (article.source || '') + '）'));
  blocks.push(hr());
  blocks.push(h3('📰 ニュース要約'));
  blocks.push(p(article.summaryJp));
  blocks.push(p(article.summaryZh));
  if (article.vocabulary && article.vocabulary.length > 0) {
    blocks.push(hr());
    blocks.push(h3('📖 重要単語（N1・ビジネス）'));
    for (const v of article.vocabulary) {
      const word = v.word.replace(/<[^>]+>/g, '');
      blocks.push(p('▶ ' + word + '（' + (v.reading||'') + '）　' + v.meaning));
      blocks.push(p('　例：' + v.example));
    }
  }
  if (article.grammarPoints && article.grammarPoints.length > 0) {
    blocks.push(hr());
    blocks.push(h3('📌 文法・表現（N1・ビジネス）'));
    for (const g of article.grammarPoints) {
      blocks.push(p('▶ ' + g.pattern + '　→　' + g.meaning));
      blocks.push(p('　' + g.example));
      blocks.push(p('　' + g.exampleZh));
    }
  }
  if (article.keySentences && article.keySentences.length > 0) {
    blocks.push(hr());
    blocks.push(h3('🔑 キーセンテンス解析'));
    for (const s of article.keySentences) {
      blocks.push(p('▶ ' + s.jp));
      blocks.push(p('　' + s.zh));
      blocks.push(p('　📌 ' + s.note));
    }
  }
  return blocks;
}

async function pushToNotion(articles, today) {
  console.log('\nPushing to Notion...');
  const allBlocks = [];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (!a.titleJp || a.titleZh === '生成失敗') continue;
    allBlocks.push(...buildNotionBlocks(a));
    if (i < articles.length - 1) allBlocks.push(hr());
  }
  if (allBlocks.length === 0) { console.log('No valid articles for Notion.'); return; }

  const dbId = notionDbId.replace(/-/g, '').replace(/\?.*$/, '');
  const res = await notionRequest('/v1/pages', 'POST', {
    parent: { database_id: dbId },
    properties: { title: { title: t(today + ' 日本語ニュース学習') } },
    children: allBlocks.slice(0, 100)
  });
  const data = JSON.parse(res.body);
  if (res.status !== 200) { console.error('Notion error:', res.status, res.body.slice(0, 200)); return; }
  console.log('Notion page created:', data.id);

  if (allBlocks.length > 100) {
    const pageId = data.id;
    for (let i = 100; i < allBlocks.length; i += 100) {
      await notionRequest('/v1/blocks/' + pageId + '/children', 'PATCH', { children: allBlocks.slice(i, i + 100) });
      await sleep(500);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  // Step 1: Fetch all RSS feeds in parallel
  console.log('\nFetching RSS feeds...');
  const rssItems = {};
  await Promise.all(categories.map(async (cat) => {
    rssItems[cat.id] = await fetchRSS(cat);
    console.log('  [' + cat.id + '] total items:', rssItems[cat.id].length);
  }));

  // Step 2: Call Gemini once with all context
  const prompt = buildPrompt(today, rssItems);
  let parsed = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log('\nCalling Gemini API (attempt ' + attempt + '/3)...');
      const text = await callGemini(prompt);
      console.log('Response length:', text.length);
      parsed = cleanJSON(text);
      console.log('Parsed successfully, articles:', parsed.articles.length);
      break;
    } catch(e) {
      console.error('Attempt ' + attempt + ' failed:', e.message.slice(0, 150));
      if (attempt < 3) {
        const wait = attempt * 30;
        console.log('Waiting ' + wait + 's...');
        await sleep(wait * 1000);
      }
    }
  }

  if (!parsed) {
    parsed = {
      date: today,
      articles: categories.map(cat => ({
        category: cat.id, titleJp: cat.name, titleZh: '生成失敗',
        summaryJp: 'コンテンツの生成に失敗しました。',
        summaryZh: '內容生成失敗，請稍後再試。',
        source: '', vocabulary: [], grammarPoints: [], keySentences: []
      }))
    };
  } else {
    parsed.articles = cleanArticles(parsed.articles);
  }

  // Step 3: Save today.json
  fs.writeFileSync('today.json', JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Saved today.json for', today);

  // Step 4: Push to Notion
  if (notionToken && notionDbId) {
    try { await pushToNotion(parsed.articles, today); }
    catch(e) { console.error('Notion push failed:', e.message); }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
