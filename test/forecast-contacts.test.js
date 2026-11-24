import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ConversionOutbox, createConversionWorker, makeContactEvent } from '../ad-conversions.js';

test('two lead magnets share one Meta event per contact and keep the original source', async () => {
  const db = new PGlite();
  try {
    const outbox = new ConversionOutbox(db);
    await outbox.init();
    await outbox.importForecastMeta(); // Older databases can still serve AI Visibility.
    await db.query('CREATE TABLE forecast_meta_contacts(event_id text primary key,payload jsonb,confirmed_at timestamptz)');
    const received = [];
    const env = {ADS_CONVERSIONS_ENABLED:'true', SENDPULSE_TRACKING_SECRET:'fixture', META_API_VERSION:'fixture',
      META_PIXEL_ID:'fixture', META_CAPI_ACCESS_TOKEN:'fixture', META_TEST_EVENT_CODE:'TEST_FIXTURE'};
    const work = createConversionWorker({outbox,env,fetchFn:async (url,opts) => {
      const payload = JSON.parse(opts.body);
      assert.equal(payload.test_event_code,env.META_TEST_EVENT_CODE);
      received.push(payload.data[0]);
      return {ok:true,json:async()=>({events_received:1,fbtrace_id:'fixture-receipt'})};
    }});
    const attribution = {fbc:'fb.1.1777000000000.fixture',consent:{}};
    const contact = makeContactEvent('+380000000123',attribution);
    const addForecast = async lead => db.query('INSERT INTO forecast_meta_contacts VALUES($1,$2::jsonb,NOW())',
      [lead.id,JSON.stringify({...lead,product:'kpi_calculator'})]);
    await addForecast(contact);
    await work();
    await outbox.enqueue(contact);
    await addForecast(contact);
    await work();
    assert.equal(received.length,1);
    assert.equal(received[0].event_id,contact.id);
    assert.equal(received[0].event_name,'Lead');
    assert.equal(received[0].custom_data.lead_magnet,'kpi_calculator');
    assert.equal(received[0].user_data.ph,undefined);
    assert.equal((await db.query('SELECT count(*) FROM forecast_meta_contacts')).rows[0].count,0);
    const old = makeContactEvent('+380000000124',attribution);
    await outbox.enqueue(old);
    await addForecast(old);
    await work();
    await work();
    assert.equal(received.length,2);
    assert.equal(received[1].custom_data.content_name,'AI Visibility report');
    const skipped = makeContactEvent('+380000000125',{});
    await outbox.enqueue(skipped);
    await work();
    await addForecast({...skipped,attribution});
    await work();
    assert.equal(received.length,3);
    assert.equal(received[2].custom_data.content_name,'KPI Calculator report');
    assert.equal((await db.query("SELECT status FROM ad_conversion_outbox WHERE platform='meta' AND event_id=$1",[skipped.id])).rows[0].status,'test_sent');
  } finally { await db.close(); }
});
