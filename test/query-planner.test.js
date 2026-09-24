import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQueryPlan,queryPlanPrompt} from '../query-planner.js';
const plan={verified:true,niche:'Маркетинг, Київ',services:['Google Ads','SEO','Meta Ads'],queries:['Де замовити Google Ads для інтернет-магазину в Україні?','Яку SEO агенцію обрати в Києві?','Хто налаштовує Meta Ads для клінік у Києві?','Де замовити налаштування аналітики GA4?','Хто розробляє сайти для малого бізнесу в Києві?']};
test('express plan selects two distinct customer needs even when the model supplies five',()=>{
 assert.deepEqual(parseQueryPlan(JSON.stringify(plan),'Acme','acme.ua').queries,plan.queries.slice(0,2));
 assert.throws(()=>parseQueryPlan(JSON.stringify({...plan,queries:[plan.queries[0],plan.queries[0]]}),'Acme','acme.ua'));
 assert.match(queryPlanPrompt('Acme','acme.ua','Маркетинг'),/рівно 2/);
});
test('service-specific unbranded questions are retained and deduplicated',()=>{
 const result=parseQueryPlan('```json\n'+JSON.stringify({...plan,queries:[...plan.queries,plan.queries[0],'Чи хороша агенція Acme?']})+'\n```','Acme','acme.ua',5);
 assert.equal(result.queries.length,5);assert.deepEqual(result.services,plan.services);assert.equal(result.querySource,'company_profile');
});
test('unverified or branded-only plans cannot masquerade as customer queries',()=>{
 assert.throws(()=>parseQueryPlan(JSON.stringify({...plan,verified:false}),'Acme','',5));
 assert.throws(()=>parseQueryPlan(JSON.stringify({...plan,queries:['Порадь Acme для SEO','Порадь acme.ua для SEO','Порадь Acme для PPC']}),'Acme','acme.ua',5));
});
test('planner requires specific services and respects supplied geography',()=>{
 const prompt=queryPlanPrompt('Acme','acme.ua','Стоматологія, Львів',5);
 assert.ok(prompt.includes('Це достатня основа для verified=true'));assert.ok(queryPlanPrompt('Acme','acme.ua','').includes('офіційний сайт'));assert.ok(prompt.includes('Стоматологія, Львів'));assert.ok(prompt.includes('Не роби кілька перефразувань'));
});
