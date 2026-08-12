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
import PDFDocument from 'pdfkit';

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
// Gemini API models get deprecated/shut down fairly often — gemini-1.5-flash
// no longer exists as of 2026. Override via GEMINI_MODEL if this goes stale too.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

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

// Пошта для PDF-звіту. Resend — простий email-API (POST-запит з JSON,
// без SMTP-налаштувань). Безкоштовний акаунт на resend.com,
// FROM-адреса має бути з домену, підтвердженого у Resend (або тестова
// onboarding@resend.dev — працює одразу, але лише для швидкого старту).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'AI-Visibility <onboarding@resend.dev>';

// ---------- Допоміжне ----------

function buildQueries(brand, niche) {
  const nicheClause = niche ? ` (${niche})` : '';
  return [
    `Що ти знаєш про компанію чи бренд "${brand}"${nicheClause}? Якщо чув про неї — розкажи коротко, чим вона займається. Якщо не чув — так і скажи.`,
    `Чи знайома тобі назва "${brand}"${nicheClause}? Опиши, що знаєш.`
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

// Проста перевірка збігу назви — потрібна лише для витягу цитати
// (snippet), сам вердикт тепер визначає classifyMention нижче.
// Якщо бренд введено як URL (напр. https://site.ua/), звичайний
// AI-текст ніколи не міститиме цей рядок дослівно з протоколом і
// слешем — тому пробуємо кілька варіантів: повний рядок, домен без
// протоколу, і саму назву без домену верхнього рівня.
function brandMatchCandidates(brand) {
  const raw = brand.trim();
  const candidates = new Set([raw.toLowerCase()]);
  const cleaned = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (cleaned) {
    candidates.add(cleaned.toLowerCase());
    const host = cleaned.split('/')[0];
    candidates.add(host.toLowerCase());
    const namePart = host.split('.')[0];
    if (namePart && namePart.length > 2) candidates.add(namePart.toLowerCase());
  }
  return [...candidates].filter(Boolean);
}

function findSnippet(text, brand) {
  const normalizedText = text.toLowerCase();
  for (const candidate of brandMatchCandidates(brand)) {
    const idx = normalizedText.indexOf(candidate);
    if (idx !== -1) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + candidate.length + 80);
      return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
    }
  }
  return '';
}

// Оцінює ЯКІСТЬ згадки бренду через окремий класифікаційний виклик
// Claude — три стани замість простого "є підрядок / немає":
//   know     — впевнено й конкретно знає саме цей бренд
//   confused — щось невиразне: натяк, невпевненість, плутанина зі схожою назвою
//   unknown  — жодної згадки чи натяку
async function classifyMention(text, brand) {
  if (!ANTHROPIC_API_KEY) return { verdict: null, error: 'ANTHROPIC_API_KEY не налаштовано' };
  if (!text) return { verdict: 'unknown' };

  const prompt = `Ось відповідь AI-асистента на запит користувача, який шукав інформацію про бренд/компанію "${brand}". ` +
    `Оціни, наскільки явно і точно асистент знає саме цей бренд:\n` +
    `- know — впевнено й конкретно згадує саме цей бренд/сайт по суті\n` +
    `- confused — щось невиразне: натяки, невпевненість, плутанина зі схожою назвою, загальна відповідь без явного знання\n` +
    `- unknown — жодної згадки чи натяку\n\n` +
    `Дай відповідь ЛИШЕ одним словом: know, confused або unknown. Без пояснень.\n\n` +
    `Відповідь AI:\n"""${text}"""`;

  const res = await askClaude(prompt);
  if (res.error || !res.text) return { verdict: null, error: res.error || 'порожня відповідь класифікатора' };

  const word = res.text.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (word === 'know' || word === 'confused' || word === 'unknown') return { verdict: word };
  if (word.includes('know')) return { verdict: 'know' };
  if (word.includes('confus')) return { verdict: 'confused' };
  if (word.includes('unknown')) return { verdict: 'unknown' };
  return { verdict: null, error: `незрозуміла відповідь класифікатора: "${res.text.slice(0,60)}"` };
}

// Проста детермінована оцінка "впевненості" 0-100 по довжині й
// конкретності цитати — навмисно БЕЗ додаткового виклику AI (дешево,
// швидко, відтворювано). Це не окрема "методологія", а прозора евристика:
// довша й конкретніша згадка = вища оцінка.
function engineConfidenceScore(verdict, snippet) {
  if (verdict === 'unknown') return 0;
  const len = (snippet || '').length;
  const base = verdict === 'know' ? 55 : 20;
  const bonus = Math.min(40, Math.round(len / 4));
  return Math.min(100, base + bonus);
}

async function checkMention(text, brand) {
  if (!text || !brand) return { verdict: 'unknown', hit: false, snippet: '', score: 0 };

  const snippetFromText = findSnippet(text, brand);
  if (snippetFromText) {
    // Пряма текстова згадка бренду — найсильніший можливий сигнал,
    // довіряємо йому напряму й не витрачаємо виклик на класифікатор.
    return { verdict: 'know', hit: true, snippet: snippetFromText, score: engineConfidenceScore('know', snippetFromText) };
  }

  // Прямої згадки немає — питаємо класифікатор, чи це "плутає" щось
  // невиразне/схоже, чи справді "не чув" взагалі про бренд.
  const classification = await classifyMention(text, brand);
  let verdict = classification.verdict;
  if (!verdict) {
    verdict = 'unknown'; // класифікатор недоступний — чесний дефолт без прямої згадки
  } else if (verdict === 'know') {
    // Без прямого підрядка "впевнене знання" неможливе за визначенням —
    // найбільше, що це може бути, це непряма/невиразна згадка.
    verdict = 'confused';
  }

  const snippet = verdict !== 'unknown'
    ? text.trim().slice(0, 160) + (text.length > 160 ? '…' : '')
    : '';

  return { verdict, hit: false, snippet, score: engineConfidenceScore(verdict, snippet), classifierError: classification.error || null };
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
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`askChatGPT: HTTP ${res.status} — ${bodyText}`);
    return { error: `OpenAI HTTP ${res.status}`, detail: bodyText.slice(0, 300) };
  }
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content || '' };
}

async function askGemini(query) {
  if (!GEMINI_API_KEY) return { error: 'GEMINI_API_KEY не налаштовано' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: query }] }]
    })
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`askGemini: HTTP ${res.status} — ${bodyText}`);
    return { error: `Gemini HTTP ${res.status}`, detail: bodyText.slice(0, 300) };
  }
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
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`findRealCompetitors: Claude HTTP ${res.status} — ${bodyText}`);
      return { competitors: [], error: `Claude+search HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    }
    const data = await res.json();
    const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
    if (!text) {
      console.warn('findRealCompetitors: порожня текстова відповідь. Повний content:', JSON.stringify(data?.content));
    }
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const competitors = arr
      .filter(n => typeof n === 'string' && n.trim() && n.toLowerCase() !== brand.toLowerCase())
      .slice(0, 8);
    return { competitors };
  } catch (err) {
    console.error('findRealCompetitors: виняток', err);
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
    const mentionedBrand = Boolean(findSnippet(resp.text, brand));
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

    const [chatgptVerdict, geminiVerdict, perplexityVerdict, claudeVerdict] = await Promise.all([
      chatgpt.error ? Promise.resolve({ error: chatgpt.error }) : checkMention(chatgpt.text, brand),
      gemini.error ? Promise.resolve({ error: gemini.error }) : checkMention(gemini.text, brand),
      perplexity.error ? Promise.resolve({ error: perplexity.error }) : checkMention(perplexity.text, brand),
      claude.error ? Promise.resolve({ error: claude.error }) : checkMention(claude.text, brand)
    ]);

    const result = {
      query,
      engines: {
        chatgpt: chatgptVerdict,
        gemini: geminiVerdict,
        perplexity: perplexityVerdict,
        claude: claudeVerdict
      },
      zoneOfInvisibility
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// ---------- Гранулярні ендпоінти для живого прогресу сканування ----------
// Той самий результат, що й /api/scan, але розбитий на окремі виклики —
// фронтенд робить кілька паралельних запитів і оновлює статус кожного
// кроку по мірі того, як він реально завершується.

app.post('/api/scan-engine', async (req, res) => {
  try {
    const { brand, niche, engine } = req.body || {};
    if (!brand || typeof brand !== 'string') {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }
    const caller = ENGINE_CALLERS[engine];
    if (!caller) {
      return res.status(400).json({ error: `Невідома система: ${engine}` });
    }
    const [query] = buildQueries(brand, niche);
    const resp = await caller(query).catch(e => ({ error: String(e) }));
    if (resp.error) {
      return res.json({ error: resp.error });
    }
    res.json(await checkMention(resp.text, brand));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Повертає лише текст нішевих запитів (без виконання) — щоб фронтенд міг
// одразу намалювати список кроків прогресу, ще до того, як почнеться сам
// пошук.
app.post('/api/discovery-queries', (req, res) => {
  const { niche } = req.body || {};
  res.json({ queries: buildDiscoveryQueries(niche) });
});

app.post('/api/zone-query', async (req, res) => {
  try {
    const { brand, query } = req.body || {};
    if (!brand || typeof brand !== 'string') {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Поле "query" обовʼязкове' });
    }
    const result = await runDiscoveryQuery(query, brand);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Приймає контакт, залишений за розблокування повного звіту.

// Формує PDF-звіт із даних скану, які прислав фронтенд (той самий скан,
// що вже показаний на сторінці — тут нічого заново не рахується).
function buildReportPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).fillColor('#14181d').text('AI-Видимість — детальний звіт', { align: 'left' });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#888').text('Top Marketing · topmarketing.com.ua');
      doc.moveDown();

      doc.fontSize(11).fillColor('#333');
      doc.text(`Бренд: ${data.brand || '—'}`);
      if (data.niche) doc.text(`Ніша / місто: ${data.niche}`);
      doc.text(`Дата перевірки: ${new Date().toLocaleDateString('uk-UA')}`);
      doc.moveDown();

      doc.fontSize(16).fillColor('#14181d').text(`Загальний бал: ${data.score ?? '—'} / 100`);
      doc.moveDown();

      doc.fontSize(14).fillColor('#14181d').text('Результати по AI-системах');
      doc.moveDown(0.3);
      (data.engines || []).forEach(e => {
        const verdictLabels = { know: 'ЗНАЄ бренд', confused: 'ПЛУТАЄ (невпевнено/схоже)', unknown: 'НЕ ЧУВ про бренд' };
        const verdict = e.error ? 'недоступно під час перевірки' : (verdictLabels[e.verdict] || (e.hit ? 'ЗНАЄ бренд' : 'НЕ ЧУВ про бренд'));
        doc.fontSize(11).fillColor('#14181d').text(`${e.label}: ${verdict}`);
        if (e.snippet) doc.fontSize(10).fillColor('#666').text(`   «${e.snippet}»`);
        doc.moveDown(0.2);
      });
      doc.moveDown(0.5);

      if ((data.zoneOfInvisibility || []).length) {
        doc.fontSize(14).fillColor('#14181d').text('Зона невидимості — реальні гравці ринку по запитах');
        doc.moveDown(0.3);
        data.zoneOfInvisibility.forEach((zq, i) => {
          doc.fontSize(11).fillColor('#14181d').text(`${i + 1}. ${zq.query}`);
          const comp = (zq.competitors || []).join(', ');
          doc.fontSize(10).fillColor('#666').text(comp ? `    Знайдені гравці: ${comp}` : '    Явних гравців пошук не знайшов — полиця відносно вільна.');
          doc.moveDown(0.2);
        });
        doc.moveDown(0.5);
      }

      if ((data.issues || []).length) {
        doc.fontSize(14).fillColor('#14181d').text('Що знижує сигнал просто зараз');
        doc.moveDown(0.3);
        data.issues.forEach(txt => {
          doc.fontSize(11).fillColor('#14181d').text(`•  ${txt}`);
        });
        doc.moveDown(0.5);
      }

      doc.moveDown();
      doc.fontSize(11).fillColor('#333').text(
        'Наступний крок: команда Top Marketing допоможе перетворити ці дані на послідовний план ' +
        'підвищення AI-видимості вашого бренду. Ми звʼяжемось з вами найближчим часом.'
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function sendReportEmail(toEmail, pdfBuffer, meta) {
  if (!RESEND_API_KEY) return { sent: false, error: 'RESEND_API_KEY не налаштовано' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [toEmail],
        subject: `AI-Видимість: детальний звіт для ${meta.brand || 'вашого бренду'}`,
        html: `<p>Вітаємо!</p><p>У вкладенні — детальний звіт AI-видимості для <b>${meta.brand || ''}</b>.</p>` +
          `<p>Команда Top Marketing зв'яжеться з вами найближчим часом щодо консультації.</p>`,
        attachments: [
          {
            filename: 'ai-visibility-report.pdf',
            content: pdfBuffer.toString('base64')
          }
        ]
      })
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`sendReportEmail: Resend HTTP ${res.status} — ${bodyText}`);
      return { sent: false, error: `Resend HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('sendReportEmail: виняток', err);
    return { sent: false, error: String(err) };
  }
}

app.post('/api/lead', async (req, res) => {
  try {
    const { name, phone, email, brand, niche, score, engines, zoneOfInvisibility, issues } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Поле "email" обовʼязкове' });
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Поле "phone" обовʼязкове' });
    }

    const lead = {
      name: (name || '').trim(),
      phone: phone.trim(),
      email: email.trim(),
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

    let emailResult = { sent: false, error: 'RESEND_API_KEY не налаштовано' };
    try {
      const pdfBuffer = await buildReportPdf({
        brand: lead.brand, niche: lead.niche, score: lead.score, engines, zoneOfInvisibility, issues
      });
      emailResult = await sendReportEmail(lead.email, pdfBuffer, lead);
    } catch (err) {
      console.error('Генерація/відправка PDF-звіту не вдалась:', err);
      emailResult = { sent: false, error: String(err) };
    }

    res.json({ ok: true, emailSent: emailResult.sent, emailError: emailResult.error || null });
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

// Швидка перевірка веб-пошуку окремо від повного /api/scan.
// Приклад: GET /api/debug-search?niche=performance-маркетинг,%20Київ&brand=Top%20Marketing
app.get('/api/debug-search', async (req, res) => {
  const niche = req.query.niche || 'performance-маркетинг, Київ';
  const brand = req.query.brand || 'Тестовий Бренд';
  const query = `Порадь кілька найкращих варіантів: ${niche}. Назви конкретні компанії чи бренди.`;
  const result = await findRealCompetitors(query, brand);
  res.json({ query, ...result });
});

// Показує СИРИЙ текст відповіді конкретної системи поруч із тим, що
// checkMention з нього виснував — щоб бачити, чому вердикт саме такий,
// а не гадати наосліп.
// Приклад: GET /api/debug-mention?brand=Top%20Marketing&niche=маркетинг,%20Київ&engine=chatgpt
app.get('/api/debug-mention', async (req, res) => {
  try {
    const brand = req.query.brand || 'Тестовий Бренд';
    const niche = req.query.niche || '';
    const engine = req.query.engine || 'chatgpt';
    const caller = ENGINE_CALLERS[engine];
    if (!caller) return res.status(400).json({ error: `Невідома система: ${engine}` });

    const [query] = buildQueries(brand, niche);
    const resp = await caller(query).catch(e => ({ error: String(e) }));
    if (resp.error) return res.json({ query, error: resp.error });

    const result = await checkMention(resp.text, brand);
    res.json({
      query,
      brand,
      rawText: resp.text,
      matchCandidates: brandMatchCandidates(brand),
      result
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
