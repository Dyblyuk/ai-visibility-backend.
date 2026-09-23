import { timingSafeEqual } from 'node:crypto';

export const REPORT_TTL_MS = 60 * 60 * 1000;

// Only a trusted SendPulse flow may call this handler, AFTER Share Contact.
// Presence of a phone alone does not prove Telegram contact ownership.
export function createSendPulseReportHandler({ reports, secret, generate, onReady = () => {}, now = Date.now }) {
  const inFlight = new Map();
  return async (req, res) => {
    const fail = (status, error) => res.status(status).json({ ok: false, error });
    if (typeof secret !== 'string' || secret.length < 32) {
      return fail(503, 'Інтеграцію SendPulse ще не налаштовано');
    }
    const supplied = req.get('x-sendpulse-secret');
    const expectedBytes = Buffer.from(secret);
    const suppliedBytes = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      return fail(401, 'Неавторизований запит');
    }
    const { token, phone, contactId } = req.body || {};
    if (typeof token !== 'string' || !token || token.length > 128) {
      return fail(400, 'Код звіту обов’язковий');
    }
    if (typeof phone !== 'string' || !/^\+?[\d ()-]+$/.test(phone)) {
      return fail(400, 'Спочатку поділіться контактом у Telegram');
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15 || /^(\d)\1+$/.test(digits)) {
      return fail(400, 'Некоректний номер телефону');
    }
    if (typeof contactId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(contactId)) {
      return fail(400, 'Ідентифікатор підписника обов’язковий');
    }
    const report = reports.get(token);
    if (!report || !Number.isFinite(report.ts) || now() - report.ts >= REPORT_TTL_MS) {
      if (report) reports.delete(token);
      return fail(404, 'Звіт застарів або не знайдений — зробіть новий скан на сайті');
    }
    if (report.claim && (report.claim.contactId !== contactId || report.claim.phone !== digits)) {
      return fail(409, 'Цей звіт уже прив’язаний до іншого контакту');
    }
    // Claim synchronously before awaiting generation, including concurrent calls.
    report.claim ||= { contactId, phone: digits };
    if (report.sendpulseResult) return res.json(report.sendpulseResult);
    if (!inFlight.has(token)) {
      const generation = Promise.resolve().then(async () => {
        const result = await generate(report, token, req);
        report.sendpulseResult = result;
        // Delivery must not depend on an optional secondary CRM notification.
        try { await onReady(report, { contactId, phone: `+${digits}` }); }
        catch { /* PDF remains available for the same subscriber. */ }
        return result;
      });
      inFlight.set(token, generation);
    }
    const generation = inFlight.get(token);
    try {
      return res.json(await generation);
    } catch {
      return fail(500, 'Не вдалося сформувати PDF. Спробуйте ще раз');
    } finally {
      if (inFlight.get(token) === generation) inFlight.delete(token);
    }
  };
}
