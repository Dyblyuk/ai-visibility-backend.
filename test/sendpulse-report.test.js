import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendPulseReportHandler, REPORT_TTL_MS } from '../sendpulse-report.js';

const secret = 'test-only-secret-not-for-production-123456';
const valid = { token: 'report-token', phone: '+380671234567', contactId: 'subscriber_1' };
function fixture(options = {}) {
  const report = { brand: 'Test brand', score: 42, ts: 1000 };
  const reports = new Map([[valid.token, report]]);
  let generations = 0;
  let notifications = 0;
  const handler = createSendPulseReportHandler({
    reports, secret, now: () => 1001,
    generate: async () => {
      generations++;
      return { ok: true, pdfUrl: 'https://example.test/report.pdf' };
    },
    onReady: () => { notifications++; },
    ...options
  });
  async function call(body = valid, header = secret) {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    await handler({ body, get: () => header }, res);
    return res;
  }
  return { call, report, reports, generations: () => generations, notifications: () => notifications };
}

test('fails closed before inspecting tokens when integration secret is absent or short', async () => {
  for (const value of ['', 'short']) {
    const f = fixture({ secret: value });
    assert.equal((await f.call()).statusCode, 503);
    assert.equal(f.generations(), 0);
  }
});

test('unauthenticated requests cannot generate PDF or claim a report', async () => {
  for (const header of [undefined, '', 'invalid', 'x'.repeat(secret.length)]) {
    const f = fixture();
    // Explicitly null prevents the helper's default parameter from supplying a secret.
    assert.equal((await f.call(valid, header ?? null)).statusCode, 401);
    assert.equal(f.generations(), 0);
    assert.equal(f.report.claim, undefined);
  }
});

test('requires contact and subscriber identity before generation', async () => {
  for (const body of [
    { token: valid.token }, { ...valid, phone: '' }, { ...valid, phone: 380671234567 },
    { ...valid, phone: 'not-a-phone' }, { ...valid, phone: '+11111111111' },
    { ...valid, contactId: '' }, { ...valid, contactId: '{{contactId}}' },
    { ...valid, token: {} }
  ]) {
    const f = fixture();
    assert.equal((await f.call(body)).statusCode, 400);
    assert.equal(f.generations(), 0);
    assert.equal(f.report.claim, undefined);
  }
});

test('rejects unknown and expired reports even without a subsequent scan', async () => {
  assert.equal((await fixture().call({ ...valid, token: 'missing' })).statusCode, 404);
  const f = fixture({ now: () => 1000 + REPORT_TTL_MS });
  assert.equal((await f.call()).statusCode, 404);
  assert.equal(f.generations(), 0);
});

test('same subscriber can retry without consuming token or regenerating PDF', async () => {
  const f = fixture();
  const first = await f.call();
  const retry = await f.call({ ...valid, phone: '+38 (067) 123-45-67' });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(retry.body, first.body);
  assert.equal(f.generations(), 1);
  assert.equal(f.notifications(), 1);
  assert.equal(f.reports.has(valid.token), true);
});

test('another subscriber or different phone cannot take a claimed report', async () => {
  const f = fixture();
  await f.call();
  assert.equal((await f.call({ ...valid, contactId: 'subscriber_2' })).statusCode, 409);
  assert.equal((await f.call({ ...valid, phone: '+380671234568' })).statusCode, 409);
  assert.equal(f.generations(), 1);
});

test('concurrent retries generate one PDF and send one secondary notification', async () => {
  const f = fixture();
  const responses = await Promise.all([f.call(), f.call(), f.call()]);
  assert.ok(responses.every(r => r.statusCode === 200));
  assert.equal(f.generations(), 1);
  assert.equal(f.notifications(), 1);
});

test('a competing contact cannot claim the report during generation', async () => {
  const f = fixture();
  const first = f.call();
  const other = await f.call({ ...valid, contactId: 'subscriber_2' });
  assert.equal(other.statusCode, 409);
  assert.equal((await first).statusCode, 200);
});

test('generation failure preserves report for retry and does not expose internals', async () => {
  let attempts = 0;
  const f = fixture({ generate: async () => {
    if (++attempts === 1) throw new Error('secret internal path');
    return { ok: true, pdfUrl: 'https://example.test/retry.pdf' };
  } });
  const failed = await f.call();
  assert.equal(failed.statusCode, 500);
  assert.ok(!JSON.stringify(failed.body).includes('secret internal path'));
  assert.equal((await f.call()).statusCode, 200);
  assert.equal(attempts, 2);
});

test('secondary CRM failure does not prevent PDF delivery or retry', async () => {
  const f = fixture({ onReady: async () => { throw new Error('CRM unavailable'); } });
  assert.equal((await f.call()).statusCode, 200);
  assert.equal((await f.call()).statusCode, 200);
  assert.equal(f.generations(), 1);
});
