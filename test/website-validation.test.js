import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBusinessWebsite,createWebsiteValidator,websiteGate} from '../website-validation.js';

test('accepts business domains and normalizes only the public HTTPS homepage',()=>{
  for(const value of ['topmarketing.com.ua','https://topmarketing.com.ua/page?x=1','http://topmarketing.com.ua']) assert.deepEqual(normalizeBusinessWebsite(value),{website:'https://topmarketing.com.ua',brand:'topmarketing.com.ua'});
  assert.equal(normalizeBusinessWebsite('https://www.example.com/').brand,'example.com');
  assert.match(normalizeBusinessWebsite('приклад.укр').website,/xn--/);
});
test('rejects free text, malformed domains, private addresses, credentials, and social/editor profiles',()=>{
  for(const value of ['Top Marketing','abc','123','example..com','-bad.com','example.com:8080','https://user:pass@example.com','127.0.0.1','https://[::1]','https://example.invalid','https://t.me/person','instagram.com/user','app.weblium.com/editor/site','ftp://example.com']) assert.throws(()=>normalizeBusinessWebsite(value),value);
});
test('verification is single-flight, cached, expires and rejects unavailable or platform redirects',async()=>{
  let calls=0,time=0,fail=false,redirect=false;
  const verify=createWebsiteValidator({now:()=>time,ttl:100,fetchContext:async url=>{calls++;await Promise.resolve();if(fail)throw Error('network');return {url:redirect?'https://instagram.com/user':url,text:'business site'};}});
  await Promise.all([verify('example.com'),verify('example.com')]);assert.equal(calls,1);
  await verify('example.com/path');assert.equal(calls,1);
  time=101;await verify('example.com');assert.equal(calls,2);
  fail=true;await assert.rejects(verify('other.com'),/Не вдалося підтвердити/);
  fail=false;redirect=true;await assert.rejects(verify('third.com'),/Не вдалося підтвердити/);
});
test('server gate rejects invalid site before the downstream paid analysis',async()=>{
  let nextCalls=0,status,body;
  const res={status(code){status=code;return this;},json(value){body=value;}};
  const gate=websiteGate(createWebsiteValidator({fetchContext:async()=>{throw Error('offline');}}));
  await gate({body:{brand:'just a name'}},res,()=>nextCalls++);
  assert.equal(status,400);assert.equal(nextCalls,0);assert.ok(body.error);
  await gate({body:{website:'example.com'}},res,()=>nextCalls++);
  assert.equal(status,400);assert.equal(nextCalls,0);
});
