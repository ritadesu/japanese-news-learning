const https = require('https');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
const notionToken = process.env.NOTION_TOKEN;
const notionDbId = process.env.NOTION_DB_ID;

const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today = now.getFullYear() + '\u5e74' +
  String(now.getMonth() + 1).padStart(2, '0') + '\u6708' +
  String(now.getDate()).padStart(2, '0') + '\u65e5';

console.log('Generating news for:', today);

const categories = [
  { id: 'tech',       name: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc',   nameZh: '\u79d1\u6280' },
  { id: 'urban',      name: '\u90fd\u5e02\u518d\u958b\u767a',          nameZh: '\u90fd\u5e02\u518d\u958b\u767a' },
  { id: 'realestate', name: '\u4e0d\u52d5\u7523\u5e02\u5834',          nameZh: '\u4e0d\u52d5\u7522\u5e02\u5834' },
  { id: 'economy',    name: '\u7d4c\u6e08',                            nameZh: '\u7d93\u6fdf' },
  { id: 'agri',       name: '\u8fb2\u696d',                            nameZh: '\u8fb2\u696d' }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: raw });
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function callGemini(prompt) {
  return new Promise(async (resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
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
        const msg = parsed.error.message || JSON.stringify(parsed.error);
        let retryDelay = 60;
        const match = msg.match(/retry in (\d+)/i);
        if (match) retryDelay = parseInt(match[1]) + 5;
        const err = new Error('API Error: ' + msg);
        err.retryDelay = retryDelay;
        reject(err);
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

function buildPrompt(catId, catName, catNameZh, today) {
  return [
    'You are a Japanese language education expert for Taiwanese learners.',
    'Topic: ' + catName + ' (' + catNameZh + ') news as of ' + today,
    '',
    'RULES:',
    '- Output ONLY valid JSON. No extra text outside the JSON.',
    '- ALL Chinese must be Traditional Chinese (繁體中文), NOT Simplified.',
    '- Japanese text: plain text only, NO furigana in parentheses, NO HTML tags.',
    '- Only "reading" field contains hiragana.',
    '- No newlines inside JSON string values.',
    '- Keep all strings SHORT to avoid truncation.',
    '',
    'Output this JSON with real content:',
    '{',
    '  "category": "' + catId + '",',
    '  "titleJp": "Japanese headline",',
    '  "titleZh": "繁體中文標題",',
    '  "summaryJp": "2-sentence Japanese summary, plain text only",',
    '  "summaryZh": "繁體中文摘要，2句",',
    '  "source": "Media name",',
    '  "vocabulary": [',
    '    {"word":"漢字","reading":"よみ","meaning":"繁體意思","example":"短い例文"},',
    '    {"word":"漢字","reading":"よみ","meaning":"繁體意思","example":"短い例文"},',
    '    {"word":"漢字","reading":"よみ","meaning":"繁體意思","example":"短い例文"},',
    '    {"word":"漢字","reading":"よみ","meaning":"繁體意思","example":"短い例文"},',
    '    {"word":"漢字","reading":"よみ","meaning":"繁體意思","example":"短い例文"}',
    '  ],',
    '  "grammarPoints": [',
    '    {"pattern":"〜文法","meaning":"繁體說明","example":"例文","exampleZh":"繁體翻譯"},',
    '    {"pattern":"〜文法","meaning":"繁體說明","example":"例文","exampleZh":"繁體翻譯"},',
    '    {"pattern":"〜文法","meaning":"繁體說明","example":"例文","exampleZh":"繁體翻譯"}',
    '  ],',
    '  "keySentences": [',
    '    {"jp":"日本語文","zh":"繁體翻譯","note":"繁體解說"},',
    '    {"jp":"日本語文","zh":"繁體翻譯","note":"繁體解說"},',
    '    {"jp":"日本語文","zh":"繁體翻譯","note":"繁體解說"}',
    '  ]',
    '}'
  ].join('\n');
}

function cleanJSON(text) {
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```/gm, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found. Got: ' + text.slice(0, 150));
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
  return text.replace(/（[ぁ-ん\u30A0-\u30FF]+）/g, '').replace(/\([ぁ-ん\u30A0-\u30FF]+\)/g, '').trim();
}

function cleanArticle(article) {
  article.titleJp   = stripFurigana(article.titleJp || '');
  article.summaryJp = stripFurigana(article.summaryJp || '');
  if (article.grammarPoints) {
    for (const g of article.grammarPoints) g.example = stripFurigana(g.example || '');
  }
  if (article.keySentences) {
    for (const s of article.keySentences) s.jp = stripFurigana(s.jp || '');
  }
  if (article.vocabulary) {
    for (const v of article.vocabulary) {
      v.example = stripFurigana(v.example || '');
      if (v.word && v.reading) {
        v.word = '<ruby>' + v.word + '<rt>' + v.reading + '</rt></ruby>';
      }
    }
  }
  return article;
}

async function generateArticleWithRetry(cat, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log('  Attempt ' + attempt + '/' + maxRetries);
      const prompt = buildPrompt(cat.id, cat.name, cat.nameZh, today);
      const text = await callGemini(prompt);
      console.log('  Response length:', text.length);
      if (text.length < 100) throw new Error('Response too short: ' + text);
      const article = cleanJSON(text);
      return cleanArticle(article);
    } catch(e) {
      console.error('  Attempt ' + attempt + ' failed:', e.message.slice(0, 120));
      if (attempt < maxRetries) {
        const waitSec = e.retryDelay || (attempt * 40);
        console.log('  Waiting ' + waitSec + 's before retry...');
        await sleep(waitSec * 1000);
      } else {
        throw e;
      }
    }
  }
}

// ── Notion helpers ──────────────────────────────────────────

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

function t(text) {
  // Notion rich text block helper
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

function heading2(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: t(text) } };
}

function heading3(text) {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: t(text) } };
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: t(text) } };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function buildNotionBlocks(article) {
  const catNames = {
    tech: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc',
    urban: '\u90fd\u5e02\u518d\u958b\u767a',
    realestate: '\u4e0d\u52d5\u7522\u5e02\u5834',
    economy: '\u7d93\u6fdf',
    agri: '\u8fb2\u696d'
  };
  const catName = catNames[article.category] || article.category;
  const blocks = [];

  // Category badge + headline
  blocks.push(heading2('\u3010' + catName + '\u3011 ' + article.titleJp));
  blocks.push(paragraph(article.titleZh + '\uff08' + (article.source || '') + '\uff09'));
  blocks.push(divider());

  // Summary
  blocks.push(heading3('\ud83d\udcf0 \u30cb\u30e5\u30fc\u30b9\u8981\u7d04'));
  blocks.push(paragraph(article.summaryJp));
  blocks.push(paragraph(article.summaryZh));
  blocks.push(divider());

  // Vocabulary
  if (article.vocabulary && article.vocabulary.length > 0) {
    blocks.push(heading3('\ud83d\udcd6 \u91cd\u8981\u5358\u8a9e'));
    for (const v of article.vocabulary) {
      // Strip ruby tags for Notion
      const word = v.word.replace(/<[^>]+>/g, '');
      const reading = v.reading || '';
      blocks.push(paragraph('\u25b6 ' + word + '\uff08' + reading + '\uff09\u3000' + v.meaning));
      blocks.push(paragraph('\u3000\u4f8b\uff1a' + v.example));
    }
    blocks.push(divider());
  }

  // Grammar
  if (article.grammarPoints && article.grammarPoints.length > 0) {
    blocks.push(heading3('\ud83d\udccc \u6587\u6cd5\u30fb\u8868\u73fe'));
    for (const g of article.grammarPoints) {
      blocks.push(paragraph('\u25b6 ' + g.pattern + '\u3000\u2192\u3000' + g.meaning));
      blocks.push(paragraph('\u3000' + g.example));
      blocks.push(paragraph('\u3000' + g.exampleZh));
    }
    blocks.push(divider());
  }

  // Key sentences
  if (article.keySentences && article.keySentences.length > 0) {
    blocks.push(heading3('\ud83d\udd11 \u30ad\u30fc\u30bb\u30f3\u30c6\u30f3\u30b9'));
    for (const s of article.keySentences) {
      blocks.push(paragraph('\u25b6 ' + s.jp));
      blocks.push(paragraph('\u3000' + s.zh));
      blocks.push(paragraph('\u3000\ud83d\udccc ' + s.note));
    }
  }

  return blocks;
}

async function pushToNotion(articles, today) {
  console.log('\nPushing to Notion...');

  // Build all blocks for the page
  const allBlocks = [];

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (!a.titleJp || a.titleZh === '\u751f\u6210\u5931\u6557') {
      console.log('Skipping failed article:', a.category);
      continue;
    }
    const blocks = buildNotionBlocks(a);
    allBlocks.push(...blocks);
    if (i < articles.length - 1) allBlocks.push(divider());
  }

  if (allBlocks.length === 0) {
    console.log('No valid articles to push to Notion.');
    return;
  }

  // Create page in Notion database
  const dbId = notionDbId.replace(/-/g, '').replace(/\?.*$/, '');

  const payload = {
    parent: { database_id: dbId },
    properties: {
      title: {
        title: t(today + ' \u65e5\u672c\u8a9e\u30cb\u30e5\u30fc\u30b9\u5b66\u7fd2')
      }
    },
    children: allBlocks.slice(0, 100) // Notion API limit per request
  };

  const res = await notionRequest('/v1/pages', 'POST', payload);
  const data = JSON.parse(res.body);

  if (res.status !== 200) {
    console.error('Notion API error:', res.status, res.body.slice(0, 300));
    return;
  }

  console.log('Notion page created:', data.url || data.id);

  // If we have more than 100 blocks, append the rest
  if (allBlocks.length > 100) {
    const pageId = data.id;
    const remaining = allBlocks.slice(100);
    // Append in chunks of 100
    for (let i = 0; i < remaining.length; i += 100) {
      const chunk = remaining.slice(i, i + 100);
      await notionRequest('/v1/blocks/' + pageId + '/children', 'PATCH', { children: chunk });
      await sleep(500);
    }
    console.log('Appended remaining blocks to Notion page.');
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const articles = [];

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    console.log('\nGenerating: ' + cat.name + ' (' + cat.id + ')');
    try {
      const article = await generateArticleWithRetry(cat);
      articles.push(article);
      console.log('Success:', cat.id);
    } catch(e) {
      console.error('All attempts failed for', cat.id, ':', e.message.slice(0, 100));
      articles.push({
        category: cat.id,
        titleJp: cat.name,
        titleZh: '\u751f\u6210\u5931\u6557',
        summaryJp: '\u30b3\u30f3\u30c6\u30f3\u30c4\u306e\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
        summaryZh: '\u5167\u5bb9\u751f\u6210\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002',
        source: '', vocabulary: [], grammarPoints: [], keySentences: []
      });
    }
    if (i < categories.length - 1) {
      console.log('Waiting 15s...');
      await sleep(15000);
    }
  }

  // Save today.json for the web app
  const output = { date: today, articles };
  fs.writeFileSync('today.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('\nSaved today.json with', articles.length, 'articles');

  // Push to Notion
  if (notionToken && notionDbId) {
    try {
      await pushToNotion(articles, today);
    } catch(e) {
      console.error('Notion push failed:', e.message);
    }
  } else {
    console.log('Notion credentials not set, skipping.');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
