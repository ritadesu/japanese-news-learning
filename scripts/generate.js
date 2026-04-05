const https = require('https');
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;
const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today = now.getFullYear() + '\u5e74' +
  String(now.getMonth() + 1).padStart(2, '0') + '\u6708' +
  String(now.getDate()).padStart(2, '0') + '\u65e5';

console.log('Generating news for:', today);

const categories = [
  { id: 'tech',        name: '\u30c6\u30af\u30ce\u30ed\u30b8\u30fc' },
  { id: 'urban',       name: '\u90fd\u5e02\u66f4\u65b0' },
  { id: 'realestate',  name: '\u4e0d\u52d5\u7523\u5e02\u5834' },
  { id: 'economy',     name: '\u7d4c\u6e08' },
  { id: 'agri',        name: '\u8fb2\u696d' }
];

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.5,
        responseMimeType: 'application/json'
      }
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
          reject(new Error('Parse error: ' + e.message + ' | Raw: ' + data.slice(0, 500)));
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

function buildPrompt(catId, catName, today) {
  return '\u3042\u306a\u305f\u306f\u65e5\u672c\u8a9e\u6559\u80b2\u306e\u5c02\u9580\u5bb6\u3067\u3059\u3002' +
    today + '\u3053\u308d\u306e\u65e5\u672c\u306e' + catName + '\u306b\u95a2\u3059\u308b\u30cb\u30e5\u30fc\u30b9\u3092\u57fa\u306b\u3001' +
    '\u53f0\u6e7e\u4eba\u5b66\u7fd2\u8005\u5411\u3051\u306eN2\u30ec\u30d9\u30eb\u306e\u5b66\u7fd2\u30b3\u30f3\u30c6\u30f3\u30c4\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\n' +
    '\u4ee5\u4e0b\u306eJSON\u5f62\u5f0f\u3067\u56de\u7b54\u3057\u3066\u304f\u3060\u3055\u3044\uff1a\n' +
    '{\n' +
    '  "category": "' + catId + '",\n' +
    '  "titleJp": "\u30cb\u30e5\u30fc\u30b9\u898b\u51fa\u3057\uff08\u6f22\u5b57\u306b\u8aad\u307f\u304c\u306a\u3092\u62ec\u5f27\u3067\uff1a\u6771\u4eac\uff08\u3068\u3046\u304d\u3087\u3046\uff09\uff09",\n' +
    '  "titleZh": "\u4e2d\u6587\u7ffb\u8b6f",\n' +
    '  "summaryJp": "3\u6587\u306e\u8981\u7d04\u3002\u6f22\u5b57\u306b\u8aad\u307f\u304c\u306a\u3092\u62ec\u5f27\u3067\u4ed8\u3051\u308b\u3002",\n' +
    '  "summaryZh": "\u4e2d\u6587\u6458\u8981",\n' +
    '  "source": "\u30e1\u30c7\u30a3\u30a2\u540d",\n' +
    '  "vocabulary": [\n' +
    '    {"word": "\u5358\u8a9e1", "reading": "\u8aad\u307f1", "meaning": "\u4e2d\u6587\u610f\u601d1", "example": "\u4f8b\u6587\uff08\u8aad\u307f\u4ed8\u304d\uff09"},\n' +
    '    {"word": "\u5358\u8a9e2", "reading": "\u8aad\u307f2", "meaning": "\u4e2d\u6587\u610f\u601d2", "example": "\u4f8b\u6587"},\n' +
    '    {"word": "\u5358\u8a9e3", "reading": "\u8aad\u307f3", "meaning": "\u4e2d\u6587\u610f\u601d3", "example": "\u4f8b\u6587"},\n' +
    '    {"word": "\u5358\u8a9e4", "reading": "\u8aad\u307f4", "meaning": "\u4e2d\u6587\u610f\u601d4", "example": "\u4f8b\u6587"},\n' +
    '    {"word": "\u5358\u8a9e5", "reading": "\u8aad\u307f5", "meaning": "\u4e2d\u6587\u610f\u601d5", "example": "\u4f8b\u6587"}\n' +
    '  ],\n' +
    '  "grammarPoints": [\n' +
    '    {"pattern": "\uff5e\u30d1\u30bf\u30fc\u30f31", "meaning": "\u4e2d\u6587\u8aac\u660e1", "example": "\u4f8b\u6587", "exampleZh": "\u7ffb\u8b6f"},\n' +
    '    {"pattern": "\uff5e\u30d1\u30bf\u30fc\u30f32", "meaning": "\u4e2d\u6587\u8aac\u660e2", "example": "\u4f8b\u6587", "exampleZh": "\u7ffb\u8b6f"},\n' +
    '    {"pattern": "\uff5e\u30d1\u30bf\u30fc\u30f33", "meaning": "\u4e2d\u6587\u8aac\u660e3", "example": "\u4f8b\u6587", "exampleZh": "\u7ffb\u8b6f"}\n' +
    '  ],\n' +
    '  "keySentences": [\n' +
    '    {"jp": "\u30ad\u30fc\u30bb\u30f3\u30c6\u30f3\u30b91\uff08\u8aad\u307f\u4ed8\u304d\uff09", "zh": "\u7ffb\u8b6f1", "note": "\u89e3\u8aac1"},\n' +
    '    {"jp": "\u30ad\u30fc\u30bb\u30f3\u30c6\u30f3\u30b92", "zh": "\u7ffb\u8b6f2", "note": "\u89e3\u8aac2"},\n' +
    '    {"jp": "\u30ad\u30fc\u30bb\u30f3\u30c6\u30f3\u30b93", "zh": "\u7ffb\u8b6f3", "note": "\u89e3\u8aac3"}\n' +
    '  ]\n' +
    '}\n\n' +
    '\u5168\u30d5\u30a3\u30fc\u30eb\u30c9\u3092\u5b9f\u969b\u306e\u30b3\u30f3\u30c6\u30f3\u30c4\u3067\u57cb\u3081\u3066\u304f\u3060\u3055\u3044\u3002JSON\u306e\u307f\u51fa\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
}

function cleanAndParseJSON(text) {
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```$/gm, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('No JSON found. Text: ' + text.slice(0, 200));
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
    else if (inString && code < 32) { if (code === 9 || code === 10 || code === 13) result += ' '; }
    else result += ch;
  }
  return JSON.parse(result);
}

async function generateArticle(cat) {
  const prompt = buildPrompt(cat.id, cat.name, today);
  const text = await callGemini(prompt);
  console.log('Response for', cat.id, '- length:', text.length);
  if (text.length < 200) {
    console.log('Short response content:', text);
  }
  const article = cleanAndParseJSON(text);
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

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
