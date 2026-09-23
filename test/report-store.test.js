import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PostgresReportStore, createReportStore } from '../report-store.js';

async function openStore(dir) {
  const db = new PGlite(dir);
  const store = new PostgresReportStore({ query: (sql, params) => db.query(sql, params), end: () => db.close() });
  await store.init();
  return store;
}

test('report and PDF survive reopening PostgreSQL; a 60-day-old report stays retrievable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-report-pg-'));
  const token = 'abc123testreportrestart';
  const report = {brand:'Перевірка бренду',score:63,ts:Date.now()-60*24*3600000};
  const pdf = Buffer.from('%PDF-1.4\nDurable report bytes');
  let store;
  try {
    store = await openStore(dir);
    await store.set(token, report);
    await store.savePdf(token, pdf);
    assert.equal(await store.claimLeadNotification(token), true);
    await store.close();
    store = await openStore(dir);
    assert.deepEqual(await store.get(token), report);
    assert.deepEqual(await store.getPdf(token), pdf);
    assert.equal(await store.claimLeadNotification(token), false);
    await store.releaseLeadNotification(token);
    assert.equal(await store.claimLeadNotification(token), true);
    assert.deepEqual(await store.savePdf(token, Buffer.from('do not overwrite')), pdf);
    assert.equal(await store.get('unknownreporttoken'), null);
    assert.equal(await store.get("'; DROP TABLE ai_visibility_reports;--"), null);
    assert.deepEqual(await store.get(token), report);
  } finally {
    if (store) await store.close();
    await rm(dir, { recursive:true, force:true });
  }
});

test('unconfigured store explicitly reports non-durable mode', async () => {
  const store = await createReportStore('');
  assert.equal(store.durable, false);
  assert.equal(store.kind, 'memory');
});
