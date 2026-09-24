import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledge,knowledgePrompt} from '../knowledge-analysis.js';
import {knowledgeScore,enrichReport} from '../recommendation-analysis.js';
const answer='Не можу відкрити сайт. Acme надає SEO для магазинів у Києві.';
const base={identityMatch:'same',hasConcreteFacts:true,explicitlyUnknown:false,evidence:'Acme надає SEO для магазинів у Києві.',reason:'Конкретний опис діяльності.'};
const parse=data=>parseKnowledge(JSON.stringify({...base,...data}),answer);
test('generic inability to browse cannot override concrete knowledge',()=>{
 assert.equal(parse({}).verdict,'know');assert.equal(parse({explicitlyUnknown:true}).verdict,'know');
 assert.match(knowledgePrompt(answer,'Acme','acme.ua','SEO'),/НЕ заперечує знання/);
});
test('namesakes and guessed identity remain uncertain; explicit no knowledge is zero',()=>{
 assert.equal(parse({identityMatch:'different'}).verdict,'confused');assert.equal(parse({identityMatch:'ambiguous'}).verdict,'confused');
 assert.equal(parse({hasConcreteFacts:false,explicitlyUnknown:true}).verdict,'unknown');
 assert.equal(parse({hasConcreteFacts:false}).verdict,'confused');
});
test('hallucinated evidence or incomplete extraction cannot become a knowledge score',()=>{
 assert.throws(()=>parse({evidence:'Acme is the biggest agency'}));assert.throws(()=>parse({identityMatch:'unknown'}));assert.throws(()=>parse({hasConcreteFacts:'true'}));
 assert.equal(knowledgeScore({verdict:'unavailable'}),null);assert.equal(knowledgeScore({}),null);
 const r=enrichReport({engines:[{verdict:'know'},{verdict:'unavailable'}]});assert.equal(r.recognitionScore,100);
});
