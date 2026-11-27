import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReportInsights} from '../report-insights.js';
import {renderEvidenceReport} from '../evidence-report.js';
import {concurrencyLimit} from '../ai-runtime.js';
const engines=['chatgpt','claude','gemini','perplexity'];
const fixture=()=>({brand:'Acme',website:'https://acme.ua',queryPlan:{expectedCount:5},engines:engines.map(key=>({key,verdict:'know'})),zoneOfInvisibility:Array.from({length:5},(_,i)=>({analysisVersion:2,query:`Конкретна потреба покупця номер ${i+1}`,engines:Object.fromEntries(engines.map((key,j)=>[key,{analysisStatus:'ok',targetStatus:j<i?'recommended':'not_mentioned',brandRecommended:j<i,rawText:`Оригінальна відповідь Q${i+1} ${key}`,recommendedCompanies:[{name:'Beta',website:'https://beta.ua',isTarget:false,evidence:`Beta у Q${i+1} ${key}`}]}]))}))});
test('personalized findings preserve denominator, weakest query and observed competitor evidence',()=>{
 const data=fixture(),r=buildReportInsights(data);
 assert.equal(r.checkedAnswers,20);assert.equal(r.expectedAnswers,20);assert.equal(r.recognitionScore,100);
 assert.equal(r.summary.totalRecommended,10);assert.equal(r.topCompetitor,'Beta');
 assert.match(r.topFinding,/номер 1/);assert.match(r.topFinding,/0\/4/);
 assert.equal(r.competitors[0].occurrences.length,20);assert.equal(r.competitors[0].insteadCount,10);
 assert.ok(r.actions[0].evidence.includes('query-1-chatgpt'));
 assert.match(r.actions[0].action,/потреба покупця номер 1/);
 assert.ok(!r.actions.some(a=>/відсутня сторінка|втрачено .*грн/.test(a.action)));
});
test('unavailable engines reduce coverage and never become negative recommendations',()=>{
 const data=fixture();data.zoneOfInvisibility[0].engines.chatgpt={analysisStatus:'unavailable',error:'timeout'};
 const r=buildReportInsights(data);assert.equal(r.checkedAnswers,19);assert.equal(r.expectedAnswers,20);assert.equal(r.confidence,'partial');
 assert.equal(r.actions[0].title,'Доповнити відсутні відповіді');assert.match(r.actions[0].observation,/19 із 20/);
});
test('failed planning yields no invented competitors, zero score or site defect',()=>{
 const data={brand:'Acme',queryPlan:{expectedCount:5,status:'unavailable'},engines:[]};
 const r=buildReportInsights(data);assert.equal(r.summary.score,null);assert.equal(r.recognitionScore,null);assert.equal(r.expectedAnswers,20);assert.equal(r.confidence,'unavailable');
 assert.deepEqual(r.competitors,[]);assert.equal(r.actions.length,1);assert.match(r.topFinding,/Відсутні дані не означають/);
});
test('detail page keeps all answers beyond compact display limits and escapes untrusted provider text',()=>{
 const data=fixture();data.brand='<script>alert(1)</script>';data.phone='PRIVATE_PHONE';data.zoneOfInvisibility.push({...data.zoneOfInvisibility[4],query:'Шостий історичний запит'});
 data.zoneOfInvisibility[5].engines=structuredClone(data.zoneOfInvisibility[4].engines);
 data.zoneOfInvisibility[5].engines.claude.rawText='<img src=x onerror=alert(1)> LAST_ANSWER';
 const html=renderEvidenceReport(data);assert.ok(html.includes('Шостий історичний запит'));assert.ok(html.includes('LAST_ANSWER'));assert.ok(html.includes('id="query-6-claude"'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('PRIVATE_PHONE'));
});
test('shared concurrency limit releases rejected work and bounds overlapping scans',async()=>{
 const limit=concurrencyLimit(3);let active=0,peak=0,completed=0;
 const results=await Promise.allSettled(Array.from({length:10},(_,i)=>limit(async()=>{active++;peak=Math.max(peak,active);try {await new Promise(r=>setTimeout(r,2));if(i===2)throw Error('failed provider');completed++;return i;}finally{active--;}})));
 assert.equal(peak,3);assert.equal(completed,9);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(await limit(()=>42),42);
});
