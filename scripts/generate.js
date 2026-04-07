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
    rss: 'https://www3.nhk.or.jp/rss/news/cat3.xml',
    source: 'NHK'
  },
  {
    id: 'urban',
    name: '\u90fd\u5e02\u518d\u958b\u767a',
    nameZh: '\u90fd\u5e02\u518d\u958b\u767a',
    rss: 'https://rss.asahi.com/rss/asahi/newsheadlines.rdf',
    source: '\u671d\u65e5\u65b0\u805e'
  },
  {
    id: 'realestate',
    name: '\u4e0d\u52d5\u7523\u5e02\u5834',
    nameZh: '\u4e0d\u52d5\u7522\u5e02\u5834',
    rss: 'https://suumo.jp/journal/feed/',
    source: 'SUUMO\u30b8\u30e3\u30fc\u30ca\u30eb'
  },
  {
    id: 'economy',
    name: '\u7d4c\u6e08',
    nameZh: '\u7d93\u6fdf',
    rss: 'https://www3.nhk.or.jp/rss/news/cat5.xml',
    source: 'NHK'
  },
  {
    id: 'agri',
    name: '\u8fb2\u696d',
    nameZh: '\u8fb2\u696d',
    rss: 'https://www3.nhk.or.jp/rss/news/cat7.xml',
    source: 'NHK'
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
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('RSS fetch timeout')); });
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
  // Match <item> or <entry> blocks
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
    const block = match[1] || match[2];
    // Extract title
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    // Extract description/summary
    const descMatch = block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)
      || block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);

    if (titleMatch) {
      const title = titleMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      const desc = descMatch ? descMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()
        .slice(0, 300) : '';

      if (title && title.length > 3) {
        items.push({ title, desc });
      }
    }
  }
  return items;
}

// ── RSS 取得 ─────────────────────────────────────────────────
async function fetchRSS(cat) {
  try {
    console.log('  Fetching RSS:', cat.rss);
    const xml = await httpGet(cat.rss);
    const items = parseRSS(xml);
    console.log('  Got', items.length, 'items from RSS');
    return items;
  } catch(e) {
    console.error('  RSS fetch failed:', e.message);
    return [];
  }
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
  // Build news context from RSS items
  const newsContextParts = [];
  for (const cat of categories) {
    const items = rssItems[cat.id] || [];
    if (items.length > 0) {
      newsContextParts.push('【' + cat.name + '】');
      items.forEach((item, i) => {
        newsContextParts.push((i + 1) + '. ' + item.title);
        if (item.desc) newsContextParts.push('   ' + item.desc);
      });
    } else {
      newsContextParts.push('【' + cat.name + '】（RSS取得失敗 - 一般的なニュースを使用）');
    }
  }

  return [
    'You are an expert Japanese language teacher specializing in business Japanese for Taiwanese professionals.',
    'Today is ' + today + '.',
    '',
    'REAL NEWS HEADLINES (use these as the basis for your content):',
    newsContextParts.join('\n'),
    '',
    'TASK: Generate advanced Japanese learning content for ALL 5 categories based on the real news headlines above.',
    'For each category, pick the MOST RELEVANT headline from the list above and create detailed learning content.',
    '',
    'CONTENT REQUIREMENTS:',
    '- titleJp: Use the actual Japanese headline (or a close paraphrase) from the RSS data above.',
    '- summaryJp: Write a DETAILED 5-6 sentence summary (~500 Japanese characters). Use formal written Japanese (書き言葉). Expand on the headline with context and analysis.',
    '- summaryZh: Detailed Traditional Chinese translation matching the Japanese summary.',
    '- vocabulary: Choose N1-level or business Japanese words from the article context. Avoid basic N2 words.',
    '- grammarPoints: Use advanced N1 grammar or formal written expressions (〜に際して、〜をもって、〜に基づき、〜を余儀なくされる etc.)',
    '- keySentences: Pick or create complex sentences related to the news with advanced grammar.',
    '- note: Explain grammar points with usage tips in Traditional Chinese.',
    '',
    'STRICT FORMAT RULES:',
    '- Output ONLY a single valid JSON object. No extra text.',
    '- ALL Chinese must be Traditional Chinese (繁體中文), NOT Simplified.',
    '- Japanese text: plain text only. NO furigana in parentheses. NO HTML tags.',
    '- Only the "reading" field in vocabulary contains hiragana.',
    '- No newlines or control characters inside JSON string values.',
    '',
    'Output this exact JSON with complete real content for all 5 categories:',
    '{',
    '  "date": "' + today + '",',
    '  "articles": [',
    '    {',
    '      "category": "tech",',
    '      "titleJp": "NHKから取得した実際のテクノロジーニュース見出し",',
    '      "titleZh": "繁體中文標題",',
    '      "summaryJp": "5〜6文の詳細な要約。約500文字。書き言葉。",',
    '      "summaryZh": "詳細な繁體中文摘要",',
    '      "source": "NHK",',
    '      "vocabulary": [',
    '        {"word": "N1ビジネス漢字", "reading": "よみがな", "meaning": "繁體意思", "example": "例文"},',
    '        {"word": "N1ビジネス漢字", "reading": "よみがな", "meaning": "繁體意思", "example": "例文"},',
    '        {"word": "N1ビジネス漢字", "reading": "よみがな", "meaning": "繁體意思", "example": "例文"},',
    '        {"word": "N1ビジネス漢字", "reading": "よみがな", "meaning": "繁體意思", "example": "例文"},',
    '        {"word": "N1ビジネス漢字", "reading": "よみがな", "meaning": "繁體意思", "example": "例文"}',
    '      ],',
    '      "grammarPoints": [',
    '        {"pattern": "〜N1文法", "meaning": "繁體說明と使用場景", "example": "例文", "exampleZh": "繁體翻譯"},',
    '        {"pattern": "〜N1文法", "meaning": "繁體說明と使用場景", "example": "例文", "exampleZh": "繁體翻譯"},',
    '        {"pattern": "〜N1文法", "meaning": "繁體說明と使用場景", "example": "例文", "exampleZh": "繁體翻譯"}',
    '      ],',
    '      "keySentences": [',
    '        {"jp": "ニュースに関連する複雑な文", "zh": "繁體翻譯", "note": "詳細な文法解説（繁體中文）"},',
    '        {"jp": "複雑な文", "zh": "繁體翻譯", "note": "解説（繁體中文）"},',
    '        {"jp": "複雑な文", "zh": "繁體翻譯", "note": "解説（繁體中文）"}',
    '      ]',
    '    },',
    '    {',
    '      "category": "urban",',
    '      "titleJp": "朝日新聞から取得した都市再開発ニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "\u671d\u65e5\u65b0\u805e",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "realestate",',
    '      "titleJp": "SUUMOから取得した不動産市場ニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "SUUMO\u30b8\u30e3\u30fc\u30ca\u30eb",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "economy",',
    '      "titleJp": "NHKから取得した経済ニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "NHK",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "agri",',
    '      "titleJp": "NHKから取得した農業ニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "NHK",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    }',
    '  ]',
    '}',
    '',
    'IMPORTANT: Fill ALL fields in ALL 5 articles with complete content based on the real news above. Use Traditional Chinese only. Every summary must be ~500 Japanese characters. Every vocabulary word must be N1 or business level.'
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
  return text.replace(/（[ぁ-ん\u30A0-\u30FF]+）/g, '').replace(/\([ぁ-ん\u30A0-\u30FF]+\)/g, '').trim();
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
  }));

  // Step 2: Build prompt with real news context
  const prompt = buildPrompt(today, rssItems);

  // Step 3: Call Gemini once with all context
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

  // Step 4: Save today.json
  fs.writeFileSync('today.json', JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Saved today.json for', today);

  // Step 5: Push to Notion
  if (notionToken && notionDbId) {
    try { await pushToNotion(parsed.articles, today); }
    catch(e) { console.error('Notion push failed:', e.message); }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
