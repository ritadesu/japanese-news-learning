const https = require('https');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today = now.getFullYear() + '\u5e74' +
  String(now.getMonth() + 1).padStart(2, '0') + '\u6708' +
  String(now.getDate()).padStart(2, '0') + '\u65e5';

console.log('Generating news for:', today);

const categories = [
  { id: 'tech',       name: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc' },
  { id: 'urban',      name: '\u90fd\u5e02\u66f4\u65b0' },
  { id: 'realestate', name: '\u4e0d\u52d5\u7523\u5e02\u5834' },
  { id: 'economy',    name: '\u7d4c\u6e08' },
  { id: 'agri',       name: '\u8fb2\u696d' }
];

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

function buildPrompt(catId, catName, today) {
  const schema = JSON.stringify({
    category: catId,
    titleJp: "News headline in Japanese, plain kanji only, no furigana",
    titleZh: "Chinese translation of title",
    summaryJp: "3-sentence summary in Japanese. Plain text, no furigana, no parentheses for readings.",
    summaryZh: "Chinese translation of summary",
    source: "Media name",
    vocabulary: [
      { word: "kanji word", reading: "hiragana reading", meaning: "Chinese meaning", example: "Example sentence in Japanese, plain text no furigana" },
      { word: "kanji word", reading: "hiragana reading", meaning: "Chinese meaning", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana reading", meaning: "Chinese meaning", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana reading", meaning: "Chinese meaning", example: "Example sentence" },
      { word: "kanji word", reading: "hiragana reading", meaning: "Chinese meaning", example: "Example sentence" }
    ],
    grammarPoints: [
      { pattern: "~grammar pattern", meaning: "Chinese explanation", example: "Japanese example sentence, plain text", exampleZh: "Chinese translation" },
      { pattern: "~grammar pattern", meaning: "Chinese explanation", example: "Japanese example sentence", exampleZh: "Chinese translation" },
      { pattern: "~grammar pattern", meaning: "Chinese explanation", example: "Japanese example sentence", exampleZh: "Chinese translation" }
    ],
    keySentences: [
      { jp: "Key sentence from news in Japanese, plain text", zh: "Chinese translation", note: "Grammar/vocabulary explanation in Chinese" },
      { jp: "Key sentence", zh: "Chinese translation", note: "Explanation" },
      { jp: "Key sentence", zh: "Chinese translation", note: "Explanation" }
    ]
  }, null, 2);

  return [
    'You are a Japanese language education expert.',
    'Create N2-level Japanese learning content based on recent Japanese news about: ' + catName + ' (as of ' + today + ')',
    '',
    'STRICT RULES:',
    '- Output ONLY valid JSON matching the schema below',
    '- All Japanese text must be PLAIN TEXT: no furigana, no parentheses with readings, no HTML tags',
    '- Only the "reading" field in vocabulary should contain hiragana readings',
    '- No control characters or line breaks inside string values',
    '- Keep all string values on a single line',
    '',
    'JSON Schema:',
    schema
  ].join('\n');
}

function cleanJSON(text) {
  // Remove markdown code blocks
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```/gm, '').trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found. Response: ' + text.slice(0, 300));

  let jsonStr = text.slice(start, end);

  // Fix control characters inside strings
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

// Remove any accidental furigana patterns from text
function stripFurigana(text) {
  if (typeof text !== 'string') return text;
  // Remove （reading） patterns after kanji
  return text.replace(/（[ぁ-ん]+）/g, '').replace(/\([ぁ-ん]+\)/g, '').trim();
}

function cleanArticle(article) {
  // Strip furigana from all text fields except vocabulary.reading
  article.titleJp = stripFurigana(article.titleJp || '');
  article.summaryJp = stripFurigana(article.summaryJp || '');

  if (article.grammarPoints) {
    for (const g of article.grammarPoints) {
      g.example = stripFurigana(g.example || '');
    }
  }
  if (article.keySentences) {
    for (const s of article.keySentences) {
      s.jp = stripFurigana(s.jp || '');
    }
  }

  // Add ruby tags to vocabulary words
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

async function generateArticle(cat) {
  const prompt = buildPrompt(cat.id, cat.name, today);
  const text = await callGemini(prompt);
  console.log('Response for', cat.id, '- length:', text.length);
  const article = cleanJSON(text);
  return cleanArticle(article);
}

async function main() {
  const articles = [];

  for (const cat of categories) {
    console.log('\nGenerating:', cat.name, '(' + cat.id + ')');
    try {
      const article = await generateArticle(cat);
      articles.push(article);
      console.log('Success:', cat.id);
    } catch(e) {
      console.error('Failed:', cat.id, '-', e.message);
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
  }

  const output = { date: today, articles };
  fs.writeFileSync('today.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('\nSaved today.json with', articles.length, 'articles for', today);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
