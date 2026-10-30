import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {cleanAttribution,makeContactEvent,tiktokPayload,trackingStatus,ConversionOutbox,createConversionWorker} from '../ad-conversions.js';

const env={ADS_CONVERSIONS_ENABLED:'true',SENDPULSE_TRACKING_SECRET:'fixture',TIKTOK_PIXEL_ID:'DBI807BC77UASCMGT6R0',TIKTOK_EVENTS_ACCESS_TOKEN:'web-fixture-only',TIKTOK_CRM_EVENT_SET_ID:'crm-fixture-id',TIKTOK_CRM_ACCESS_TOKEN:'crm-fixture-only'};

test('TikTok click survives reload without truncation; late Pixel cookie is read at report save; consent clears both',async()=>{
  const code=await readFile(new URL('../ad-attribution.js',import.meta.url),'utf8');
  const click='E.C.P.'+'a'.repeat(800);
  const dom=new JSDOM('',{url:'https://services.topmarketing.com.ua/?ttclid='+click,runScripts:'outside-only'});
  try {
    const w=dom.window;w.eval(code);assert.equal(w.tmAdAttribution().ttclid,click);
    w.document.cookie='_ttp=late-pixel-cookie';
    dom.reconfigure({url:'https://services.topmarketing.com.ua/'});w.eval(code);
    const a=cleanAttribution(w.tmAdAttribution());assert.equal(a.ttclid,click);assert.equal(a.ttp,'late-pixel-cookie');
    assert.equal(cleanAttribution({ttclid:'a'.repeat(4097)}).ttclid,undefined);
    assert.equal(cleanAttribution({ttclid:'bad\nvalue'}).ttclid,undefined);
    dom.reconfigure({url:'https://services.topmarketing.com.ua/?gclid=other-campaign'});w.eval(code);
    assert.equal(w.tmAdAttribution().ttclid,undefined);
    w.tmAdsConsent={adStorage:'denied'};const denied=cleanAttribution(w.tmAdAttribution());
    assert.deepEqual(denied,{consent:{adUserData:'denied'}});
    assert.equal(w.localStorage.getItem('tm_ad_attribution_v1'),null);
  } finally {dom.window.close();}
});

test('CRM contact uses the CRM source, contact timestamp and E.164 hash; no fabricated native lead ID or website context',()=>{
  const event=makeContactEvent('+1 (213) 373-4253',{ttclid:'preserved-for-web',ttp:'cookie'},1700000000000);
  const payload=tiktokPayload(event,env), item=payload.data[0];
  assert.equal(payload.event_source,'crm');assert.equal(payload.event_source_id,env.TIKTOK_CRM_EVENT_SET_ID);
  assert.equal(item.event,'TelegramContactShared');assert.equal(item.event_time,1700000000);
  assert.equal(item.event_id,makeContactEvent('+12133734253',{}).id);
  assert.equal(item.user.phone,'9f7ec22d72092cd3c0b58726ed9c2d91b92e51a3f29837508fb2948bb22dd2fd');
  assert.deepEqual(item.lead,{lead_event_source:'SendPulse'});
  assert.equal(item.page,undefined);assert.equal(item.user.ttclid,undefined);assert.equal(item.user.ttp,undefined);
  assert.ok(!JSON.stringify(payload).includes('12133734253'));
  assert.equal(tiktokPayload({...event,attribution:{consent:{adUserData:'denied'}}},env),null);
  assert.equal(tiktokPayload(makeContactEvent('+12133734253',{gclid:'tm_google_validation_test'}),env),null);
  assert.equal(trackingStatus(env,true).tiktokConfigured,true);
  assert.equal(trackingStatus({...env,TIKTOK_CRM_ACCESS_TOKEN:''},true).tiktokConfigured,false);
  assert.equal(trackingStatus(env,false).ready,false);
  assert.ok(!JSON.stringify(trackingStatus(env,true)).includes('fixture-only'));
});

test('TikTok rejects HTTP 200 with API error, retries durably, deduplicates contact and never uses web token',async()=>{
  const db=new PGlite();const outbox=new ConversionOutbox(db);await outbox.init();
  const event=makeContactEvent('+12133734253',{ttclid:'click'});let calls=0;
  const tick=createConversionWorker({outbox,env,fetchFn:async(url,options)=>{
    calls++;assert.equal(url,'https://business-api.tiktok.com/open_api/v1.3/event/track/');
    assert.equal(options.headers['Access-Token'],env.TIKTOK_CRM_ACCESS_TOKEN);
    assert.equal(JSON.parse(options.body).data[0].event_id,event.id);
    return calls===1?Response.json({code:40002,message:'private response must not be logged'}):Response.json({code:0,request_id:'tiktok-receipt'});
  }});
  try {
    await Promise.all([outbox.enqueue(event),outbox.enqueue(event)]);await Promise.all([tick(),tick()]);
    let row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='tiktok'")).rows[0];
    assert.equal(row.status,'pending');assert.equal(row.error_code,'TIKTOK_API_40002');assert.equal(row.attempts,1);
    await tick();assert.equal(calls,1);
    await db.query("UPDATE ad_conversion_outbox SET next_attempt=NOW() WHERE platform='tiktok'");
    // A new worker represents a restart, with the same persisted outbox.
    const restarted=createConversionWorker({outbox,env,fetchFn:async()=>{calls++;return Response.json({code:0,request_id:'tiktok-receipt'});}});
    await restarted();await outbox.enqueue(event);await restarted();
    row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='tiktok'")).rows[0];
    assert.equal(row.status,'sent');assert.equal(row.receipt,'tiktok-receipt');assert.equal(row.error_code,null);assert.equal(calls,2);
    const fake=makeContactEvent('+12133734253',{gclid:'tm_google_validation_tiktok'});await outbox.enqueue(fake);
    assert.equal((await db.query("SELECT * FROM ad_conversion_outbox WHERE event_id=$1 AND platform='tiktok'",[fake.id])).rows.length,0);
  } finally {await db.close();}
});
