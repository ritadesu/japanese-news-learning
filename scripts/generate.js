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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        const err = new Error('API Error: ' + (parsed.error.message || JSON.stringify(parsed.error)));
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

function buildPrompt(today) {
  return [
    'You are an expert Japanese language teacher specializing in business Japanese for Taiwanese professionals.',
    'Today is ' + today + '.',
    'Generate advanced Japanese learning content based on recent Japanese news for ALL 5 categories.',
    '',
    'CONTENT REQUIREMENTS:',
    '- summaryJp: Write a DETAILED 5-6 sentence summary (~500 Japanese characters). Use rich, formal written Japanese (書き言葉). Include specific facts, numbers, and context from the news.',
    '- summaryZh: Detailed Traditional Chinese translation matching the Japanese summary.',
    '- vocabulary: Choose N1-level or business Japanese words (ビジネス日本語). Words commonly used in newspapers, corporate settings, or formal documents. Avoid basic N2 words.',
    '- grammarPoints: Use advanced N1 grammar patterns or formal written expressions (〜に際して、〜をもって、〜に基づき、〜を余儀なくされる etc.)',
    '- keySentences: Pick complex sentences from the summary with advanced grammar worth studying.',
    '- note in keySentences: Explain the grammar point and nuance in Traditional Chinese, give usage tips.',
    '',
    'STRICT FORMAT RULES:',
    '- Output ONLY a single valid JSON object. No extra text before or after.',
    '- ALL Chinese must be Traditional Chinese (繁體中文), NOT Simplified.',
    '- Japanese text: plain text only. NO furigana in parentheses like 東京（とうきょう）. NO HTML tags.',
    '- Only the "reading" field in vocabulary items contains hiragana reading.',
    '- No newlines or control characters inside any JSON string values.',
    '- Strings must be on a single line each.',
    '',
    'Output this exact JSON with complete real content for all 5 categories:',
    '{',
    '  "date": "' + today + '",',
    '  "articles": [',
    '    {',
    '      "category": "tech",',
    '      "titleJp": "テクノロジーに関する実際のニュース見出し",',
    '      "titleZh": "繁體中文標題",',
    '      "summaryJp": "5〜6文の詳細な要約。約500文字。具体的な数字や背景情報を含む。書き言葉で書く。",',
    '      "summaryZh": "與日文摘要對應的詳細繁體中文翻譯",',
    '      "source": "日本経済新聞",',
    '      "vocabulary": [',
    '        {"word": "N1またはビジネス漢字語", "reading": "よみがな", "meaning": "繁體中文意思", "example": "ビジネスシーンでの例文"},',
    '        {"word": "N1またはビジネス漢字語", "reading": "よみがな", "meaning": "繁體中文意思", "example": "例文"},',
    '        {"word": "N1またはビジネス漢字語", "reading": "よみがな", "meaning": "繁體中文意思", "example": "例文"},',
    '        {"word": "N1またはビジネス漢字語", "reading": "よみがな", "meaning": "繁體中文意思", "example": "例文"},',
    '        {"word": "N1またはビジネス漢字語", "reading": "よみがな", "meaning": "繁體中文意思", "example": "例文"}',
    '      ],',
    '      "grammarPoints": [',
    '        {"pattern": "〜N1文法パターン", "meaning": "繁體中文說明與使用場景", "example": "新聞・ビジネスシーンからの例文", "exampleZh": "繁體翻譯"},',
    '        {"pattern": "〜N1文法パターン", "meaning": "繁體中文說明與使用場景", "example": "例文", "exampleZh": "繁體翻譯"},',
    '        {"pattern": "〜N1文法パターン", "meaning": "繁體中文說明與使用場景", "example": "例文", "exampleZh": "繁體翻譯"}',
    '      ],',
    '      "keySentences": [',
    '        {"jp": "要約から選んだ複雑な文", "zh": "繁體翻譯", "note": "詳細な文法解説と使用上のニュアンス（繁體中文）"},',
    '        {"jp": "要約から選んだ複雑な文", "zh": "繁體翻譯", "note": "文法解説（繁體中文）"},',
    '        {"jp": "要約から選んだ複雑な文", "zh": "繁體翻譯", "note": "文法解説（繁體中文）"}',
    '      ]',
    '    },',
    '    {',
    '      "category": "urban",',
    '      "titleJp": "都市再開発に関する実際のニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約（約500文字）",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "メディア名",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "realestate",',
    '      "titleJp": "不動産市場に関する実際のニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約（約500文字）",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "メディア名",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "economy",',
    '      "titleJp": "経済に関する実際のニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約（約500文字）",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "メディア名",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    },',
    '    {',
    '      "category": "agri",',
    '      "titleJp": "農業に関する実際のニュース見出し",',
    '      "titleZh": "繁體標題",',
    '      "summaryJp": "5〜6文の詳細要約（約500文字）",',
    '      "summaryZh": "繁體摘要",',
    '      "source": "メディア名",',
    '      "vocabulary": [{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""},{"word":"","reading":"","meaning":"","example":""}],',
    '      "grammarPoints": [{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""},{"pattern":"","meaning":"","example":"","exampleZh":""}],',
    '      "keySentences": [{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""},{"jp":"","zh":"","note":""}]',
    '    }',
    '  ]',
    '}',
    '',
    'IMPORTANT: Fill ALL fields in ALL 5 articles with complete, high-quality content. Every vocabulary word must be N1 or business level. Every summary must be detailed (~500 Japanese characters). Use Traditional Chinese only.'
  ].join('\n');
}

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

// ── Notion ──────────────────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────

async function main() {
  const prompt = buildPrompt(today);
  let parsed = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log('Calling Gemini API (attempt ' + attempt + '/3)...');
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
      articles: ['tech','urban','realestate','economy','agri'].map(id => ({
        category: id, titleJp: id, titleZh: '生成失敗',
        summaryJp: 'コンテンツの生成に失敗しました。',
        summaryZh: '內容生成失敗，請稍後再試。',
        source: '', vocabulary: [], grammarPoints: [], keySentences: []
      }))
    };
  } else {
    parsed.articles = cleanArticles(parsed.articles);
  }

  fs.writeFileSync('today.json', JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Saved today.json for', today);

  if (notionToken && notionDbId) {
    try { await pushToNotion(parsed.articles, today); }
    catch(e) { console.error('Notion push failed:', e.message); }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
