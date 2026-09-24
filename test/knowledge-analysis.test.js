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

test('ZHAK Medical description is known or partially known, never unknown despite an access disclaimer',()=>{
 const answer='**ZHAK Medical** («ЖАК Медікал») — це приватний медичний центр / кабінет сімейної та реабілітаційної медицини, розташований у м. Обухів (Київська область). Не можу відкрити сайт у реальному часі.';
 for(const [identityMatch,expected] of [['same','know'],['ambiguous','confused']]){
  const result=parseKnowledge(JSON.stringify({identityMatch,hasConcreteFacts:true,explicitlyUnknown:false,evidence:answer.split(' Не можу')[0],reason:'Наведено конкретні послуги та місто.'}),answer);
  assert.equal(result.verdict,expected);assert.ok(knowledgeScore(result)>0);
 }
});

test('formatting and source markers do not invalidate otherwise verbatim knowledge evidence',()=>{
 const answer='**ZHAK Medical** — це приватний центр.[1] У них є **фізіотерапія** та масаж.[1][3]';
 const evidence='ZHAK Medical — це приватний центр. У них є фізіотерапія та масаж.';
 assert.equal(parseKnowledge(JSON.stringify({...base,evidence}),answer).verdict,'know');
 assert.throws(()=>parseKnowledge(JSON.stringify({...base,evidence:'ZHAK Medical — це найбільший центр. У них є фізіотерапія та масаж.'}),answer));
 assert.throws(()=>parseKnowledge(JSON.stringify({...base,evidence:'ZHAK Medical У них є масаж.'}),answer));
});

test('repeating user context after explicitly denying knowledge is not independent knowledge',()=>{
 const answer='Не чув про цей заклад. Судячи з вашого опису, це сімейна медицина в Обухові.';
 const result=parseKnowledge(JSON.stringify({...base,identityMatch:'ambiguous',knowledgeBasis:'user_context',explicitlyUnknown:true,evidence:'Не чув про цей заклад.'}),answer);
 assert.equal(result.verdict,'unknown');
});
