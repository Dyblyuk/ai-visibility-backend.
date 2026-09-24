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
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drawRecommendations } from './recommendation-pdf.js';
import {queryPlanPrompt,parseQueryPlan} from './query-planner.js';
import {fetchSiteContext} from './website-context.js';
import {fetchWithDeadline,singleFlight} from './ai-runtime.js';
import {knowledgePrompt,parseKnowledge} from './knowledge-analysis.js';
import { createReportStore, validReportToken } from './report-store.js';
import { targetIdentity, extractionPrompt, parseExtraction, validateAnswer, summarizeRecommendations, enrichReport, recommendationSummary, knowledgeScore } from './recommendation-analysis.js';

// Файли розсилки тримаємо лише в пам'яті (не на диску) — вони одразу
// йдуть у Telegram і більше не потрібні. 20 МБ — з запасом під фото й
// короткі відео, залишаючись у безпечних межах пам'яті Render free tier.
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

dotenv.config();

const reportStore = await createReportStore(process.env.REPORT_DATABASE_URL);
if (!reportStore.durable) console.warn('Reports use temporary memory: configure REPORT_DATABASE_URL for persistence');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// A stable URL is backed by the database, not Render's ephemeral filesystem.
app.get('/reports/:filename', async (req, res) => {
  const token = req.params.filename.replace(/\.pdf$/, '');
  if (!req.params.filename.endsWith('.pdf') || !validReportToken(token)) return res.sendStatus(404);
  try {
    const pdf = await reportStore.getPdf(token);
    if (!pdf) return res.sendStatus(404);
    const report = await reportStore.get(token);
    const brand = String(report?.brand || 'Report').replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]/gu, '-').slice(0,80);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `attachment; filename="Top-Marketing-AI-Visibility.pdf"; filename*=UTF-8''${encodeURIComponent('Top-Marketing-AI-Visibility-' + brand + '.pdf')}`);
    res.type('pdf').send(pdf);
  } catch (error) {
    console.error('Report download failed:', error.message);
    res.status(503).json({ ok: false, error: 'Звіт тимчасово недоступний. Спробуйте ще раз.' });
  }
});

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
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'claude-haiku-4-5-20251001';
const PROVIDER_TIMEOUT_MS = 25000;
const ANALYSIS_TIMEOUT_MS = 12000;
const PLAN_TIMEOUT_MS = 14000;
const inFlight = singleFlight();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Вимкніть на 'false', якщо квота на веб-пошук Gemini постійно впирається
// в 429 навіть із підключеним білінгом — тоді Gemini відповідатиме з
// пам'яті моделі, без пошуку, але й без помилок.
const GEMINI_USE_SEARCH = (process.env.GEMINI_USE_SEARCH || 'true') !== 'false';
// ChatGPT через Responses API з веб-пошуком. Точні назви моделі й типу
// інструменту в OpenAI змінюються — якщо почне падати з помилкою про
// невідому модель чи tool type, звірте з поточною документацією
// developers.openai.com/api/docs/guides/tools-web-search і поправте тут.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_WEB_SEARCH_TOOL = process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search_preview';

// "Зона невидимості" — скільки нішевих запитів ставити і яким системам.
// Кожен запит іде в кожен обраний engine, і якщо бренд не згадано —
// робиться додатковий виклик Claude, щоб витягти імена конкурентів.
// Тримайте це число невеликим — це прямо впливає на кількість платних
// викликів API за один скан (queries × engines × ~2).
const DISCOVERY_QUERY_COUNT = Math.max(3,Math.min(6,Number(process.env.DISCOVERY_QUERY_COUNT) || 5));
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

function buildQueries(brand, niche, website = '') {
  const nicheClause = `${niche ? ` (${niche})` : ''}${website ? `, офіційний сайт ${website}. Йдеться саме про цю компанію, не про однойменні бренди` : ''}`;
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
  // Різні формулювання — так реально гуглять і питають AI: хтось шукає
  // "найкращі варіанти", хтось "де замовити", хтось перевіряє відгуки.
  // Ширший набір формулювань ловить більше реальних клієнтських фраз.
  const templates = [
    `Порадь кілька найкращих варіантів: ${n}. Назви конкретні компанії чи бренди.`,
    `Де знайти або замовити ${n}? Порадь 3-5 конкретних варіантів.`,
    `Хто топові гравці у сфері «${n}»? Перелічи компанії чи бренди.`,
    `Хто надає послуги «${n}» з хорошими відгуками? Порадь перевірені варіанти.`,
    `Порівняй кілька компаній у сфері «${n}» — кого порадиш і чому?`,
    `Яку компанію обрати для «${n}»? Дай конкретні назви з коротким поясненням.`
  ];
  return templates.slice(0, Math.max(1, Math.min(DISCOVERY_QUERY_COUNT, templates.length)))
    .map(query => query + ' Для кожного варіанта коротко поясни вибір і вкажи офіційний сайт, якщо знаєш. Відповідай українською.');
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

// Схоже на URL/домен? (напр. "topmarketing.com.ua", "https://webpromo.ua")
function looksLikeUrl(brand) {
  return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/.*)?$/i.test(brand.trim());
}

// ---- Валідація телефону/email проти явно вигаданих чи сміттєвих даних ----
// Список одноразових/сміттєвих поштових сервісів — не вичерпний, але
// покриває найпоширеніші. Легко доповнити за потреби.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'yopmail.com', 'throwawaymail.com',
  'trashmail.com', 'fakeinbox.com', 'getnada.com', 'sharklasers.com',
  'dispostable.com', 'mintemail.com', 'mohmal.com', 'moakt.com',
  'emailondeck.com', 'maildrop.cc', 'tempinbox.com', 'spamgourmet.com',
  'burnermail.io', 'inboxbear.com', 'mailnesia.com', 'mailcatch.com',
  'discard.email', 'discardmail.com', 'tempr.email', 'fakemail.net',
  'test.com', 'example.com', 'example.org', 'example.net', 'test.ua', 'test.ru'
]);

function isValidEmailStrict(email) {
  const trimmed = (email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return { ok: false, reason: 'Некоректний формат email' };

  const [localPart, domainRaw] = trimmed.split('@');
  const domain = domainRaw.toLowerCase();

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, reason: 'Схоже на одноразову/тестову поштову адресу' };
  }
  // Явно вигадані пари на кшталт test@test.com, asdf@asdf.com, aaa@aaa.com
  const domainName = domain.split('.')[0];
  if (localPart.toLowerCase() === domainName && /^(test|asdf|aaa|abc|qwerty|admin|user|noone|nobody|fake|spam|xxx)$/i.test(localPart)) {
    return { ok: false, reason: 'Схоже на вигадану адресу' };
  }
  // Один і той самий символ повторюється по колу (aaaa@aaaa.com тощо)
  if (/^(.)\1{2,}$/.test(localPart)) {
    return { ok: false, reason: 'Схоже на вигадану адресу' };
  }
  return { ok: true };
}

function isValidPhoneStrict(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { ok: false, reason: 'Некоректна довжина номера' };
  }
  // Усі цифри однакові (0000000000, 1111111111 тощо)
  if (/^(\d)\1+$/.test(digits)) {
    return { ok: false, reason: 'Номер виглядає вигаданим' };
  }
  // Прості послідовності (1234567890, 0123456789, і у зворотному напрямку)
  const ascending = '0123456789012345';
  const descending = '9876543210987654';
  if (ascending.includes(digits) || descending.includes(digits)) {
    return { ok: false, reason: 'Номер виглядає вигаданим' };
  }
  return { ok: true };
}

// РЕАЛЬНИЙ (не AI, не вигаданий) аналіз сайту: завантажує сторінку і рахує
// кількість цифр/статистики, цитат і загальний обсяг тексту. Чистий код,
// без жодного випадкового числа — або реальний результат, або null,
// якщо сайт не вдалось завантажити чи бренд не схожий на URL.
async function computeDepthScore(brand) {
  if (!looksLikeUrl(brand)) return { score: null, reason: 'brand не схожий на сайт' };

  let url = brand.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const res = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Scanner/1.0)' }
    }, 1); // 1 повтор максимум — це не критичний виклик, довго чекати не варто
    if (!res.ok) return { score: null, reason: `сайт відповів HTTP ${res.status}` };

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length < 50) return { score: null, reason: 'на сторінці майже немає тексту' };

    const numberMatches = (text.match(/\d[\d\s.,]*\s?(%|років|рокі|клієнт|проєкт|проект|людей|грн|\$|€|шт\.)/gi) || []).length;
    const quoteMatches = (text.match(/[«"„][^»"“]{15,220}[»"”]/g) || []).length;
    const wordCount = text.split(' ').filter(Boolean).length;

    let score = 0;
    score += Math.min(40, numberMatches * 8);   // конкретні цифри/статистика
    score += Math.min(30, quoteMatches * 10);   // цитати/відгуки
    score += Math.min(30, Math.round(wordCount / 60)); // достатньо тексту, щоб було що цитувати

    return { score: Math.min(100, score), reason: null };
  } catch (err) {
    return { score: null, reason: String(err) };
  }
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
async function checkMention(text, brand, website = '', niche = '') {
  const unavailable=error=>({verdict:'unavailable',hit:false,score:null,classifierError:error,snippet:'',rawText:text || ''});
  if(!text?.trim())return unavailable('Порожня відповідь AI');
  try {
    const response=await askClaude(knowledgePrompt(text,brand,website,niche),{model:ANALYSIS_MODEL,maxTokens:700,timeoutMs:ANALYSIS_TIMEOUT_MS});
    if(response.error||response.truncated) return unavailable(response.error || 'Неповна оцінка знання бренду');
    const result={...parseKnowledge(response.text,text),rawText:text,classifierError:null};
    return {...result,score:knowledgeScore(result)};
  } catch(error) {return unavailable('Не вдалося перевірити знання бренду: '+error.message);}
}

// ---------- Виклики AI-систем ----------

// Deadline includes body reads and at most one short quota retry.
function fetchWithRetry(url,options,timeoutMs=PROVIDER_TIMEOUT_MS) {
  return fetchWithDeadline(url,options,{timeoutMs});
}

async function askChatGPT(query, {maxTokens=900} = {}) {
  if (!OPENAI_API_KEY) return { error: 'OPENAI_API_KEY не налаштовано' };
  // Responses API + вбудований інструмент web_search — щоб ChatGPT реально
  // гуглив бренд, а не відповідав лише з пам'яті навчання (де для менших
  // регіональних компаній майже завжди порожньо).
  const res = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      tools: [{ type: OPENAI_WEB_SEARCH_TOOL }],
      input: query
    })
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`askChatGPT: HTTP ${res.status} — ${bodyText}`);
    return { error: `OpenAI HTTP ${res.status}`, detail: bodyText.slice(0, 300) };
  }
  const data = await res.json();
  let text = data.output_text;
  if (!text) {
    // Фолбек, якщо зручного output_text немає у відповіді — збираємо
    // текст вручну з масиву output.
    const messageItems = (data.output || []).filter(i => i.type === 'message');
    text = messageItems
      .flatMap(m => (m.content || []).filter(c => c.type === 'output_text').map(c => c.text))
      .join(' ');
  }
  return { text: text || '', truncated:data.status === 'incomplete' };
}

async function askGemini(query, {maxTokens=900} = {}) {
  if (!GEMINI_API_KEY) return { error: 'GEMINI_API_KEY не налаштовано' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: query }] }], generationConfig:{maxOutputTokens:Math.max(4096,maxTokens)} };
  // Gemini's output budget includes thinking; a tiny cap can truncate the actual answer.
  if (/^gemini-3\.[56]-flash/.test(GEMINI_MODEL)) body.generationConfig.thinkingConfig={thinkingLevel:'low'};
  else if (/^gemini-2\.5-flash/.test(GEMINI_MODEL)) body.generationConfig.thinkingConfig={thinkingBudget:0};
  // Веб-пошук (grounding) для Gemini вмикається окремо — на безкоштовному
  // тарифі Google Cloud він часто впирається у дуже низьку квоту (HTTP 429)
  // навіть після підключення білінгу. GEMINI_USE_SEARCH=false в .env
  // вимикає пошук лише для Gemini — відповідь буде з пам'яті моделі, без
  // помилок, поки квоту з Google не буде вирішено.
  if (GEMINI_USE_SEARCH) body.tools = [{ google_search: {} }];
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`askGemini: HTTP ${res.status} — ${bodyText}`);
    return { error: `Gemini HTTP ${res.status}`, detail: bodyText.slice(0, 300) };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.filter(p => !p.thought && p.text).map(p => p.text).join(' ') || '';
  return { text, truncated:data?.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

async function askPerplexity(query, {maxTokens=900} = {}) {
  if (!PERPLEXITY_API_KEY) return { error: 'PERPLEXITY_API_KEY не налаштовано' };
  const res = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`
    },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens:maxTokens,
      messages: [{ role: 'user', content: query }]
    })
  });
  if (!res.ok) return { error: `Perplexity HTTP ${res.status}` };
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content || '', truncated:data?.choices?.[0]?.finish_reason === 'length' };
}

async function askClaude(query, { maxTokens = 900, model = CLAUDE_MODEL, timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  if (!ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY не налаштовано' };
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: query }]
    })
  }, timeoutMs);
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error(`askClaude: HTTP ${res.status} — ${bodyText}`);
    return { error: `Claude HTTP ${res.status}`, detail: bodyText.slice(0, 300) };
  }
  const data = await res.json();
  const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
  return { text, truncated:['max_tokens','model_context_window_exceeded'].includes(data.stop_reason) };
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
// Якщо користувач не вказав нішу — визначаємо її самі через веб-пошук,
// щоб "зона невидимості" все одно спрацювала, а не просто мовчала.

// Спільна фабрика кешу в пам'яті процесу — той самий запит (бренд/ніша/
// система), повторений протягом TTL, бере результат з кешу замість
// нового платного виклику API. Скидається при перезапуску/передеплої
// (Render free tier без постійного диску) — і цього достатньо: мета не
// зберігати щось назавжди, а просто не платити двічі за одне й те саме
// в межах короткого проміжку тестування чи реального трафіку.
function makeCache(ttlMs, maxSize) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if ((Date.now() - entry.ts) >= ttlMs) { store.delete(key); return undefined; }
      return entry.value;
    },
    set(key, value) {
      if (store.size >= maxSize) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
      store.set(key, { value, ts: Date.now() });
    }
  };
}

const NICHE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 години
const nicheCache = makeCache(NICHE_CACHE_TTL_MS, 500);
const engineCheckCache = makeCache(NICHE_CACHE_TTL_MS, 1000);
const competitorCache = makeCache(NICHE_CACHE_TTL_MS, 500);

async function inferNicheCached(brand) {
  const key = brand.trim().toLowerCase();
  const cached = nicheCache.get(key);
  if (cached) return { niche: cached, cached: true };

  const result = await inferNiche(brand);
  if (result.niche) nicheCache.set(key, result.niche);
  return { ...result, cached: false };
}

async function inferNiche(brand) {
  if (!ANTHROPIC_API_KEY) return { niche: '', error: 'ANTHROPIC_API_KEY не налаштовано' };

  const prompt = `Використай пошук в інтернеті, щоб визначити, чим займається компанія чи бренд "${brand}" ` +
    `і де вона розташована (місто чи країна). Поверни ЛИШЕ короткий опис у форматі ` +
    `"сфера діяльності, місто" (наприклад: "стоматологічна клініка, Київ" або "маркетингова агенція, Україна"), ` +
    `без назви самого бренду і без жодних пояснень до чи після. Якщо через пошук не вдалось нічого знайти про цю компанію — ` +
    `поверни рівно слово: невідомо`;

  try {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`inferNiche: Claude HTTP ${res.status} — ${bodyText}`);
      return { niche: '', error: `Claude+search HTTP ${res.status}` };
    }
    const data = await res.json();
    const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    const cleaned = text.replace(/^["'«]|["'»]$/g, '').trim();
    if (!cleaned || cleaned.toLowerCase().includes('невідомо')) {
      return { niche: '' };
    }
    return { niche: cleaned.slice(0, 120) };
  } catch (err) {
    console.error('inferNiche: виняток', err);
    return { niche: '', error: String(err) };
  }
}

async function findRealCompetitors(query, brand) {
  if (!ANTHROPIC_API_KEY) return { competitors: [], error: 'ANTHROPIC_API_KEY не налаштовано' };

  const prompt = `Використай пошук в інтернеті, щоб знайти реальних, актуальних гравців ринку, ` +
    `які підходять під запит клієнта: "${query}". Перевір через пошук, а не з памʼяті. ` +
    `Поверни ЛИШЕ JSON-масив назв компаній чи брендів (до 8 штук), без будь-яких пояснень до чи ` +
    `після масиву. Виключи бренд "${brand}", якщо він там зустрічається.`;

  try {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
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

async function findRealCompetitorsCached(query, brand) {
  const key = brand.trim().toLowerCase() + '::' + query.trim().toLowerCase();
  const cached = competitorCache.get(key);
  if (cached) return { ...cached, cached: true };

  const result = await findRealCompetitors(query, brand);
  if (!result.error) competitorCache.set(key, result);
  return { ...result, cached: false };
}

async function runDiscoveryQuery(query, brand, website = '') {
  const started=Date.now();
  const target = targetIdentity(brand, website);
  const requestPrompt=`${query}\nПорадь 3–5 конкретних компаній, постачальників або магазинів для цієї потреби. Коротко поясни вибір, вкажи офіційні сайти, якщо знаєш. Не замінюй добірку загальною інструкцією. Якщо не можеш порадити конкретні компанії, прямо скажи про це. Відповідай українською, до 180 слів: назва, сайт, одне коротке речення на кожну компанію.`;
  const engineResults = {};
  const pending = {};
  const models = { chatgpt:OPENAI_MODEL, gemini:GEMINI_MODEL, perplexity:'sonar', claude:CLAUDE_MODEL };
  const cacheKey = key => `recommendation-v3::${key}::${brand.trim().toLowerCase()}::${target.host || ''}::${query.trim()}`;
  await Promise.all(DISCOVERY_ENGINES.map(async key => {
    const caller = ENGINE_CALLERS[key];
    if (!caller) return;
    const cached = engineCheckCache.get(cacheKey(key));
    if (cached) { engineResults[key] = { ...cached, cached:true }; return; }
    // No target brand or domain is injected into these customer questions.
    const response = await caller(requestPrompt, {maxTokens:1100}).catch(error=>({error:String(error)}));
    const raw = { ...response, model:models[key], searchMode:key === 'claude' || (key === 'gemini' && !GEMINI_USE_SEARCH) ? 'model_knowledge' : 'web_search_enabled' };
    if (raw.error || raw.truncated || !raw.text?.trim()) {
      engineResults[key] = { error:raw.error || (raw.truncated ? 'AI повернула неповну відповідь' : 'Порожня відповідь'), analysisStatus:'unavailable', model:models[key] };
    } else if (raw.text.length > 18000) {
      engineResults[key] = {...raw, rawText:raw.text, analysisStatus:'unavailable', analysisError:'Відповідь завелика для надійної перевірки'};
    } else pending[key] = raw;
  }));
  if (Object.keys(pending).length) {
    let extracted = {};
    try {
      const response = await askClaude(extractionPrompt(query, target, Object.fromEntries(Object.entries(pending).map(([key,value])=>[key,value.text]))), {maxTokens:4000,model:ANALYSIS_MODEL,timeoutMs:ANALYSIS_TIMEOUT_MS});
      if (!response.error && !response.truncated) extracted = parseExtraction(response.text);
    } catch (error) { console.warn('Recommendation extraction failed:', error.message); }
    for (const [key,raw] of Object.entries(pending)) {
      const result = { ...validateAnswer(raw, extracted[key], target), checkedAt:new Date().toISOString() };
      engineResults[key] = result;
      if (result.analysisStatus === 'ok') engineCheckCache.set(cacheKey(key),result);
    }
  }
  const competitors = [...new Set(Object.values(engineResults).flatMap(result=>(result.recommendedCompanies || []).filter(item=>!item.isTarget).map(item=>item.name)))];
  return { query, requestPrompt, durationMs:Date.now()-started, analysisVersion:2, engines:engineResults, competitors, competitorsSource:'observed_recommendations' };
}

async function scanEngine(brand,niche,engine,website) {
  const caller=ENGINE_CALLERS[engine];
  const cacheKey=JSON.stringify(['knowledge-v4',engine,brand.trim().toLowerCase(),niche||'',website||'',ANALYSIS_MODEL]);
  const cached=engineCheckCache.get(cacheKey);
  if(cached)return {...cached,cached:true};
  return inFlight(cacheKey,async()=>{
    const started=Date.now();
    const [query]=buildQueries(brand,niche,website);
    const response=await caller(query+' Відповідь до 120 слів, без довгого вступу.').catch(error=>({error:String(error)}));
    const providerMs=Date.now()-started;
    const model={chatgpt:OPENAI_MODEL,gemini:GEMINI_MODEL,perplexity:'sonar',claude:CLAUDE_MODEL}[engine];
    const searchMode=engine==='claude'||(engine==='gemini'&&!GEMINI_USE_SEARCH)?'model_knowledge':'web_search_enabled';
    const result=response.error||response.truncated||!response.text?.trim()
      ? {error:response.error||(response.truncated?'AI повернула неповну відповідь':'Порожня відповідь AI'),verdict:'unavailable',score:null,rawText:response.text||''}
      : await checkMention(response.text,brand,website,niche);
    Object.assign(result,{model,searchMode,checkedAt:new Date().toISOString(),timings:{providerMs,totalMs:Date.now()-started}});
    // Transient errors must not be cached as negative knowledge for 24 hours.
    if(!result.error&&!result.classifierError)engineCheckCache.set(cacheKey,result);
    return result;
  });
}
app.post('/api/scan', async (req,res)=>{
  try {
    const {brand,niche='',website=''}=req.body||{};
    if(typeof brand!=='string'||!brand.trim())return res.status(400).json({error:'Поле "brand" обовʼязкове'});
    const started=Date.now();
    const knowledge=Promise.all(Object.keys(ENGINE_CALLERS).map(async engine=>[engine,await scanEngine(brand,niche,engine,website)]));
    const discovery=planCustomerQueries(brand,niche,website).then(async queryPlan=>({queryPlan,zoneOfInvisibility:await Promise.all(queryPlan.queries.map(q=>runDiscoveryQuery(q,brand,website)))}));
    const [engines,{queryPlan,zoneOfInvisibility}]=await Promise.all([knowledge,discovery]);
    res.json({query:buildQueries(brand,niche,website)[0],engines:Object.fromEntries(engines),queryPlan,zoneOfInvisibility,recommendations:summarizeRecommendations(zoneOfInvisibility,brand,website),durationMs:Date.now()-started});
  } catch(error){res.status(500).json({error:'Внутрішня помилка сервера'});}
});
app.post('/api/scan-engine',async(req,res)=>{
  const {brand,niche='',engine,website=''}=req.body||{};
  if(typeof brand!=='string'||!brand.trim()||typeof niche!=='string'||typeof website!=='string')return res.status(400).json({error:'Вкажіть назву бренду'});
  if(!Object.hasOwn(ENGINE_CALLERS,engine))return res.status(400).json({error:'Невідома система'});
  try {res.json(await scanEngine(brand,niche,engine,website));}
  catch(error){res.status(500).json({error:'Внутрішня помилка сервера'});}
});

// Повертає лише текст нішевих запитів (без виконання) — щоб фронтенд міг
// одразу намалювати список кроків прогресу, ще до того, як почнеться сам
// пошук.
const queryPlanCache=makeCache(NICHE_CACHE_TTL_MS,500);
async function planCustomerQueries(brand,niche='',website='') {
  const key=JSON.stringify([brand,niche,website,DISCOVERY_QUERY_COUNT]);
  const started=Date.now();
  const cached=queryPlanCache.get(key);
  if(cached)return {...cached,cached:true};
  try {
    if(!ANTHROPIC_API_KEY)throw Error('Query planner unavailable');
    const sourceWebsite=website || targetIdentity(brand,'').host;
    let siteContext=null;
    if(sourceWebsite)try {siteContext=await fetchSiteContext(sourceWebsite);} catch(error) {console.warn('Site context:',error.message);}
    const response=await fetchWithRetry('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:ANALYSIS_MODEL,max_tokens:2200,messages:[{role:'user',content:queryPlanPrompt(brand,website,niche,DISCOVERY_QUERY_COUNT,siteContext)}],...(siteContext?.text?.length>=200?{}:{tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}]})})
    }, PLAN_TIMEOUT_MS);
    if(!response.ok)throw Error(`Query planner HTTP ${response.status}`);
    const data=await response.json();
    if(data.stop_reason==='max_tokens')throw Error('Incomplete query plan');
    const text=(data.content||[]).filter(item=>item.type==='text').map(item=>item.text).join(' ');
    const plan={...parseQueryPlan(text,brand,website,DISCOVERY_QUERY_COUNT),inferred:!niche};
    if(niche)plan.niche=niche;
    plan.siteContextUsed=!!siteContext;
    plan.durationMs=Date.now()-started;
    plan.sourceWebsite=siteContext?.url || null;
    queryPlanCache.set(key,plan);
    return plan;
  } catch(error) {
    console.warn('Customer query planner:',error.message);
    // Fallback is explicit: never pretend generic niche prompts are a researched service list.
    return {queries:buildDiscoveryQueries(niche),niche,inferred:false,services:[],querySource:niche?'niche_templates':'unavailable'};
  }
}
app.post('/api/discovery-queries', async (req,res)=>{
  try {
    const {brand,niche='',website=''}=req.body || {};
    if(typeof brand!=='string'||!brand.trim()||typeof niche!=='string'||typeof website!=='string')return res.status(400).json({error:'Вкажіть назву бренду'});
    res.json(await planCustomerQueries(brand,niche,website));
  } catch(error) {res.status(500).json({error:'Не вдалося скласти запити'});}
});

app.post('/api/zone-query', async (req, res) => {
  try {
    const { brand, query, website } = req.body || {};
    if (!brand || typeof brand !== 'string') {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Поле "query" обовʼязкове' });
    }
    const result = await runDiscoveryQuery(query, brand, website);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Приймає контакт, залишений за розблокування повного звіту.

// Формує PDF-звіт із даних скану, які прислав фронтенд (той самий скан,
// що вже показаний на сторінці — тут нічого заново не рахується).
const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo.png');
const FONT_REGULAR_PATH = path.join(process.cwd(), 'assets', 'fonts', 'PTSans-Regular.ttf');
const FONT_BOLD_PATH = path.join(process.cwd(), 'assets', 'fonts', 'PTSans-Bold.ttf');

// Темна палітра, узгоджена з фірмовим сайтом Top Marketing.
const PDF_BG = '#14181D';
const PDF_PANEL = '#1D232B';
const PDF_BORDER = '#333B46';
const PDF_INK = '#EEF1F4';
const PDF_INK_DIM = '#9AA5B1';
const PDF_INK_FAINT = '#6B7580';
const PDF_ORANGE = '#F5781E';
const PDF_CYAN = '#4FD1C5';
const PDF_RED = '#FF5A5F';

function buildReportPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 46, size: 'A4', bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('PT-Sans', FONT_REGULAR_PATH);
      doc.registerFont('PT-Sans-Bold', FONT_BOLD_PATH);
      doc.font('PT-Sans');

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const mL = doc.page.margins.left;
      const mR = pageW - doc.page.margins.right;
      const mB = pageH - doc.page.margins.bottom;
      const contentW = mR - mL;

      function paintBg() {
        doc.rect(0, 0, pageW, pageH).fill(PDF_BG);
      }
      function newPage() {
        doc.addPage();
        paintBg();
        return doc.page.margins.top;
      }
      function ensureSpace(y, needed) {
        if (y + needed > mB) return newPage();
        return y;
      }
      function card(x, y, w, h, opts = {}) {
        doc.roundedRect(x, y, w, h, 6).fill(opts.bg || PDF_PANEL);
        if (opts.borderTop) doc.rect(x, y, w, 3).fill(opts.borderTop);
        if (opts.borderLeft) doc.rect(x, y, 3, h).fill(opts.borderLeft);
      }
      function pillWidth(text) {
        doc.font('PT-Sans-Bold').fontSize(9);
        return doc.widthOfString(text.toUpperCase()) + 22;
      }
      function pill(x, y, text, color) {
        const w = pillWidth(text);
        doc.roundedRect(x, y, w, 20, 10).lineWidth(1).stroke(color);
        doc.font('PT-Sans-Bold').fontSize(9).fillColor(color).text(text.toUpperCase(), x + 11, y + 6);
        return w;
      }
      function verdictStyle(verdict) {
        if (verdict === 'know') return { label: 'ЗНАЄ', color: PDF_CYAN };
        if (verdict === 'confused') return { label: 'НЕВПЕВНЕНО', color: PDF_ORANGE };
        return { label: 'НЕ ВПІЗНАЄ', color: PDF_RED };
      }

      paintBg();

      // ---- Шапка ----
      try { doc.image(LOGO_PATH, mL, 42, { width: 108 }); } catch (e) {}
      const eyebrow = 'AI-ВИДИМІСТЬ';
      pill(mR - pillWidth(eyebrow), 46, eyebrow, PDF_ORANGE);

      let y = 108;
      doc.font('PT-Sans-Bold').fontSize(22).fillColor(PDF_INK).text(data.brand || 'Ваш бренд', mL, y, { width: contentW });
      y = doc.y + 2;
      doc.font('PT-Sans').fontSize(11).fillColor(PDF_INK_DIM).text('Персональний звіт AI-видимості', mL, y);
      y = doc.y + 12;

      const metaParts = [];
      if (data.niche) metaParts.push(`Ніша: ${data.niche}`);
      metaParts.push(`Перевірено: ${new Date().toLocaleDateString('uk-UA')}`);
      doc.font('PT-Sans').fontSize(9).fillColor(PDF_INK_FAINT).text(metaParts.join('   ·   '), mL, y);
      y = doc.y + 22;

      // Two independent scores; never average recognition with recommendation.
      const recognition=data.recognitionScore ?? data.score ?? null;
      const recommendation=data.recommendationScore ?? data.recommendations?.score ?? null;
      const half=(contentW-14)/2;
      const scores=[{label:'ЗНАННЯ БРЕНДУ',value:recognition,note:'Наскільки AI впізнають ваш бренд'},{label:'РЕКОМЕНДАЦІЇ',value:recommendation,note:'Як часто AI радять вас за запитами клієнтів'}];
      y=ensureSpace(y,140);
      scores.forEach((item,index)=>{
        const x=mL+index*(half+14);
        card(x,y,half,120,{borderTop:PDF_ORANGE});
        doc.font('PT-Sans-Bold').fontSize(10).fillColor(PDF_INK).text(item.label,x+16,y+14,{width:half-32});
        doc.font('PT-Sans-Bold').fontSize(32).fillColor(PDF_ORANGE).text(item.value===null?'—':`${item.value}/100`,x+16,y+37,{width:half-32});
        doc.font('PT-Sans').fontSize(9).fillColor(PDF_INK_DIM).text(item.value===null?'Немає достатніх даних':item.note,x+16,y+83,{width:half-32});
      });
      y+=138;
      doc.font('PT-Sans').fontSize(9).fillColor(PDF_INK_DIM).text('Це два незалежні показники. AI може знати бренд, але не рекомендувати його. Знання: знає = 100, плутає або знає частково = 50, не знає = 0. Загальний бал знання - середнє доступних оцінок AI.',mL,y,{width:contentW});
      y=doc.y+20;

      // ---- Результати по AI-системах ----
      doc.font('PT-Sans-Bold').fontSize(14).fillColor(PDF_ORANGE);
      y = ensureSpace(y, 24);
      doc.text('1. Наскільки кожна AI знає бренд', mL, y);
      y = doc.y + 10;

      (data.engines || []).forEach((e) => {
        const v = (knowledgeScore(e)===null) ? { label: 'НЕДОСТУПНО', color: PDF_INK_FAINT } : verdictStyle(e.verdict || (e.hit ? 'know' : 'unknown'));
        const quote = [e.snippet ? `«${e.snippet}»` : (e.error || e.classifierError || ''),e.reason ? `Оцінка: ${e.reason}` : '',e.model ? `${e.model} · ${e.searchMode==='model_knowledge'?'знання моделі без веб-пошуку':'веб-пошук увімкнено'}` : ''].filter(Boolean).join('\n');
        doc.font('PT-Sans').fontSize(9.5);
        const quoteH = quote ? doc.heightOfString(quote, { width: contentW - 32 }) : 0;
        const cardH = 34 + (quote ? quoteH + 8 : 0);
        y = ensureSpace(y, cardH + 10);
        card(mL, y, contentW, cardH, { borderLeft: v.color });
        doc.font('PT-Sans-Bold').fontSize(11).fillColor(PDF_INK).text(e.label, mL + 16, y + 11, { continued: true });
        doc.font('PT-Sans-Bold').fontSize(10).fillColor(v.color).text('   ' + v.label + (knowledgeScore(e)===null ? '' : ` · ${knowledgeScore(e)}/100`));
        if (quote) {
          doc.font('PT-Sans').fontSize(9.5).fillColor(PDF_INK_DIM).text(quote, mL + 16, y + 30, { width: contentW - 32 });
        }
        y += cardH + 10;
      });
      y += 10;

      y = drawRecommendations(doc, data, {newPage,ensureSpace,card,mL,contentW});

      // ---- Що знижує сигнал ----
      if ((data.issues || []).length) {
        doc.font('PT-Sans-Bold').fontSize(14).fillColor(PDF_ORANGE);
        y = ensureSpace(y, 24);
        doc.text('Що показала перевірка', mL, y);
        y = doc.y + 10;

        doc.font('PT-Sans').fontSize(10);
        const issuesH = data.issues.reduce((sum, t) => sum + doc.heightOfString(`X  ${t}`, { width: contentW - 32 }) + 8, 0);
        y = ensureSpace(y, issuesH + 24);
        card(mL, y, contentW, issuesH + 24, { borderLeft: PDF_RED });
        let iy = y + 12;
        data.issues.forEach((t) => {
          doc.font('PT-Sans').fontSize(10).fillColor(PDF_INK);
          doc.fillColor(PDF_RED).text('X', mL + 16, iy, { continued: false });
          doc.fillColor(PDF_INK).text(t, mL + 32, iy, { width: contentW - 48 });
          iy = doc.y + 8;
        });
        y = iy + 8;
      }

      // ---- Сторінка 2: покроковий план ----
      y = newPage();
      try { doc.image(LOGO_PATH, mL, 42, { width: 88 }); } catch (e) {}
      y = 108;
      doc.font('PT-Sans-Bold').fontSize(18).fillColor(PDF_INK).text('Покроковий план дій', mL, y);
      y = doc.y + 2;
      doc.font('PT-Sans').fontSize(10).fillColor(PDF_INK_DIM).text('Загальні кроки - перевірте їхню актуальність для свого бізнесу', mL, y);
      y = doc.y + 20;

      const steps = [
        {
          title: '1. Зберіть бренд в одну сутність',
          body: `Напишіть один канонічний абзац: хто ви + що робите + для кого + де (місто/ринок/онлайн) + один ` +
            `перевірюваний факт (років на ринку, клієнтів, публікацій). Вставте цей абзац дослівно всюди, де ви є: ` +
            `сайт, LinkedIn, соцмережі, каталоги, профілі на майданчиках. Однакове написання назви — до літери.`
        },
        {
          title: '2. Потрапте до чужих списків',
          body: `Запитайте в ChatGPT і Perplexity: «найкращі [ваша ніша] у [місто/ринок]». Зафіксуйте, на які добірки ` +
            `й рейтинги вони посилаються. Випишіть 5-10 списків, де є конкуренти, а вас немає. Напишіть авторам ` +
            `майданчиків заявку на включення — багато нішевих добірок додають безкоштовно.`
        },
        {
          title: '3. Зайдіть у живі обговорення',
          body: `Знайдіть 2-3 живі майданчики, де реально обговорюють вашу нішу: форуми, галузеві спільноти, Q&A. ` +
            `Дайте там 2-3 розгорнуті корисні відповіді як експерт, без реклами в лоб. Запустіть збір змістовних ` +
            `відгуків від клієнтів — з деталями (послуга, специфіка), а не просто «все супер».`
        },
        {
          title: '4. Підсильте контент цифрами',
          body: `Візьміть головний експертний матеріал і підсильте трьома речами: конкретні цифри й статистика ` +
            `замість загальних слів, цитати з посиланням на ім'я, зазначення джерел даних.`
        },
        {
          title: '5. Закрийте реальне питання клієнта',
          body: `Візьміть реальне формулювання, яким клієнти шукають таких, як ви. Опублікуйте матеріал: заголовок ` +
            `= питання клієнта, перший абзац = пряма відповідь (2-4 речення). Ставте свіжу дату і оновлюйте ключові ` +
            `матеріали раз на квартал.`
        },
        {
          title: 'Бонус: зареєструйтесь у Bing Webmaster Tools',
          body: `15 хвилин, безкоштовно. Помітна частка цитат пошукового режиму ChatGPT збігається з органічною ` +
            `видачею Bing, а конкуренція там значно нижча.`,
          bonus: true
        }
      ];

      steps.forEach((s) => {
        doc.font('PT-Sans').fontSize(10);
        const bodyH = doc.heightOfString(s.body, { width: contentW - 40 });
        const cardH = 28 + bodyH + 16;
        y = ensureSpace(y, cardH + 12);
        card(mL, y, contentW, cardH, { borderLeft: s.bonus ? PDF_ORANGE : PDF_CYAN });
        doc.font('PT-Sans-Bold').fontSize(12).fillColor(s.bonus ? PDF_ORANGE : PDF_INK).text(s.title, mL + 18, y + 12, { width: contentW - 40 });
        doc.font('PT-Sans').fontSize(10).fillColor(PDF_INK_DIM).text(s.body, mL + 18, doc.y + 4, { width: contentW - 40 });
        y += cardH + 12;
      });

      // ---- Фінальний CTA ----
      const ctaTitle = 'Перетворіть результати перевірки на план дій';
      const ctaBody = 'Кроки вище можна застосувати самостійно вже сьогодні — усе прозоро й покроково. А якщо ' +
        'хочете системного результату без витрат часу на це самим — Top Marketing може взяти SEO та GEO-просування ' +
        'в AI-системах на себе.';
      doc.font('PT-Sans').fontSize(10.5);
      const ctaBodyH = doc.heightOfString(ctaBody, { width: contentW - 40 });
      const ctaH = 30 + ctaBodyH + 40;
      y = ensureSpace(y, ctaH + 10);
      card(mL, y, contentW, ctaH, { bg: PDF_PANEL, borderTop: PDF_ORANGE });
      doc.font('PT-Sans-Bold').fontSize(13).fillColor(PDF_INK).text(ctaTitle, mL + 20, y + 16, { width: contentW - 40 });
      doc.font('PT-Sans').fontSize(10.5).fillColor(PDF_INK_DIM).text(ctaBody, mL + 20, doc.y + 6, { width: contentW - 40 });
      doc.font('PT-Sans-Bold').fontSize(10.5).fillColor(PDF_ORANGE).text('Обговорити просування з Top Marketing  >>  topmarketing.com.ua', mL + 20, doc.y + 12);

      const pages=doc.bufferedPageRange();
      for(let page=pages.start;page<pages.start+pages.count;page++) {
        doc.switchToPage(page);
        const bottomMargin=doc.page.margins.bottom;
        doc.page.margins.bottom=0;
        doc.font('PT-Sans').fontSize(8).fillColor(PDF_INK_FAINT).text(`Top Marketing · ${page+1} / ${pages.count}`,mL,pageH-30,{width:contentW,align:'right',lineBreak:false});
        doc.page.margins.bottom=bottomMargin;
      }
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
      return { sent: false, error: `Resend HTTP ${res.status}`, detail: bodyText.slice(0, 400) };
    }
    return { sent: true };
  } catch (err) {
    console.error('sendReportEmail: виняток', err);
    return { sent: false, error: String(err) };
  }
}

// Записує в таблицю тих, хто зробив скан, але НЕ залишив контакт —
// щоб бачити обсяг "теплого" трафіку (сайт/бренд вказали, форму не
// заповнили), навіть без можливості напряму з ними зв'язатись.
app.post('/api/partial-lead', async (req, res) => {
  try {
    const { brand, niche, score } = req.body || {};
    if (!brand || typeof brand !== 'string' || !brand.trim()) {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }

    const lead = {
      name: '',
      phone: '',
      email: '',
      brand: brand.trim(),
      niche: (niche || '').trim(),
      score: typeof score === 'number' ? score : null,
      status: 'Тільки скан (без контакту)',
      ts: new Date().toISOString()
    };

    try {
      fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
    } catch (e) {
      console.warn('Не вдалось записати частковий лід у файл:', e);
    }

    if (LEAD_WEBHOOK_URL) {
      fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      }).catch(e => console.warn('Помилка відправки часткового ліда на LEAD_WEBHOOK_URL:', e));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Реальний аналіз сайту (не AI) — окремо, щоб не гальмувати основний скан.
app.post('/api/depth-score', async (req, res) => {
  try {
    const { brand } = req.body || {};
    if (!brand || typeof brand !== 'string' || !brand.trim()) {
      return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });
    }
    const result = await computeDepthScore(brand);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// Заявка на консультацію — лише телефон, без email/PDF. Окремий статус
// у таблиці, щоб відрізняти від основних лідів (тих, хто хотів PDF).
app.post('/api/consult-request', async (req, res) => {
  try {
    const { phone, brand, niche, score, website } = req.body || {};
    if (website) {
      return res.status(400).json({ error: 'Заявку відхилено' });
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Поле "phone" обовʼязкове' });
    }
    const phoneCheck = isValidPhoneStrict(phone);
    if (!phoneCheck.ok) {
      return res.status(400).json({ error: phoneCheck.reason });
    }

    const lead = {
      name: '',
      phone: phone.trim(),
      email: '',
      brand: (brand || '').trim(),
      niche: (niche || '').trim(),
      score: typeof score === 'number' ? score : null,
      status: 'Запит на консультацію (лише телефон)',
      ts: new Date().toISOString()
    };

    try {
      fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
    } catch (e) {
      console.warn('Не вдалось записати запит на консультацію у файл:', e);
    }

    if (LEAD_WEBHOOK_URL) {
      fetch(LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      }).catch(e => console.warn('Помилка відправки запиту на консультацію на LEAD_WEBHOOK_URL:', e));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

app.post('/api/lead', async (req, res) => {
  try {
    const { name, phone, email, brand, niche, score, engines, zoneOfInvisibility, issues, website } = req.body || {};

    // Honeypot: реальні люди це поле ніколи не бачать і не заповнюють —
    // заповнене значення означає бота. Тихо відмовляємо, без деталей.
    if (website) {
      return res.status(400).json({ error: 'Заявку відхилено' });
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Поле "email" обовʼязкове' });
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Поле "phone" обовʼязкове' });
    }
    const emailCheck = isValidEmailStrict(email);
    if (!emailCheck.ok) {
      return res.status(400).json({ error: emailCheck.reason });
    }
    const phoneCheck = isValidPhoneStrict(phone);
    if (!phoneCheck.ok) {
      return res.status(400).json({ error: phoneCheck.reason });
    }

    const lead = {
      name: (name || '').trim(),
      phone: phone.trim(),
      email: email.trim(),
      brand: (brand || '').trim(),
      niche: (niche || '').trim(),
      score: typeof score === 'number' ? score : null,
      status: 'Повна заявка',
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
    const website = req.query.website || '';
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
    const website = req.query.website || '';
    const caller = ENGINE_CALLERS[engine];
    if (!caller) return res.status(400).json({ error: `Невідома система: ${engine}` });

    const [query] = buildQueries(brand, niche, website);
    const result = await scanEngine(brand,niche,engine,website);
    res.json({
      query,
      brand,
      rawText: result.rawText,
      matchCandidates: brandMatchCandidates(brand),
      result
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Швидка перевірка автовизначення ніші окремо від повного скану.
// Приклад: GET /api/debug-niche?brand=Webpromo
app.get('/api/debug-niche', async (req, res) => {
  const brand = req.query.brand || 'Тестовий Бренд';
  const result = await inferNiche(brand);
  res.json({ brand, ...result });
});

// Перевірка доставки в Google Таблицю (чи в інший LEAD_WEBHOOK_URL) окремо
// від усього іншого — шле тестовий рядок і показує, що саме відповів
// Apps Script (чи інший вебхук).
app.get('/api/debug-webhook', async (req, res) => {
  if (!LEAD_WEBHOOK_URL) {
    return res.json({ ok: false, error: 'LEAD_WEBHOOK_URL не налаштовано на цьому сервері' });
  }
  const testLead = {
    name: 'Тест',
    phone: '+380000000000',
    email: 'test@example.com',
    brand: 'Тестовий Бренд',
    niche: 'тестова ніша',
    score: 42,
    ts: new Date().toISOString()
  };
  try {
    const resp = await fetch(LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testLead)
    });
    const bodyText = await resp.text().catch(() => '');
    res.json({
      ok: resp.ok,
      httpStatus: resp.status,
      responseBody: bodyText.slice(0, 500),
      sentPayload: testLead
    });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

// Перевірка відправки email через Resend окремо від усього іншого — генерує
// маленький тестовий PDF і намагається надіслати на вказану адресу.
// Приклад: GET /api/debug-email?to=your@mail.com
app.get('/api/debug-email', async (req, res) => {
  const to = req.query.to;
  if (!to) return res.json({ ok: false, error: 'Додайте ?to=ваш@email.com в адресу' });
  if (!RESEND_API_KEY) return res.json({ ok: false, error: 'RESEND_API_KEY не налаштовано на цьому сервері' });

  try {
    const pdfBuffer = await buildReportPdf({
      brand: 'Тестовий Бренд',
      niche: 'тестова ніша',
      score: 42,
      engines: [{ label: 'Claude', verdict: 'know', snippet: 'Тестова цитата для перевірки' }],
      zoneOfInvisibility: [],
      issues: ['Тестова проблема для перевірки PDF']
    });
    const emailResult = await sendReportEmail(to, pdfBuffer, { brand: 'Тестовий Бренд' });
    res.json({ pdfSize: pdfBuffer.length, emailResult });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

// ==================== TELEGRAM-БОТ: доставка звіту + прогрів ====================
//
// Бот НЕ може написати першим — людина сама тисне на посилання
// t.me/<BOT_USERNAME>?start=<token> на сайті, Telegram відкриває чат,
// вона тисне Start, і бот отримує /start <token> з chat_id.
//
// Токен генерується одразу після скану (POST /api/save-report), під ним
// зберігається повний результат — бот дістає ці дані по токену й формує
// той самий PDF, що йде на пошту.
//
// Прогрів (день 1 / день 3 / день 5) не надсилається сам собою — Render
// безкоштовний тариф засинає без активності. GET /api/telegram-cron треба
// пінгувати ззовні раз на ~10 хв (напр. безкоштовний cron-job.org) —
// кожен пінг одночасно будить сервер і перевіряє чергу.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// Пароль для ручних розсилок (/api/telegram-broadcast) — щоб ніхто, хто
// випадково знайде адресу ендпоінту, не міг розіслати щось усій базі.
// Встановіть свій на Render: TELEGRAM_ADMIN_SECRET=щось-довге-й-випадкове
const TELEGRAM_ADMIN_SECRET = process.env.TELEGRAM_ADMIN_SECRET || '';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_LEADS_FILE = path.join(process.cwd(), 'telegram-leads.json');

// Короткочасний in-memory кеш готових звітів — живе лише до моменту, коли
// людина натисне посилання в Telegram (зазвичай секунди-хвилини після
// скану). Якщо сервер перезапуститься саме в цю паузу — рідкісний
// крайній випадок, людина просто скане ще раз.
// Report data and PDFs live in reportStore (PostgreSQL when configured).

function telegramSend(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN не налаштовано' });
  return fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json()).catch(err => ({ ok: false, error: String(err) }));
}

function telegramSendDocument(chatId, pdfBuffer, filename, caption) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN не налаштовано' });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
  return fetch(`${TELEGRAM_API}/sendDocument`, { method: 'POST', body: form })
    .then(r => r.json()).catch(err => ({ ok: false, error: String(err) }));
}

// Фото/відео для розсилки — або посиланням (Telegram сам завантажує з
// URL, найпростіший шлях), або файлом, який завантажили просто в форму
// (тоді пересилаємо байти напряму в Telegram через multipart).
function telegramSendPhoto(chatId, urlOrBuffer, filename, caption) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN не налаштовано' });
  if (typeof urlOrBuffer === 'string') {
    return telegramSend('sendPhoto', { chat_id: chatId, photo: urlOrBuffer, caption });
  }
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('photo', new Blob([urlOrBuffer]), filename || 'photo.jpg');
  return fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form })
    .then(r => r.json()).catch(err => ({ ok: false, error: String(err) }));
}
function telegramSendVideo(chatId, urlOrBuffer, filename, caption) {
  if (!TELEGRAM_BOT_TOKEN) return Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN не налаштовано' });
  if (typeof urlOrBuffer === 'string') {
    return telegramSend('sendVideo', { chat_id: chatId, video: urlOrBuffer, caption });
  }
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('video', new Blob([urlOrBuffer]), filename || 'video.mp4');
  return fetch(`${TELEGRAM_API}/sendVideo`, { method: 'POST', body: form })
    .then(r => r.json()).catch(err => ({ ok: false, error: String(err) }));
}

function loadTelegramLeads() {
  try {
    return JSON.parse(fs.readFileSync(TELEGRAM_LEADS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}
function saveTelegramLeads(list) {
  try {
    fs.writeFileSync(TELEGRAM_LEADS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    console.warn('Не вдалось записати telegram-leads.json:', e);
  }
}

// ---- ТЕКСТИ ПРОГРІВУ ----
const TELEGRAM_INTRO_IMAGE_PATH = path.join(process.cwd(), 'assets', 'telegram', 'intro-post.jpg');
const TELEGRAM_INTRO_MESSAGE =
  `Привіт! 👋 Ми - Top Marketing, агенція performance-маркетингу.\n\n` +
  `Займаємось Google Ads, Meta Ads і SEO 🎯 Наш профіль клієнтів - медицина, нерухомість, e-commerce, B2B.\n\n` +
  `7 років у маркетингу, 3 з них - під власним брендом Top Marketing 🚀\n\n` +
  `У цьому боті ділитимемось кейсами, реальними інсайтами про те, що працює в рекламі та AI-пошуку 💡, і час від часу - пропозиціями, якщо захочете просуватись з нами.`;

// ⚠️ ЗАГЛУШКИ. Тут навмисно НЕ вигадані кейси чи цифри — вставте реальний
// матеріал клієнта перед тим, як вмикати прогрів по-справжньому.
const TELEGRAM_DAY1_MESSAGE =
  `Привіт ще раз! 👋\n\n` +
  `[ВСТАВТЕ РЕАЛЬНИЙ КЕЙС: коротко опишіть клієнта (ніша, без імені якщо треба), яку проблему з AI-видимістю ви йому вирішили, і конкретний результат — до/після, цифри, факт.]\n\n` +
  `Якщо у вашій ніші схожа ситуація — можемо розібрати це на консультації.`;

const TELEGRAM_DAY3_MESSAGE =
  `Ще один момент, який часто зустрічаємо в роботі з клієнтами:\n\n` +
  `[ВСТАВТЕ РЕАЛЬНИЙ ДРУГИЙ КЕЙС АБО ТИПОВУ ПОМИЛКУ: щось на кшталт "бізнеси у [ніша] зазвичай втрачають клієнтів через X — ось як ми це виправили клієнту Y".]\n\n` +
  `Актуально для вас?`;

const TELEGRAM_DAY5_MESSAGE =
  `Якщо досі не встигли застосувати кроки з вашого звіту — це нормально, часу завжди бракує.\n\n` +
  `Пропоную коротку безкоштовну консультацію: розберемо саме ваш результат і складемо конкретний план, а не загальні поради.\n\n` +
  `Просто відповідьте на це повідомлення "так" — і ми зв'яжемось для запису.`;

// ---- Крок 1: зберегти готовий результат скану, отримати токен ----
app.post('/api/save-report', async (req, res) => {
  try {
    const { brand, niche, website, score, engines, zoneOfInvisibility, issues, queryPlan } = req.body || {};
    if (!brand) return res.status(400).json({ error: 'Поле "brand" обовʼязкове' });

    const token = randomBytes(24).toString('hex');
    const report = enrichReport({ brand, niche, website, score, engines, zoneOfInvisibility, issues, queryPlan, ts: Date.now() });
    await reportStore.set(token, report);

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
    const sendpulseFlowId = process.env.SENDPULSE_FLOW_ID || '';

    // Якщо бот тепер під керуванням SendPulse (окремий вебхук на їхній
    // стороні), звичайний t.me?start= посилання НЕ передає параметр як
    // звичайну змінну — SendPulse читає його лише через свій проміжний
    // домен tg.pulse.is у форматі ?start={flow_id}&{custom_var}=значення.
    // Без SENDPULSE_FLOW_ID лишаємо старий прямий формат (наша власна
    // логіка через /telegram-webhook).
    const telegramLink = !botUsername
      ? null
      : sendpulseFlowId
        ? `https://tg.pulse.is/${botUsername}?start=${sendpulseFlowId}&scan_token=${token}`
        : `https://t.me/${botUsername}?start=${token}`;

    res.json({ token, telegramLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
});

// ---- Крок 2: вебхук, який Telegram викликає на кожне повідомлення ----
// Тимчасове зіставлення chatId -> token, поки чекаємо номер телефону
// (між /start і моментом, коли людина поділилась контактом).
const awaitingPhone = new Map();

function isPhoneLikeText(text) {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

async function deliverTelegramReport(chatId, token, phone) {
  const report = await reportStore.get(token);
  if (!report) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Схоже, звіт застарів. Зробіть новий скан на services.topmarketing.com.ua і спробуйте ще раз.'
    });
    return;
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: `Дякуємо! Ваш бал AI-видимості для «${report.brand}»: *${report.score ?? '—'}/100*\n\nПовний PDF-звіт з деталями — нижче 👇`,
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  });

  try {
    const pdfBuffer = await buildReportPdf({
      brand: report.brand,
      niche: report.niche,
      score: report.score,
      engines: report.engines || [],
      zoneOfInvisibility: report.zoneOfInvisibility || [],
      issues: report.issues || [],
      website: report.website, recommendations: report.recommendations, recognitionScore: report.recognitionScore, recommendationScore:report.recommendationScore, queryPlan:report.queryPlan
    });
    await telegramSendDocument(chatId, pdfBuffer, `AI-Visibility-${report.brand}.pdf`, 'Ваш повний AI-звіт');
  } catch (pdfErr) {
    console.error('Помилка генерації PDF для Telegram:', pdfErr);
  }

  // Keep the report available for subsequent delivery attempts.
  awaitingPhone.delete(chatId);

  // Реєструємо в чергу прогріву + загальну базу підписників. source
  // позначає воронку, з якої прийшла людина — зараз лише "ai-scanner",
  // але майбутні лід-магніти реєструватимуть людей сюди ж під своїм
  // source, у ту саму базу.
  const leads = loadTelegramLeads();
  const existing = leads.find(l => l.chatId === chatId);
  if (existing) {
    existing.phone = phone;
  } else {
    leads.push({
      chatId, phone, source: 'ai-scanner', tags: ['ai-scanner'],
      brand: report.brand, niche: report.niche, score: report.score,
      website:report.website, recommendations:report.recommendations,
      startedAt: new Date().toISOString(),
      sentIntro: false, sentDay1: false, sentDay3: false, sentDay5: false
    });
  }
  saveTelegramLeads(leads);

  if (LEAD_WEBHOOK_URL) {
    fetch(LEAD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '', phone: phone || '', email: '', brand: report.brand, niche: report.niche || '',
        score: report.score ?? null, status: 'Telegram-бот', ts: new Date().toISOString()
      })
    }).catch(e => console.warn('Помилка відправки Telegram-ліда на LEAD_WEBHOOK_URL:', e));
  }
}

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200); // Telegram чекає швидку відповідь, обробляємо асинхронно нижче
  try {
    const msg = req.body?.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (text.startsWith('/start')) {
      const token = text.split(' ')[1];
      const report = token ? await reportStore.get(token) : null;

      if (!report) {
        await telegramSend('sendMessage', {
          chat_id: chatId,
          text: 'Привіт! Схоже, посилання застаріло або відкрите не з сайту. Зробіть новий скан на services.topmarketing.com.ua і натисніть кнопку "Отримати в Telegram" ще раз.'
        });
        return;
      }

      // Не надсилаємо звіт одразу — спершу просимо номер телефону через
      // нативну кнопку Telegram (людина тисне, номер підтягується сам,
      // нічого вручну вводити не треба).
      awaitingPhone.set(chatId, token);
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: `Бачу ваш результат для «${report.brand}»! Щоб надіслати повний аналіз і PDF-звіт, поділіться, будь ласка, номером телефону — кнопкою нижче.`,
        reply_markup: {
          keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      });
      return;
    }

    // Людина поділилась контактом через кнопку — Telegram сам присилає
    // перевірений номер, підробити його важче, ніж вписати в звичайну форму.
    if (msg.contact && msg.contact.phone_number) {
      const token = awaitingPhone.get(chatId);
      if (!token) {
        await telegramSend('sendMessage', { chat_id: chatId, text: 'Дякуємо! Але я не бачу активного запиту на звіт — почніть із посилання на сайті.' });
        return;
      }
      await deliverTelegramReport(chatId, token, msg.contact.phone_number);
      return;
    }

    // Запасний варіант — людина просто написала номер текстом, а не
    // натиснула кнопку. Приймаємо і це, аби не створювати зайвого тертя.
    if (awaitingPhone.has(chatId) && isPhoneLikeText(text)) {
      const token = awaitingPhone.get(chatId);
      await deliverTelegramReport(chatId, token, text);
      return;
    }
  } catch (err) {
    console.error('Помилка обробки telegram-webhook:', err);
  }
});

// ---- Крок 3: чергу прогріву перевіряє зовнішній пінгер ----
app.get('/api/telegram-cron', async (req, res) => {
  const leads = loadTelegramLeads();
  const now = Date.now();
  let sentCount = 0;

  for (const lead of leads) {
    const hoursSince = (now - new Date(lead.startedAt).getTime()) / (1000 * 60 * 60);

    if (hoursSince >= 1 && !lead.sentIntro) {
      try {
        const introBuffer = fs.readFileSync(TELEGRAM_INTRO_IMAGE_PATH);
        await telegramSendPhoto(lead.chatId, introBuffer, 'intro-post.jpg', TELEGRAM_INTRO_MESSAGE);
      } catch (e) {
        console.warn('Не вдалось надіслати вступний пост:', e);
      }
      lead.sentIntro = true; sentCount++;
    } else if (hoursSince >= 24 && !lead.sentDay1) {
      await telegramSend('sendMessage', { chat_id: lead.chatId, text: TELEGRAM_DAY1_MESSAGE });
      lead.sentDay1 = true; sentCount++;
    } else if (hoursSince >= 72 && !lead.sentDay3) {
      await telegramSend('sendMessage', { chat_id: lead.chatId, text: TELEGRAM_DAY3_MESSAGE });
      lead.sentDay3 = true; sentCount++;
    } else if (hoursSince >= 120 && !lead.sentDay5) {
      await telegramSend('sendMessage', { chat_id: lead.chatId, text: TELEGRAM_DAY5_MESSAGE });
      lead.sentDay5 = true; sentCount++;
    }
  }

  saveTelegramLeads(leads);
  res.json({ ok: true, checked: leads.length, sent: sentCount });
});

// ---- Ручна розсилка — окремо від автоматичного прогріву 1/3/5 днів ----
// Приклад виклику (POST, JSON body):
// { "secret": "...", "message": "текст", "source": "ai-scanner" }
// Поле "source" необов'язкове — якщо не вказати, піде всій базі підписників
// незалежно від того, з якої воронки/лід-магніту вони прийшли.
// multer розбирає multipart/form-data — інші поля (secret, message, source,
// mediaUrl) опиняються у req.body так само, як при JSON, файл — у req.file.
app.post('/api/telegram-broadcast', uploadMedia.single('file'), async (req, res) => {
  if (!TELEGRAM_ADMIN_SECRET) {
    return res.status(400).json({ error: 'TELEGRAM_ADMIN_SECRET не налаштовано на сервері — розсилка вимкнена' });
  }
  const { secret, message, source, mediaUrl } = req.body || {};
  if (secret !== TELEGRAM_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Невірний пароль' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Поле "message" обовʼязкове' });
  }

  // Визначаємо тип медіа з файлу (MIME) чи розширення URL — окремого
  // селектора "фото/відео" в формі не треба, вгадуємо самі.
  const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i;
  let mediaKind = null; // 'photo' | 'video' | null
  let mediaSource = null; // Buffer або URL-рядок
  let mediaFilename = null;

  if (req.file) {
    mediaKind = req.file.mimetype.startsWith('video/') ? 'video' : 'photo';
    mediaSource = req.file.buffer;
    mediaFilename = req.file.originalname;
  } else if (mediaUrl && mediaUrl.trim()) {
    mediaKind = VIDEO_EXT.test(mediaUrl.trim()) ? 'video' : 'photo';
    mediaSource = mediaUrl.trim();
  }

  const leads = loadTelegramLeads();
  const targets = source ? leads.filter(l => l.source === source || (l.tags || []).includes(source)) : leads;

  let sent = 0;
  const failed = [];
  for (const lead of targets) {
    let result;
    if (mediaKind === 'photo') {
      result = await telegramSendPhoto(lead.chatId, mediaSource, mediaFilename, message);
    } else if (mediaKind === 'video') {
      result = await telegramSendVideo(lead.chatId, mediaSource, mediaFilename, message);
    } else {
      result = await telegramSend('sendMessage', { chat_id: lead.chatId, text: message });
    }
    if (result.ok) sent++;
    else failed.push({ chatId: lead.chatId, error: result.description || result.error });
    // Невелика пауза, щоб не впертись у ліміт Telegram (~30 повідомлень/сек)
    await new Promise(r => setTimeout(r, 50));
  }

  res.json({ ok: true, targeted: targets.length, sent, failed, mediaKind });
});

// ==================== SENDPULSE-ІНТЕГРАЦІЯ (для одного бота) ====================
// Коли Telegram-бот повністю під керуванням SendPulse (їхній вебхук, їхній
// конструктор), унікальну частину — реальний скан і персональний PDF —
// SendPulse викликає САМЕ ТУТ через свій блок "API Request" у потоці.
//
// Приклад запиту з боку SendPulse (POST, JSON):
// { "token": "{{start-параметр з deep-link}}", "phone": "{{номер з Request Contact}}", "chatId": "{{chat id}}" }
//
// Відповідь:
// { "ok": true, "score": 62, "brand": "...", "tier": "На радарах", "pdfUrl": "https://.../reports/xxx.pdf" }
// Підставте ці поля як змінні у наступні кроки потоку (текст балу + "Send file by URL").
app.post('/api/sendpulse-report', async (req, res) => {
  try {
    const { token, phone, chatId } = req.body || {};
    if (!validReportToken(token)) return res.status(400).json({ ok: false, error: 'Коректний код звіту обов’язковий' });

    const report = await reportStore.get(token);
    if (!report) {
      return res.status(404).json({ ok: false, error: 'Звіт застарів або не знайдений — зробіть новий скан на сайті' });
    }

    let pdfBuffer = await reportStore.getPdf(token);
    if (!pdfBuffer) pdfBuffer = await buildReportPdf({
      brand: report.brand,
      niche: report.niche,
      score: report.score,
      engines: report.engines || [],
      zoneOfInvisibility: report.zoneOfInvisibility || [],
      issues: report.issues || [],
      website: report.website, recommendations: report.recommendations, recognitionScore: report.recognitionScore, recommendationScore:report.recommendationScore, queryPlan:report.queryPlan
    });

    const filename = `${token}.pdf`;
    await reportStore.savePdf(token, pdfBuffer);
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `https://${req.get('host')}`;
    const pdfUrl = `${baseUrl}/reports/${filename}`;

    let tier;
    const score = report.score;
    if (score === null || score === undefined) tier = 'Недостатньо даних';
    else if (score < 30) tier = 'Поза радаром';
    else if (score < 60) tier = 'На радарах';
    else if (score < 85) tier = 'Впізнають';
    else tier = 'Лідер сигналу';

    // Generated PDFs and reports remain available for later requests.

    if (LEAD_WEBHOOK_URL && phone && await reportStore.claimLeadNotification(token)) {
      fetch(LEAD_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '', phone: phone || '', email: '', brand: report.brand, niche: report.niche || '',
          score: report.score ?? null, status: 'Telegram-бот (SendPulse)', ts: new Date().toISOString()
        })
      }).then(response => { if (!response.ok) throw new Error('Lead webhook failed'); }).catch(async e => {
        await reportStore.releaseLeadNotification(token).catch(() => {});
        console.warn('SendPulse lead webhook failed:', e.message);
      });
    }

    const interpretation = score < 30
      ? 'У цій перевірці AI-видимість бренду низька. Почніть із відповідей окремих систем і перевірте, чи правильно вони описують ваш бізнес.'
      : score < 60
        ? 'Бренд уже має видимість у частині перевірених відповідей. У звіті подивіться, де AI впізнає вас, а де плутає або не згадує.'
        : score < 85
          ? 'У цій перевірці бренд має помітну AI-видимість. Зверніть увагу на різницю між впізнаванням назви та рекомендаціями за запитами клієнтів.'
          : 'У цій перевірці бренд отримав високий бал AI-видимості. Перегляньте відповіді кожної системи, щоб зрозуміти, де позиції найсильніші.';
    const details = report.recommendations ? recommendationSummary(report.recommendations) : interpretation;
    const reportSummary = `Ваш звіт для «${String(report.brand).slice(0,100)}» готовий.\n\nЗнання бренду: ${score ?? '—'}/100\n\n${details}\n\nЗнання бренду та рекомендації оцінюються окремо. Повний розбір - у PDF.`;

    const reportGuide = 'З чого почати\n\n1. Перегляньте, що кожна AI-система говорить про ваш бренд.\n2. Порівняйте впізнавання назви з рекомендаціями за нішевими запитами.\n3. Подивіться, яких конкурентів називає AI, і виберіть перші дії з рекомендацій у PDF.\n\nХочете визначити пріоритети для свого бізнесу? Напишіть «Розібрати звіт» — обговоримо результат і наступні кроки.';
    res.json({ ok: true, score: report.score, brand: report.brand, tier, pdfUrl, reportSummary, reportGuide, recognitionScore:report.recognitionScore ?? report.score, recommendationScore:report.recommendationScore ?? report.recommendations?.score ?? null, recommendations:report.recommendations || null });
  } catch (err) {
    console.error('Помилка /api/sendpulse-report:', err);
    res.status(500).json({ ok: false, error: 'Внутрішня помилка сервера' });
  }
});

// ---- Одноразово: зареєструвати вебхук у Telegram (відкрити раз у браузері) ----
app.get('/api/telegram-setup', async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не налаштовано на сервері' });
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `https://${req.get('host')}`;
  const webhookUrl = `${baseUrl}/telegram-webhook`;
  const result = await telegramSend('setWebhook', { url: webhookUrl });
  res.json({ webhookUrl, result });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    analysisVersion: 3,
    queryPlannerVersion: 2,
    recommendationPromptVersion: 2, knowledgeVersion: 4,
    performanceVersion:1,
    models:{chatgpt:OPENAI_MODEL,gemini:GEMINI_MODEL,perplexity:"sonar",claude:CLAUDE_MODEL,analysis:ANALYSIS_MODEL},
    deadlinesMs:{provider:PROVIDER_TIMEOUT_MS,analysis:ANALYSIS_TIMEOUT_MS,queryPlan:PLAN_TIMEOUT_MS},
    reportStorage: { kind: reportStore.kind, durable: reportStore.durable },
    keys: {
      openai: Boolean(OPENAI_API_KEY),
      gemini: Boolean(GEMINI_API_KEY),
      perplexity: Boolean(PERPLEXITY_API_KEY),
      anthropic: Boolean(ANTHROPIC_API_KEY),
      resend: Boolean(RESEND_API_KEY),
      leadWebhook: Boolean(LEAD_WEBHOOK_URL),
      telegramBot: Boolean(TELEGRAM_BOT_TOKEN)
    },
    leadWebhookUrlPreview: LEAD_WEBHOOK_URL ? LEAD_WEBHOOK_URL.slice(0, 45) + '...' : null
  });
});

export { app, buildReportPdf };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(PORT, () => console.log(`AI-Visibility backend running on http://localhost:${PORT}`));
}
