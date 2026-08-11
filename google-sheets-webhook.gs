/**
 * AI-Visibility Scanner — приймач лідів у Google Sheets
 *
 * Як підключити:
 * 1. Створіть нову Google Таблицю (sheets.new).
 * 2. У ній: Розширення → Apps Script.
 * 3. Видаліть весь код-заглушку і вставте цей файл повністю.
 * 4. Зверху натисніть "Зберегти" (значок дискети).
 * 5. Натисніть "Розгорнути" (Deploy) → "Нове розгортання" (New deployment).
 *    - Тип: "Веб-застосунок" (Web app)
 *    - Execute as: "Me" (ваш акаунт)
 *    - Who has access: "Anyone" (обов'язково — інакше бекенд не зможе достукатись)
 * 6. Натисніть "Розгорнути". Google попросить надати дозволи — погодьтесь
 *    (це ваш власний скрипт, дозвіл потрібен, щоб він міг писати у вашу таблицю).
 * 7. Скопіюйте URL веб-застосунку — він виглядає так:
 *    https://script.google.com/macros/s/AKfycb.../exec
 * 8. Цей URL — і є ваш LEAD_WEBHOOK_URL. Впишіть його в Environment
 *    Variables на Render (або в .env локально).
 *
 * Оновлення скрипта пізніше: після будь-яких змін коду тут — знову
 * "Розгорнути" → "Керувати розгортаннями" → значок олівця → "Нова версія" →
 * "Розгорнути". URL залишається той самий.
 */

function doPost(e) {
  try {
    const sheet = getOrCreateSheet_();
    const data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      data.ts || new Date().toISOString(),
      data.name || '',
      data.contact || '',
      data.brand || '',
      data.niche || '',
      (data.score === undefined || data.score === null) ? '' : data.score
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// На випадок, якщо захочете відкрити URL в браузері просто щоб перевірити,
// що скрипт живий (замість реальної відправки ліда).
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'AI-Visibility lead receiver працює. Приймає лише POST.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Ліди');
  if (!sheet) {
    sheet = ss.insertSheet('Ліди');
    sheet.appendRow(['Час', "Ім'я", 'Контакт', 'Бренд', 'Ніша', 'Бал']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
