import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {cleanAttribution,normalizePhone,makeContactEvent,metaPayload,googlePayload,ConversionOutbox,createConversionWorker,trustedSendPulse,trackingStatus} from '../ad-conversions.js';

const env={ADS_CONVERSIONS_ENABLED:'true',SENDPULSE_TRACKING_SECRET:'test-only',META_PIXEL_ID:'123',META_CAPI_ACCESS_TOKEN:'test-only',META_API_VERSION:'v23.0',GOOGLE_ADS_CUSTOMER_ID:'123-456-7890',GOOGLE_ADS_CONVERSION_ACTION_ID:'456',GOOGLE_OAUTH_CLIENT_ID:'test',GOOGLE_OAUTH_CLIENT_SECRET:'test',GOOGLE_OAUTH_REFRESH_TOKEN:'test'};
const attribution={gclid:'google_test_click',fbc:'fb.1.123.meta_test_click',fbp:'fb.1.123.456',consent:{adUserData:'granted'}};
const event=makeContactEvent('+380 (67) 123-45-67',attribution);

test('only valid contacts yield conversions, consent denial prevents them, source authentication fails closed',()=>{
  for(const phone of ['',null,'{{Phone}}','0671234567','abc123456789','123']) assert.equal(normalizePhone(phone),null);
  assert.equal(normalizePhone('380671234567'),'+380671234567');
  assert.equal(makeContactEvent('380671234567',{consent:{adUserData:'denied'}}),null);
  assert.equal(trustedSendPulse(undefined,'secret'),false);
  assert.equal(trustedSendPulse('secret',undefined),false);
  assert.equal(trustedSendPulse('secret','secret'),true);
  assert.equal(trackingStatus(env,false).ready,false);
  assert.deepEqual(cleanAttribution({gclid:'abc',arbitrary:'private',consent:{adUserData:'denied'}}),{consent:{adUserData:'denied'}});
});
test('payloads use contact time, chat/message source, distinct normalized hashes and stable dedup IDs',()=>{
  const m=metaPayload(event,env).data[0],g=googlePayload(event,env).events[0];
  assert.equal(m.action_source,'chat');assert.equal(m.event_name,'Lead');
  assert.equal(g.eventSource,'MESSAGE');assert.equal(g.eventTimestamp,event.time);
  assert.equal(m.event_id,g.transactionId);assert.equal(event.id,makeContactEvent('380671234567',{}).id);
  assert.notEqual(event.metaPhone,event.googlePhone);
  assert.equal(m.user_data.ph[0].length,64);
  assert.ok(!JSON.stringify([m,g]).includes('380671234567'));
  assert.equal(googlePayload(event,env).destinations[0].operatingAccount.accountId,'1234567890');
  const unknown=makeContactEvent('380671234567',{gclid:'abc',fbp:'fb.1.1.1'});
  assert.equal(metaPayload(unknown,env).data[0].user_data.ph,undefined);
  assert.equal(googlePayload(unknown,env).events[0].userData,undefined);
  assert.equal(googlePayload(makeContactEvent('380671234567',{}),env),null);
});
test('browser retains paid click through reload, switches campaign without mixing IDs, captures cookies, clears on denial',async()=>{
  const code=await fs.readFile(new URL('../ad-attribution.js',import.meta.url),'utf8');
  const dom=new JSDOM('',{url:'https://example.com/?fbclid=abc&utm_campaign=case',runScripts:'outside-only'});
  dom.window.document.cookie='_fbp=fb.1.123.456';dom.window.eval(code);
  const first=dom.window.tmAdAttribution();assert.equal(first.fbclid,'abc');assert.match(first.fbc,/\.abc$/);
  dom.reconfigure({url:'https://example.com/'});dom.window.eval(code);
  assert.equal(dom.window.tmAdAttribution().fbc,first.fbc);
  dom.window.document.cookie='_fbc=fb.1.100.old';
  dom.reconfigure({url:'https://example.com/?gclid=new-google'});dom.window.eval(code);
  assert.equal(dom.window.tmAdAttribution().gclid,'new-google');assert.equal(dom.window.tmAdAttribution().fbc,undefined);
  dom.window.tmAdsConsent={adUserData:'denied'};
  assert.equal(dom.window.tmAdAttribution().gclid,undefined);
  assert.equal(dom.window.localStorage.getItem('tm_ad_attribution_v1'),null);dom.window.close();
});
test('durable outbox survives restart; parallel duplicates emit once; Google receipt is polled before success',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tm-conversion-'));
  let db=new PGlite(dir);let outbox=new ConversionOutbox(db);await outbox.init();
  try {
    await Promise.all([outbox.enqueue(event),outbox.enqueue(event)]);
    assert.equal((await db.query('SELECT * FROM ad_conversion_outbox')).rows.length,2);
    await db.close();db=new PGlite(dir);outbox=new ConversionOutbox(db);await outbox.init();
    const urls=[];
    const worker=createConversionWorker({outbox,env,fetchFn:async(url,opts)=>{
      urls.push(url);
      if(url.includes('graph.facebook'))return Response.json({events_received:1,fbtrace_id:'meta-receipt'});
      if(url.includes('oauth2'))return Response.json({access_token:'test',expires_in:3600});
      if(url.includes('events:ingest'))return Response.json({requestId:'google-receipt'});
      if(url.includes('requestStatus'))return Response.json({requestStatusPerDestination:[{requestStatus:'SUCCESS'}]});
      throw new Error('Unexpected URL');
    }});
    await Promise.all([worker(),worker()]);
    let rows=(await db.query('SELECT * FROM ad_conversion_outbox ORDER BY platform')).rows;
    assert.equal(rows[0].status,'processing');assert.equal(rows[1].status,'sent');
    await db.query('UPDATE ad_conversion_outbox SET next_attempt=NOW()');await worker();
    rows=(await db.query('SELECT * FROM ad_conversion_outbox')).rows;assert.ok(rows.every(r=>r.status==='sent'));
    assert.equal(urls.filter(u=>u.includes('events:ingest')).length,1);assert.equal(urls.filter(u=>u.includes('graph.facebook')).length,1);
    await outbox.enqueue(event);await worker();assert.equal(urls.filter(u=>u.includes('events:ingest')).length,1);
  } finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('provider rejection stays retryable and never exposes response secrets',async()=>{
  const db=new PGlite();const outbox=new ConversionOutbox(db);await outbox.init();
  try {
    await outbox.enqueue(event);
    const worker=createConversionWorker({outbox,env:{...env,GOOGLE_ADS_CUSTOMER_ID:''},fetchFn:async()=>Response.json({error:{message:'sensitive'}},{status:429})});
    await worker();let row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='meta'")).rows[0];
    assert.equal(row.status,'pending');assert.equal(row.error_code,'HTTP_429');assert.equal(row.attempts,1);
    await worker();row=(await db.query("SELECT * FROM ad_conversion_outbox WHERE platform='meta'")).rows[0];assert.equal(row.attempts,1);
  }finally{await db.close();}
});
