const https = require('https');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today = now.getFullYear() + '\u5e74' +
  String(now.getMonth() + 1).padStart(2, '0') + '\u6708' +
  String(now.getDate()).padStart(2, '0') + '\u65e5';

console.log('Generating news for:', today);

const categories = [
  { id: 'tech', name: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc' },
  { id: 'urban', name: '\u90fd\u5e02\u66f4\u65b0' },
  { id: 'realestate', name: '\u4e0d\u52d5\u7523\u5e02\u5834' },
  { id: 'economy', name: '\u7d4c\u6e08' },
  { id: 'agri', name: '\u8fb2\u696d' }
];

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text = '';
          for (const part of parsed.candidates[0].content.parts) {
            if (part.text) text += part.text;
          }
          resolve(text.trim());
        } catch(e) {
          reject(new Error('Parse error: ' + e.message + ' | Raw: ' + data.slice(0, 300)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

function buildPrompt(cat, today) {
  return [
    'You are a Japanese language education expert.',
    'Today is ' + today + '.',
    'Search for the latest real Japanese news about: ' + cat.name,
    'Then create N2-level Japanese learning content for Taiwanese learners.',
    '',
    'RULES:',
    '- Output ONLY valid JSON, no markdown, no explanation',
    '- No newlines or control characters inside string values',
    '- Use plain text only, no HTML tags',
    '- Include reading (furigana) as a separate field',
    '',
    'Output this exact JSON structure with real content:',
    JSON.stringify({
      category: cat.id,
      titleJp: 'news headline in Japanese',
      titleZh: 'Chinese translation',
      summaryJp: '3-sentence summary in Japanese. Add reading in parentheses after kanji.',
      summaryZh: 'Chinese summary',
      source: 'media name',
      vocabulary: [
        { word: 'kanji word', reading: 'hiragana reading', meaning: 'Chinese meaning', example: 'example sentence' },
        { word: 'kanji word', reading: 'hiragana reading', meaning: 'Chinese meaning', example: 'example sentence' },
        { word: 'kanji word', reading: 'hiragana reading', meaning: 'Chinese meaning', example: 'example sentence' },
        { word: 'kanji word', reading: 'hiragana reading', meaning: 'Chinese meaning', example: 'example sentence' },
        { word: 'kanji word', reading: 'hiragana reading', meaning: 'Chinese meaning', example: 'example sentence' }
      ],
      grammarPoints: [
        { pattern: '~grammar pattern', meaning: 'Chinese explanation', example: 'Japanese example', exampleZh: 'Chinese translation' },
        { pattern: '~grammar pattern', meaning: 'Chinese explanation', example: 'Japanese example', exampleZh: 'Chinese translation' },
        { pattern: '~grammar pattern', meaning: 'Chinese explanation', example: 'Japanese example', exampleZh: 'Chinese translation' }
      ],
      keySentences: [
        { jp: 'key sentence in Japanese', zh: 'Chinese translation', note: 'grammar/vocabulary explanation in Chinese' },
        { jp: 'key sentence in Japanese', zh: 'Chinese translation', note: 'grammar/vocabulary explanation in Chinese' },
        { jp: 'key sentence in Japanese', zh: 'Chinese translation', note: 'grammar/vocabulary explanation in Chinese' }
      ]
    })
  ].join('\n');
}

function cleanAndParseJSON(text) {
  // Remove markdown code blocks
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```$/gm, '').trim();

  // Find JSON boundaries
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found');

  let jsonStr = text.slice(start, end);

  // Fix control characters inside strings
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    const code = jsonStr.charCodeAt(i);
    if (escape) {
      result += ch;
      escape = false;
    } else if (ch === '\\') {
      result += ch;
      escape = true;
    } else if (ch === '"') {
      result += ch;
      inString = !inString;
    } else if (inString && code < 32) {
      if (code === 9 || code === 10 || code === 13) {
        result += ' ';
      }
      // skip other control chars
    } else {
      result += ch;
    }
  }

  return JSON.parse(result);
}

async function generateArticle(cat) {
  const prompt = buildPrompt(cat, today);
  const text = await callGemini(prompt);
  console.log('Response for', cat.id, '- length:', text.length);

  const article = cleanAndParseJSON(text);

  // Add ruby tags from reading field
  if (article.vocabulary) {
    for (const v of article.vocabulary) {
      if (v.word && v.reading) {
        v.word = '<ruby>' + v.word + '<rt>' + v.reading + '</rt></ruby>';
      }
    }
  }

  return article;
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
  fs.writeFileSync('today.json', JSON.stringify(output, null, 2));
  console.log('\nSaved today.json with', articles.length, 'articles for', today);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
