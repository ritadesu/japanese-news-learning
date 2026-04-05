const https = require('https');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
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

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: 3000,
        temperature: 0.4,
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

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error('API Error: ' + JSON.stringify(parsed.error)));
            return;
          }
          let text = '';
          for (const part of parsed.candidates[0].content.parts) {
            if (part.text) text += part.text;
          }
          resolve(text.trim());
        } catch(e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function buildPrompt(catId, catName, catNameZh, today) {
  const schema = JSON.stringify({
    category: catId,
    titleJp: "News headline in Japanese, plain kanji only",
    titleZh: "\u7e41\u9ad4\u4e2d\u6587\u6a19\u984c",
    summaryJp: "3-sentence summary in Japanese. Plain text only, no furigana, no parentheses.",
    summaryZh: "\u7e41\u9ad4\u4e2d\u6587\u6458\u8981\uff0c3\u53e5\u8a71",
    source: "Media name in Japanese",
    vocabulary: [
      { word: "kanji word", reading: "hiragana", meaning: "\u7e41\u9ad4\u4e2d\u6587\u610f\u601d", example: "Example sentence in Japanese, plain text" },
      { word: "kanji word", reading: "hiragana", meaning: "\u7e41\u9ad4\u4e2d\u6587\u610f\u601d", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana", meaning: "\u7e41\u9ad4\u4e2d\u6587\u610f\u601d", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana", meaning: "\u7e41\u9ad4\u4e2d\u6587\u610f\u601d", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana", meaning: "\u7e41\u9ad4\u4e2d\u6587\u610f\u601d", example: "Example sentence" }
    ],
    grammarPoints: [
      { pattern: "~grammar pattern", meaning: "\u7e41\u9ad4\u4e2d\u6587\u8aaa\u660e", example: "Japanese example, plain text", exampleZh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f" },
      { pattern: "~grammar pattern", meaning: "\u7e41\u9ad4\u4e2d\u6587\u8aaa\u660e", example: "Japanese example", exampleZh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f" },
      { pattern: "~grammar pattern", meaning: "\u7e41\u9ad4\u4e2d\u6587\u8aaa\u660e", example: "Japanese example", exampleZh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f" }
    ],
    keySentences: [
      { jp: "Key sentence in Japanese, plain text", zh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f", note: "\u7e41\u9ad4\u4e2d\u6587\u8a9e\u6cd5\u8aaa\u660e" },
      { jp: "Key sentence", zh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f", note: "\u7e41\u9ad4\u4e2d\u6587\u8a9e\u6cd5\u8aaa\u660e" },
      { jp: "Key sentence", zh: "\u7e41\u9ad4\u4e2d\u6587\u7ffb\u8b6f", note: "\u7e41\u9ad4\u4e2d\u6587\u8a9e\u6cd5\u8aaa\u660e" }
    ]
  }, null, 2);

  return [
    'You are a Japanese language education expert for Taiwanese learners.',
    'Create N2-level Japanese learning content based on recent news about: ' + catName + ' / ' + catNameZh + ' (as of ' + today + ')',
    '',
    'CRITICAL RULES - follow exactly:',
    '1. Output ONLY valid JSON matching the schema below. No extra text.',
    '2. ALL Chinese text (titleZh, summaryZh, meaning, exampleZh, note) MUST be in Traditional Chinese (繁體中文). NOT Simplified Chinese.',
    '3. All Japanese text must be plain text: NO furigana, NO parentheses with readings, NO HTML tags.',
    '4. Only the "reading" field should contain hiragana readings.',
    '5. No line breaks or control characters inside JSON string values.',
    '',
    'JSON Schema (fill all fields with real content):',
    schema
  ].join('\n');
}

function cleanJSON(text) {
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```/gm, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found. Response was: ' + text.slice(0, 200));

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
  article.titleJp    = stripFurigana(article.titleJp || '');
  article.summaryJp  = stripFurigana(article.summaryJp || '');
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
      console.log('  Attempt', attempt + '/' + maxRetries);
      const prompt = buildPrompt(cat.id, cat.name, cat.nameZh, today);
      const text = await callGemini(prompt);
      console.log('  Response length:', text.length);
      if (text.length < 200) {
        throw new Error('Response too short (' + text.length + ' chars): ' + text.slice(0, 100));
      }
      const article = cleanJSON(text);
      return cleanArticle(article);
    } catch(e) {
      console.error('  Attempt', attempt, 'failed:', e.message);
      if (attempt < maxRetries) {
        const waitSec = attempt * 5;
        console.log('  Waiting', waitSec, 'seconds before retry...');
        await sleep(waitSec * 1000);
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  const articles = [];

  for (const cat of categories) {
    console.log('\nGenerating:', cat.name, '(' + cat.id + ')');
    try {
      const article = await generateArticleWithRetry(cat);
      articles.push(article);
      console.log('Success:', cat.id);
    } catch(e) {
      console.error('All attempts failed for', cat.id, ':', e.message);
      articles.push({
        category: cat.id,
        titleJp: cat.name,
        titleZh: '\u751f\u6210\u5931\u6557',
        summaryJp: '\u30b3\u30f3\u30c6\u30f3\u30c4\u306e\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002',
        summaryZh: '\u5167\u5bb9\u751f\u6210\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002',
        source: '',
        vocabulary: [],
        grammarPoints: [],
        keySentences: []
      });
    }

    // Wait between categories to avoid rate limiting
    if (cat !== categories[categories.length - 1]) {
      console.log('Waiting 3 seconds...');
      await sleep(3000);
    }
  }

  const output = { date: today, articles };
  fs.writeFileSync('today.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('\nSaved today.json with', articles.length, 'articles for', today);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
