# Деплой бекенду на Render через GitHub

## Крок 1. Створіть репозиторій на GitHub

1. Зайдіть на github.com → New repository.
2. Назва, наприклад: `ai-visibility-backend`.
3. Залиште приватним або публічним — на ваш розсуд (ключі однаково не потраплять
   у код, вони в `.env`, який ігнорується через `.gitignore`).
4. Нічого не ставте у "Initialize this repository with" (без README, без .gitignore) — щоб не було конфліктів. Створіть.
5. GitHub покаже вам URL репозиторію, щось на кшталт:
   `https://github.com/ваш-логін/ai-visibility-backend.git` — скопіюйте його.

## Крок 2. Заливаєте код

У терміналі перейдіть у папку `ai-visibility-backend` (та, що я вам віддав) і виконайте по черзі:

```bash
git init
git add .
git commit -m "AI-visibility backend"
git branch -M main
git remote add origin https://github.com/ваш-логін/ai-visibility-backend.git
git push -u origin main
```

Якщо це перший раз, коли ви пушите на GitHub з цього компʼютера — система попросить
авторизуватись (логін/пароль більше не працює, знадобиться Personal Access Token
або вхід через браузер, який відкриється автоматично).

Перевірка: оновіть сторінку репозиторію на github.com — має зʼявитись список файлів
(`server.js`, `package.json`, `README.md` і т.д.). Файлу `.env` там **не повинно бути**.

## Крок 3. Підключаєте репозиторій до Render

1. Зайдіть на render.com → **New** → **Web Service**.
2. Оберіть **Build and deploy from a Git repository**.
3. Якщо GitHub ще не підключений — натисніть **Connect account**, авторизуйте Render у GitHub.
4. У списку репозиторіїв знайдіть `ai-visibility-backend` і натисніть **Connect**.

## Крок 4. Налаштування сервісу

Заповніть поля:

| Поле | Значення |
|---|---|
| Name | будь-яке, напр. `ai-visibility-backend` |
| Region | найближчий до вас |
| Branch | `main` |
| Root Directory | залиште порожнім |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free (для старту) |

## Крок 5. Додайте ключі

Прокрутіть до розділу **Environment Variables** і додайте по одному (кнопка **Add Environment Variable**):

```
OPENAI_API_KEY      = ваш ключ з platform.openai.com
GEMINI_API_KEY       = ваш ключ з aistudio.google.com/app/apikey
PERPLEXITY_API_KEY   = ваш ключ з perplexity.ai/settings/api
ANTHROPIC_API_KEY    = ваш ключ з console.anthropic.com
CLAUDE_MODEL         = claude-sonnet-5
```

Можна не заповнювати всі одразу — сканер покаже помилку тільки по тому двигуну,
чийого ключа немає, решта відпрацюють нормально.

## Крок 6. Deploy

Натисніть **Create Web Service** внизу. Render сам зробить `npm install` і запустить сервер.
Це займе кілька хвилин — прогрес видно в логах на екрані.

Коли деплой завершиться, вгорі зʼявиться URL типу:
```
https://ai-visibility-backend.onrender.com
```

## Крок 7. Перевірте, що все підключилось

Відкрийте в браузері:
```
https://ai-visibility-backend.onrender.com/api/health
```

Має показати щось на кшталт:
```json
{"ok":true,"keys":{"openai":true,"gemini":true,"perplexity":true,"anthropic":true}}
```

Якщо якийсь ключ `false` — перевірте, чи правильно він вписаний у Environment Variables на Render.

## Крок 8. Підключіть фронтенд

Відкрийте `ai-visibility-scanner.html`, знайдіть рядок:

```js
const API_URL = '';
```

і впишіть туди свій URL з кроку 6:

```js
const API_URL = 'https://ai-visibility-backend.onrender.com/api/scan';
```

(зверніть увагу — в кінці додається `/api/scan`, а не просто адреса сервера).

Збережіть файл — сканер тепер робитиме реальні запити.

---

## Далі: як оновлювати код

Коли захочете щось поправити в `server.js` — просто:

```bash
git add .
git commit -m "опис зміни"
git push
```

Render сам побачить новий push і передеплоїть сервіс автоматично — нічого
додатково робити на render.com не треба.

## Безкоштовний план: нюанс

На Free-плані сервіс "засинає" без запитів і перший виклик після сну може
займати 20–50 секунд, поки прокинеться. Для лід-магніту зазвичай не критично.
