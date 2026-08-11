// Top Marketing · AI-Visibility Scanner — backend
// Реальна перевірка згадки бренду в ChatGPT, Gemini і Perplexity.
//
// Запуск локально:
//   1) npm install
//   2) скопіюйте .env.example у .env і впишіть свої ключі
//   3) npm start
//   Сервер підніметься на http://localhost:8787
//
// Деплой: будь-який Node-хостинг (Render, Railway, VPS, Fly.io).
// ВАЖЛИВО: ключі ніколи не повинні потрапити у фронтенд-код.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'AI-Visibility Scanner backend',
    note: 'Це бекенд без власного інтерфейсу. Перевірка стану: /api/health. Сам сканер працює на окремій сторінці (ai-visibility-scanner.html), яка звертається сюди.',
    endpoints: ['GET /api/health', 'POST /api/scan', 'POST /api/lead', 'GET /api/leads']
  });
});

const PORT = process.env.PORT || 8787;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Модель Claude. Актуальні назви моделей дивіться в docs.claude.com —
// на момент написання: claude-sonnet-5 (баланс), claude-haiku-4-5-20251001 (дешевше/швидше).
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// "Зона невидимості" — скільки нішевих запитів ставити і яким системам.
// Кожен запит іде в кожен обраний engine, і якщо бренд не згадано —
// робиться додатковий виклик Claude, щоб витягти імена конкурентів.
// Тримайте це число невеликим — це прямо впливає на кількість платних
// викликів API за один скан (queries × engines × ~2).
const DISCOVERY_QUERY_COUNT = Number(process.env.DISCOVERY_QUERY_COUNT || 3);
const DISCOVERY_ENGINES = (process.env.DISCOVERY_ENGINES || 'chatgpt,gemini,perplexity,claude')
  .split(',').map(s => s.trim()).filter(Boolean);

// Куди йдуть ліди (контакти, залишені за розблокування повного звіту).
// LEAD_WEBHOOK_URL — необов'язково: якщо задано, кожен лід додатково
// відправляється туди POST-запитом (наприклад, у Telegram-бота через
// сервіс-посередник типу Make/Zapier, у Google Sheets через Apps Script
// вебхук, чи в будь-яку CRM з прийомом вебхуків).
const LEAD_WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || '';
const LEADS_FILE = path.join(process.cwd(), 'leads.jsonl');

// ---------- Допоміжне ----------

function buildQueries(brand, niche) {
  const nicheClause = niche ? niche : 'у цій ніші';
  return [
    `Порадь кілька найкращих варіантів: ${nicheClause}. Дай список із коротким поясненням по кожному.`,
    `Хто топ-3 у сфері «${nicheClause}»? Порівняй їх коротко.`
  ];
}

// Запити без згадки бренду — так реально формулює клієнт, коли не знає,
// кого шукає. Саме за ними видно, кого AI називає замість вас.
function buildDiscoveryQueries(niche) {
  const n = niche && niche.trim() ? niche.trim() : null;
  if (!n) return [];
  const templates = [
    `Порадь кілька найкращих варіантів: ${n}. Назви конкретні компанії чи бренди.`,
    `Де знайти або замовити ${n}? Порадь 3-5 конкретних варіантів.`,
    `Хто топові гравці у сфері «${n}»? Перелічи компанії чи бренди.`
  ];
  return templates.slice(0, Math.max(1, Math.min(DISCOVERY_QUERY_COUNT, templates.length)));
}

function checkMention(text, brand) {
  if (!text || !brand) return { hit: false, snippet: '' };
  const normalizedText = text.toLowerCase();
  const normalizedBrand = brand.toLowerCase().trim();
  const hit = normalizedText.includes(normalizedBrand);
  let snippet = '';
  if (hit) {
    const idx = normalizedText.indexOf(normalizedBrand);
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + normalizedBrand.length + 80);
    snippet = (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }
  return { hit, snippet };
}

// ---------- Виклики AI-систем ----------

async function askChatGPT(query) {
  if (!OPENAI_API_KEY) return { error: 'OPENAI_API_KEY не налаштовано' };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: query }],
      max_tokens: 500
    })
  });
  if (!res.ok) return { error: `OpenAI HTTP ${res.status}` };
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content || '' };
}

async function askGemini(query) {
  if (!GEMINI_API_KEY) return { error: 'GEMINI_API_KEY не налаштовано' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: query }] }]
    })
  });
  if (!res.ok) return { error: `Gemini HTTP ${res.status}` };
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ') || '';
  return { text };
}

async function askPerplexity(query) {
  if (!PERPLEXITY_API_KEY) return { error: 'PERPLEXITY_API_KEY не налаштовано' };
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: query }]
    })
  });
  if (!res.ok) return { error: `Perplexity HTTP ${res.status}` };
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content || '' };
}

async function askClaude(query) {
  if (!ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY не налаштовано' };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: query }]
    })
  });
  if (!res.ok) return { error: `Claude HTTP ${res.status}` };
  const data = await res.json();
  const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
  return { text };
}

// ---------- Основний ендпоінт ----------

const ENGINE_CALLERS = {
  chatgpt: askChatGPT,
  gemini: askGemini,
  perplexity: askPerplexity,
  claude: askClaude
};

// Просить Claude знайти РЕАЛЬНИХ гравців ринку через вбудований інструмент
// веб-пошуку — це вже не здогадка з чужої відповіді, а фактичний пошук
// в інтернеті на момент сканування.
async function findRealCompetitors(query, brand) {
  if (!ANTHROPIC_API_KEY) return { competitors: [], error: 'ANTHROPIC_API_KEY не налаштовано' };

  const prompt = `Використай пошук в інтернеті, щоб знайти реальних, актуальних гравців ринку, ` +
    `які підходять під запит клієнта: "${query}". Перевір через пошук, а не з памʼяті. ` +
    `Поверни ЛИШЕ JSON-масив назв компаній чи брендів (до 8 штук), без будь-яких пояснень до чи ` +
    `після масиву. Виключи бренд "${brand}", якщо він там зустрічається.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!res.ok) return { competitors: [], error: `Claude+search HTTP ${res.status}` };
    const data = await res.json();
    const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const competitors = arr
      .filter(n => typeof n === 'string' && n.trim() && n.toLowerCase() !== brand.toLowerCase())
      .slice(0, 8);
    return { competitors };
  } catch (err) {
    return { competitors: [], error: String(err) };
  }
}

async function runDiscoveryQuery(query, brand) {
  const engineResults = {};
  const rawTexts = [];

  await Promise.all(DISCOVERY_ENGINES.map(async (key) => {
    const caller = ENGINE_CALLERS[key];
    if (!caller) return;
    const resp = await caller(query).catch(e => ({ error: String(e) }));
    if (resp.error) {
      engineResults[key] = { error: resp.error };
      return;
    }
    const mentionedBrand = resp.text.toLowerCase().includes(brand.toLowerCase());
    engineResults[key] = { mentionedBrand };
    rawTexts.push(resp.text);
  }));

  let competitors = [];
  let competitorsSource = 'search';
  const searchResult = await findRealCompetitors(query, brand);

  if (searchResult.competitors.length) {
    competitors = searchResult.competitors;
  } else if (searchResult.error) {
    // Фолбек, якщо пошук недоступний (немає ключа, ліміт і т.д.) —
    // груба евристика по капіталізованих словах із сирих відповідей.
    competitorsSource = 'fallback';
    const matches = rawTexts.join(' ').match(/[A-ZА-ЯЁІЇЄҐ][a-zа-яёіїєґ'’\-]{2,}(?:\.[a-zа-яёіїєґ]{2,4})?/g) || [];
    competitors = [...new Set(matches)].filter(w => w.toLowerCase() !== brand.toLowerCase()).slice(0, 6);
  }

  return { query, engines: engineResults, competitors, competitorsSource };
}

app.post('/api/scan', async (req, res) => {
  try {
    const { brand, niche } = req.body || {};
    if (!brand || typeof brand !== 'string') {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }

    const [query] = buildQueries(brand, niche);

    const [chatgpt, gemini, perplexity, claude] = await Promise.all([
      askChatGPT(query).catch(e => ({ error: String(e) })),
      askGemini(query).catch(e => ({ error: String(e) })),
      askPerplexity(query).catch(e => ({ error: String(e) })),
      askClaude(query).catch(e => ({ error: String(e) }))
    ]);

    const discoveryQueries = buildDiscoveryQueries(niche);
    const zoneOfInvisibility = await Promise.all(
      discoveryQueries.map(q => runDiscoveryQuery(q, brand))
    );

    const result = {
      query,
      engines: {
        chatgpt: chatgpt.error ? { error: chatgpt.error } : checkMention(chatgpt.text, brand),
        gemini: gemini.error ? { error: gemini.error } : checkMention(gemini.text, brand),
        perplexity: perplexity.error ? { error: perplexity.error } : checkMention(perplexity.text, brand),
        claude: claude.error ? { error: claude.error } : checkMention(claude.text, brand)
      },
      zoneOfInvisibility
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Приймає контакт, залишений за розблокування повного звіту.
app.post('/api/lead', async (req, res) => {
  try {
    const { name, contact, brand, niche, score } = req.body || {};
    if (!contact || typeof contact !== 'string' || !contact.trim()) {
      return res.status(400).json({ error: 'Поле "contact" обовʼязкове' });
    }

    const lead = {
      name: (name || '').trim(),
      contact: contact.trim(),
      brand: (brand || '').trim(),
      niche: (niche || '').trim(),
      score: typeof score === 'number' ? score : null,
      ts: new Date().toISOString()
    };

    try {
      fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
    } catch (e) {
      console.warn('Не вдалось записати лід у файл:', e);
    }

    if (LEAD_WEBHOOK_URL) {
      fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      }).catch(e => console.warn('Помилка відправки на LEAD_WEBHOOK_URL:', e));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Дає подивитись зібрані ліди прямо з файлу (для перевірки чи невеликих обсягів).
// В проді краще захистити цей роут паролем/токеном або взагалі прибрати,
// покладаючись лише на LEAD_WEBHOOK_URL.
app.get('/api/leads', (req, res) => {
  try {
    if (!fs.existsSync(LEADS_FILE)) return res.json({ leads: [] });
    const lines = fs.readFileSync(LEADS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const leads = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ leads });
  } catch (err) {
    res.status(500).json({ error: 'Не вдалось прочитати ліди' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    keys: {
      openai: Boolean(OPENAI_API_KEY),
      gemini: Boolean(GEMINI_API_KEY),
      perplexity: Boolean(PERPLEXITY_API_KEY),
      anthropic: Boolean(ANTHROPIC_API_KEY)
    }
  });
});

app.listen(PORT, () => {
  console.log(`AI-Visibility backend running on http://localhost:${PORT}`);
});
