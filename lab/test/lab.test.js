import test from 'node:test';
import assert from 'node:assert/strict';
import {createLab,ALLOWED_UPSTREAM,validateProfile} from '../server.js';
import {validateQueries,cleanQuery,buildAuditReport} from '../analysis.js';
import {inspectHtml,signalsFor,normalizeSite} from '../site-audit.js';
const profile={brand:'Test Clinic',website:'https://example.com/',service:'мамографія',city:'Київ'};
const emptyAudit={pages:[],failures:[],scope:'Test scope'};
const queries=['Де пройти мамографію в Києві?','Яку клініку мамології обрати в Києві?'];
test('customer questions require 2–3 distinct unbranded prompts',()=>{
 assert.throws(()=>validateQueries(['Test Clinic у Києві',queries[0]],profile),/бренду/);
 assert.throws(()=>validateQueries([queries[0],queries[0]],profile),/відрізнятися/);
 assert.throws(()=>validateQueries([queries[0]],profile),/2 або 3/);
 assert.deepEqual(validateQueries(queries,profile),queries);
 assert.equal(cleanQuery('Google Ads з гарантією результатів у Києві'),'Google Ads у Києві');
});
test('profiles reject credentials, non-HTTPS, and malformed fields',()=>{
 assert.throws(()=>normalizeSite('https://user:pass@example.com'));
 assert.throws(()=>normalizeSite('http://example.com'));
 assert.throws(()=>validateProfile({...profile,brand:{}}));
});
test('site findings preserve scope and evidence instead of inventing whole-site facts',()=>{
 const page=inspectHtml('<title>Клініка</title><h1>Мамографія у Києві</h1><p>Наш досвід. Контакт +380 67 123 45 67.</p>','https://example.com/');
 const signals=signalsFor(page,profile);
 assert.equal(signals.find(s=>s.id==='h1').status,'observed');
 assert.equal(signals.find(s=>s.id==='geo').status,'observed');
 assert.equal(signals.find(s=>s.id==='proof').status,'observed');
 assert.ok(signals.every(s=>s.url==='https://example.com/'));
 const missing=signalsFor(inspectHtml('<p>Коротка інформація про клініку</p>','https://example.com/'),profile);
 assert.match(missing.find(s=>s.id==='geo').evidence,/цій сторінці/);
});
test('technical failures never become a zero knowledge or recommendation score',()=>{
 const report=buildAuditReport(profile,{engines:{chatgpt:{verdict:'unavailable',error:'HTTP 400'}},zoneOfInvisibility:[]},emptyAudit);
 assert.equal(report.recognitionScore,null);assert.equal(report.summary.score,null);
 assert.equal(report.coverage.knowledge,0);assert.equal(report.actions.length,3);
 assert.ok(report.actions.every(a=>a.kind==='recommended_check'));
});
test('production-write routes are not exposed and outgoing analysis payloads contain no contacts',async()=>{
 const calls=[];
 const app=createLab({inspectSite:async()=>emptyAudit,callAI:async(route,body)=>{
  assert.ok(ALLOWED_UPSTREAM.has(route));calls.push({route,body});
  if(route==='/api/discovery-queries')return {queries,services:['мамографія']};
  if(route==='/api/scan-engine')return {verdict:'know',score:100,rawText:'Test Clinic'};
  return {query:body.query,analysisVersion:2,engines:{}};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  for(const route of ['/api/save-report','/api/sendpulse-report','/api/lead','/api/partial-lead','/api/telegram-broadcast'])assert.equal((await post(route,{phone:'+380000000000'})).status,404);
  const prep=await(await post('/api/prepare',{...profile,phone:'+380000000000',email:'test@example.com'})).json();
  const started=await(await post('/api/jobs',{preparationId:prep.id,queries,phone:'+380000000000'})).json();
  let job;for(let i=0;i<30;i++){job=await(await fetch(base+'/api/jobs/'+started.id)).json();if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(job.status,'done');assert.equal(calls.filter(c=>c.route==='/api/scan-engine').length,4);
  assert.ok(calls.every(c=>!JSON.stringify(c.body).includes('+380000000000')&&!('phone'in c.body)&&!('email'in c.body)));
 }finally{server.close();}
});
