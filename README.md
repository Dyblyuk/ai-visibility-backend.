# AI-Visibility Scanner — бекенд

Робить реальні запити до ChatGPT, Gemini і Perplexity та перевіряє,
чи згадується ваш бренд у відповіді.

## Локальний запуск

```bash
npm install
cp .env.example .env
# впишіть у .env свої ключі:
#   OPENAI_API_KEY      — platform.openai.com
#   GEMINI_API_KEY      — aistudio.google.com/app/apikey
#   PERPLEXITY_API_KEY  — perplexity.ai/settings/api
npm start
```

Сервер підніметься на `http://localhost:8787`.
Перевірка: `GET http://localhost:8787/api/health` — покаже, які ключі підхопились.

Можна вписати не всі три ключі — сканер просто покаже помилку по тому
двигуну, ключ якого не задано, а решта відпрацюють.

## Деплой на Render без GitHub (через Docker-образ)

Render може розгорнути готовий Docker-образ напряму з реєстру — без підключення
GitHub чи будь-якого git-провайдера взагалі. Знадобиться лише безкоштовний
акаунт на [Docker Hub](https://hub.docker.com) і встановлений [Docker](https://www.docker.com/products/docker-desktop/)
на вашому компʼютері.

1. **Зберіть образ.** У терміналі в папці `ai-visibility-backend`:
   ```bash
   docker build -t ваш-докерхаб-логін/ai-visibility-backend:latest .
   ```

2. **Залогіньтесь і запуште образ у Docker Hub:**
   ```bash
   docker login
   docker push ваш-докерхаб-логін/ai-visibility-backend:latest
   ```
   Після цього образ публічно доступний за адресою
   `ваш-докерхаб-логін/ai-visibility-backend:latest` — саме цей рядок Render
   і буде тягнути.

3. **На render.com**: New → Web Service → вкладка **"Deploy an existing image from a registry"**
   (замість "Build and deploy from a Git repository" — це і є шлях без GitHub).
   Вкажіть `ваш-докерхаб-логін/ai-visibility-backend:latest`.

4. Налаштування сервісу:
   - Render сам побачить `EXPOSE 8787` з Dockerfile — порт можна не чіпати.
   - Instance Type: безкоштовний/наймолодший план для старту.

5. Розділ **Environment** → додайте по одному:
   `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL=claude-sonnet-5`.

6. Deploy. Отримаєте URL типу `https://ai-visibility-backend.onrender.com`.

**Оновлення коду:** коли зміните `server.js`, повторіть кроки 1–2 (build + push
з тим самим тегом `:latest`), а тоді в Render дашборді натисніть **Manual Deploy** —
Render перетягне свіжий образ. Автоматичного передеплою на push тут не буде
(це і є плата за відсутність git-інтеграції) — оновлюєте вручну щоразу.

---

## Деплой на Render через GitHub (альтернатива, з авто-передеплоєм)

1. **Залийте цю папку в GitHub.** У терміналі в папці `ai-visibility-backend`:
   ```bash
   git init
   git add .
   git commit -m "AI-visibility backend"
   git branch -M main
   git remote add origin https://github.com/<ваш-акаунт>/ai-visibility-backend.git
   git push -u origin main
   ```
   `.env` не потрапить у git — він у `.gitignore`. Це навмисно: ключі не повинні бути в репозиторії.

2. **На render.com**: New → Web Service → Build and deploy from a Git repository → оберіть щойно створений репозиторій.

3. Налаштування сервісу:
   - Root Directory: залиште порожнім (якщо в репо лежить тільки ця папка) або вкажіть `ai-visibility-backend`, якщо заливали в загальний репозиторій.
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: підійде безкоштовний/наймолодший план для старту.

4. Розділ **Environment** → Add Environment Variable — додайте по одному:
   `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (значення `claude-sonnet-5`).
   Це і є заміна файлу `.env` у продакшені.

5. Deploy. Render видасть URL типу `https://ai-visibility-backend.onrender.com`.

6. Перевірте `https://ai-visibility-backend.onrender.com/api/health` — має показати `true` по всіх ключах, які ви заповнили.

7. У фронтенді (`ai-visibility-scanner.html`) впишіть цей URL у змінну `API_URL`:
   ```js
   const API_URL = 'https://ai-visibility-backend.onrender.com/api/scan';
   ```

**Нюанс безкоштовного плану Render:** сервіс «засинає» без запитів і перший виклик після сну може займати 20–50 секунд. Для лід-магніту це не критично, але якщо це буде відчутно — потрібен платний план без сну.

**CORS:** бекенд зараз дозволяє запити з будь-якого домену (`cors()` без обмежень). Коли фронтенд буде на постійному домені, варто обмежити `origin` конкретно ним — так інші сайти не зможуть використовувати ваш бекенд і витрачати ваші токени.

## Ендпоінт

`POST /api/scan`
```json
{ "brand": "Top Marketing", "niche": "performance-маркетинг, Київ" }
```

Відповідь:
```json
{
  "query": "...",
  "engines": {
    "chatgpt":    { "hit": true,  "snippet": "…" },
    "gemini":     { "hit": false, "snippet": "" },
    "perplexity": { "hit": true,  "snippet": "…" },
    "claude":     { "hit": true,  "snippet": "…" }
  },
  "zoneOfInvisibility": [
    {
      "query": "Порадь кілька найкращих варіантів: performance-маркетинг, Київ...",
      "engines": {
        "chatgpt":    { "mentionedBrand": false, "competitors": ["Агенція А", "Агенція Б"] },
        "gemini":     { "mentionedBrand": true,  "competitors": [] },
        "perplexity": { "mentionedBrand": false, "competitors": ["Студія В"] },
        "claude":     { "mentionedBrand": false, "competitors": ["Агенція А", "Компанія Г"] }
      }
    }
  ]
}
```

`zoneOfInvisibility` — це "зона невидимості": декілька відкритих нішевих
запитів (без згадки вашого бренду в самому запиті) до всіх систем.
Якщо бренд не згадано у відповіді — окремим викликом Claude витягуються
назви компаній, які AI назвав замість вас. Поле `niche` для цього
обов'язкове по суті (без нього секція буде порожньою — `buildDiscoveryQueries`
поверне `[]`).

**Вартість:** ця секція суттєво збільшує кількість викликів API за один скан —
до `DISCOVERY_QUERY_COUNT × DISCOVERY_ENGINES × 2` (сам запит + витягування
конкурентів, коли бренд не згадано). За замовчуванням це 3 запити × 4 системи
= до 24 додаткових викликів. Зменшити можна через `.env`:
```
DISCOVERY_QUERY_COUNT=1
DISCOVERY_ENGINES=chatgpt,perplexity
```

## Ліди (розблокування повного звіту)

`POST /api/lead`
```json
{ "name": "Ірина", "contact": "irina@example.com", "brand": "Top Marketing", "niche": "маркетинг, Київ", "score": 62 }
```

Фронтенд викликає цей ендпоінт, коли людина заповнює форму "Отримати повний
звіт і консультацію" на сторінці. Кожен лід дописується рядком у файл
`leads.jsonl` поруч із `server.js`, і опційно відправляється на
`LEAD_WEBHOOK_URL`, якщо ви його задали.

**⚠️ Важливо на Render (і більшості хмарних хостингів):** диск ефемерний —
`leads.jsonl` зникає при кожному передеплої чи перезапуску контейнера
(а безкоштовний план "засинає" і час від часу перезапускається сам). Файл
годиться лише для локальної розробки й швидкої перевірки. **Для продакшену
обов'язково задайте `LEAD_WEBHOOK_URL`**, щоб ліди летіли кудись постійне.
Готова покрокова інструкція для Google Таблиці — у файлі
[`GOOGLE-SHEETS-SETUP.md`](./GOOGLE-SHEETS-SETUP.md) (скрипт-приймач:
[`google-sheets-webhook.gs`](./google-sheets-webhook.gs)). Альтернативи:
- Telegram — через Make.com/Zapier "Webhook → Telegram" сценарій
- будь-яка CRM з підтримкою вхідних вебхуків

Подивитись, що вже зібралось у файлі (тільки для локальної перевірки):
`GET /api/leads` — у проді цей роут варто прибрати або захистити токеном,
бо зараз він відкритий для будь-кого, хто знає URL.

## Обмеження чесно

- Це один запит-приклад на кожну систему, не статистична вибірка з
  сотень запитів, як у методології "Клиенты из AI". Для стабільної
  оцінки варто запускати кілька формулювань запиту і кілька разів.
- Perplexity використовує модель `sonar` (з доступом до вебу) —
  найближче з трьох до "реального" пошуку. ChatGPT (`gpt-4o-mini`) і
  Gemini (`gemini-1.5-flash`) відповідають з власних знань, без
  живого вебпошуку, якщо явно не увімкнути відповідні інструменти.
- Виміри "Широта / Глибина / Точка збору" на фронтенді лишаються
  ілюстративною (не виміряною) оцінкою — чесний повний вимір цих
  осей вимагає окремого аналізу зовнішніх згадок, а не одного запиту.
