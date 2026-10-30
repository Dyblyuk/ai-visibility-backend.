import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {cleanAttribution,makeContactEvent,openaiAdsPayload,trackingStatus,ConversionOutbox,createConversionWorker} from '../ad-conversions.js';

const env={ADS_CONVERSIONS_ENABLED:'true',SENDPULSE_TRACKING_SECRET:'fixture',OPENAI_ADS_CAPI_KEY:'fixture-key-only'};

test('OpenAI click and browser reference survive the report handoff without truncation and clear on opt-out',async()=>{
  const code=await readFile(new URL('../ad-attribution.js',import.meta.url),'utf8');
  const click='opaque_'+'x'.repeat(800);
  const dom=new JSDOM('',{url:'https://services.topmarketing.com.ua/?oppref='+click,runScripts:'outside-only'});
  try {
    dom.window.eval(code);dom.window.document.cookie='__obref=browser-reference';
    dom.reconfigure({url:'https://services.topmarketing.com.ua/'});dom.window.eval(code);
    const a=cleanAttribution(dom.window.tmAdAttribution());
    assert.equal(a.oppref,click);assert.equal(a.obref,'browser-reference');
    dom.window.tmAdsConsent={adStorage:'denied'};
    assert.deepEqual(cleanAttribution(dom.window.tmAdAttribution()),{consent:{adUserData:'denied'}});
    assert.equal(dom.window.localStorage.getItem('tm_ad_attribution_v1'),null);
  } finally {dom.window.close();}
});

test('only real contact payloads use contact time and chat source, preserving references and normalized hashes',()=>{
  const event=makeContactEvent('+12133734253',{oppref:'opaque',obref:'browser',consent:{adUserData:'granted'}},1700000000000);
  const item=openaiAdsPayload(event).events[0];
  assert.equal(item.type,'registration_completed');assert.equal(item.timestamp_ms,1700000000000);
  assert.equal(item.action_source,'other');assert.equal(item.source_url,undefined);
  assert.equal(item.oppref,'opaque');assert.equal(item.user.obref,'browser');
  assert.deepEqual(item.user.phone_numbers_sha256,[event.metaPhone]);
  assert.ok(!JSON.stringify(item).includes('12133734253'));
  assert.equal(openaiAdsPayload(makeContactEvent('+12133734253',{})).events[0].user,undefined);
  assert.equal(openaiAdsPayload({...event,attribution:{consent:{adUserData:'denied'}}}),null);
  assert.equal(openaiAdsPayload(makeContactEvent('+12133734253',{gclid:'tm_google_validation_example'})),null);
  assert.equal(trackingStatus(env,true).openaiAdsConfigured,true);
  assert.equal(trackingStatus({...env,OPENAI_ADS_CAPI_KEY:''},true).openaiAdsConfigured,false);
  assert.equal(trackingStatus({...env,OPENAI_ADS_CAPI_KEY:'<API-KEY>'},true).openaiAdsConfigured,false);
});

test('OpenAI delivery waits for key, retries failure durably with same ID, accepts empty 204, and deduplicates',async()=>{
  const db=new PGlite();const outbox=new ConversionOutbox(db);await outbox.init();
  const event=makeContactEvent('+12133734253',{oppref:'opaque'});
  let calls=0;const ids=[];
  try {
    await outbox.enqueue(event);await outbox.enqueue(event);
    const disabled=createConversionWorker({outbox,env:{...env,OPENAI_ADS_CAPI_KEY:''},fetchFn:async()=>{throw Error('must not send');}});
    await disabled();
    assert.equal((await db.query("SELECT attempts FROM ad_conversion_outbox WHERE platform='openaiAds'")).rows[0].attempts,0);
    const tick=createConversionWorker({outbox,env,fetchFn:async(url,options)=>{
      calls++;assert.equal(url,'https://bzr.openai.com/v1/events?pid=13yVDCfoMVdBGt918mtSms');
      assert.equal(options.headers.Authorization,'Bearer fixture-key-only');
      const payload=JSON.parse(options.body);assert.equal(payload.validate_only,false);ids.push(payload.events[0].id);
      return Response.json({error:'not for logs'},{status:429});
    }});
    await Promise.all([tick(),tick()]);
    let row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='openaiAds'")).rows[0];
    assert.equal(row.status,'pending');assert.equal(row.error_code,'HTTP_429');assert.equal(calls,1);
    await db.query("UPDATE ad_conversion_outbox SET next_attempt=NOW() WHERE platform='openaiAds'");
    const restarted=createConversionWorker({outbox,env,fetchFn:async(url,options)=>{calls++;ids.push(JSON.parse(options.body).events[0].id);return new Response(null,{status:204});}});
    await restarted();await outbox.enqueue(event);await restarted();
    row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='openaiAds'")).rows[0];
    assert.equal(row.status,'sent');assert.equal(row.error_code,null);assert.equal(calls,2);
    assert.deepEqual(ids,[event.id,event.id]);
  } finally {await db.close();}
});
