import test from 'node:test';
import assert from 'node:assert/strict';
import {targetIdentity,validateAnswer,summarizeRecommendations,enrichReport,extractionPrompt} from '../recommendation-analysis.js';
const target=targetIdentity('Acme','https://www.acme.ua/about');
const extract=companies=>({complete:true,companies});
const item=(name,evidence,stance='recommended',website=null)=>({name,evidence,stance,website});
const answer=(text,companies,t=target)=>validateAnswer({text},extract(companies),t);
const zone=engines=>({query:'Кого обрати в Києві?',analysisVersion:2,engines});

test('a negative mention or citation is not a recommendation',()=>{
 const text='Не рекомендую Acme. Раджу Beta. Джерело: acme.ua';
 const r=answer(text,[item('Acme','Не рекомендую Acme.','negative'),item('Beta','Раджу Beta.')]);
 assert.equal(r.recommended,false);assert.equal(r.websiteRecommended,false);assert.equal(r.targetStatus,'negative');
 assert.deepEqual(r.recommendedCompanies.map(c=>c.name),['Beta']);
});
test('brand and website scores are separate; URL-only advice does not imply a named recommendation',()=>{
 const named=answer('Раджу Acme для ремонту.',[item('Acme','Раджу Acme для ремонту.')]);
 assert.equal(named.brandRecommended,true);assert.equal(named.websiteRecommended,false);
 const linked=answer('Раджу acme.ua для ремонту.',[item('acme.ua','Раджу acme.ua для ремонту.','recommended','https://acme.ua')]);
 assert.equal(linked.brandRecommended,false);assert.equal(linked.websiteRecommended,true);
 const sum=summarizeRecommendations([zone({chatgpt:named}),zone({chatgpt:linked})],'Acme','acme.ua');
 assert.equal(sum.byEngine.chatgpt.score,100);assert.equal(sum.byEngine.chatgpt.brandScore,50);assert.equal(sum.byEngine.chatgpt.websiteScore,50);
});
test('unsupported names, rewritten quotes, and invented domains cannot earn scores',()=>{
 for(const companies of [[item('Invented','Раджу Invented.')],[item('Acme','Acme - найкращі')],[item('Acme','Раджу Acme.','recommended','https://fake.ua')]]) {
  const r=answer('Раджу Acme.',companies);assert.equal(r.analysisStatus,'unavailable');
 }
 const incomplete=answer('Раджу Acme.',[]);assert.equal(incomplete.analysisStatus,'unavailable');
 const malicious=answer('Раджу acme.ua.evil.com.',[item('acme.ua.evil.com','Раджу acme.ua.evil.com.','recommended','acme.ua.evil.com')]);
 assert.notEqual(malicious.websiteRecommended,true);
 assert.equal(malicious.analysisStatus,'unavailable');
});
test('unavailable and legacy answers are excluded, not scored zero',()=>{
 const yes=answer('Раджу Acme.',[item('Acme','Раджу Acme.')]);
 const no=answer('Раджу Beta.',[item('Beta','Раджу Beta.')]);
 const zones=[zone({chatgpt:yes,gemini:no}),zone({chatgpt:{error:'429'}}),{query:'old',engines:{chatgpt:{mentionedBrand:true}}}];
 const sum=summarizeRecommendations(zones,'Acme','');
 assert.equal(sum.byEngine.chatgpt.score,100);assert.equal(sum.byEngine.chatgpt.checked,1);assert.equal(sum.byEngine.chatgpt.unavailable,2);
 assert.equal(sum.byEngine.gemini.score,0);assert.equal(sum.byEngine.claude.score,null);assert.equal(sum.score,50);
 assert.equal(sum.byEngine.chatgpt.websiteScore,null);
});
test('competitors retain the AI, query and exact evidence; target is excluded',()=>{
 const a=answer('Раджу Acme і Beta.',[item('Acme','Раджу Acme і Beta.'),item('Beta','Раджу Acme і Beta.')]);
 const b=answer('Раджу Beta.',[item('Beta','Раджу Beta.')]);
 const sum=summarizeRecommendations([zone({chatgpt:a,claude:b}),{...zone({gemini:b}),query:'Де замовити ремонт?'}],'Acme','acme.ua');
 assert.equal(sum.competitors.length,1);const c=sum.competitors[0];assert.equal(c.name,'Beta');assert.equal(c.occurrences.length,3);
 assert.equal(c.occurrences[0].insteadOf,false);assert.equal(c.occurrences[1].insteadOf,true);assert.equal(c.occurrences[2].query,'Де замовити ремонт?');
});
test('scores/findings are computed from evidence, not submitted or random findings',()=>{
 const report=enrichReport({brand:'Acme',score:99,engines:[{verdict:'know'},{error:'429'}],zoneOfInvisibility:[zone({chatgpt:answer('Немає даних про компанії.',[])})],issues:['Немає сайту']});
 assert.equal(report.recognitionScore,100);assert.equal(report.recommendations.score,0);assert.equal(report.score,100);assert.equal(report.recommendationScore,0);assert.ok(!report.issues.includes('Немає сайту'));
 assert.equal(enrichReport({engines:[{error:'offline'}]}).score,null);
});
test('recommendation extraction operates only on supplied answers',()=>{
 const prompt=extractionPrompt('Кого обрати?',target,{chatgpt:'Раджу Beta.'});assert.ok(prompt.includes('Не шукай нових компаній'));assert.ok(prompt.includes('Раджу Beta.'));
});

test('truncated answers cannot establish a complete recommendation score',()=>{
 const r=validateAnswer({text:'Раджу Acme.',truncated:true},extract([item('Acme','Раджу Acme.')]),target);
 assert.equal(r.analysisStatus,'unavailable');
});

test('rendered Markdown quotes and sentence punctuation around domains preserve evidence',()=>{
 const text='**Acme** — рекомендую для ремонту.[1] Офіційний сайт: acme.ua.[2]';
 const r=answer(text,[item('Acme','Acme — рекомендую для ремонту. Офіційний сайт: acme.ua.','recommended','https://acme.ua')]);
 assert.equal(r.analysisStatus,'ok');assert.equal(r.brandRecommended,true);assert.equal(r.websiteRecommended,true);
});


test('all AI knowing a brand never raises its zero recommendation score',()=>{
 const no=answer('Раджу Beta.',[item('Beta','Раджу Beta.')]);
 const keys=['chatgpt','claude','gemini','perplexity'];
 const report=enrichReport({brand:'Acme',engines:keys.map(key=>({key,verdict:'know'})),zoneOfInvisibility:[zone(Object.fromEntries(keys.map(key=>[key,no])))]});
 assert.equal(report.recognitionScore,100);assert.equal(report.recommendationScore,0);assert.equal(report.score,100);
});
test('global recommendation score counts every AI-query pair, not any hit per query',()=>{
 const yes=answer('Раджу Acme.',[item('Acme','Раджу Acme.')]);const no=answer('Раджу Beta.',[item('Beta','Раджу Beta.')]);
 const report=enrichReport({brand:'Acme',engines:[{verdict:'unknown'}],zoneOfInvisibility:[zone({chatgpt:yes,claude:no,gemini:no,perplexity:no}),zone({chatgpt:yes,claude:no,gemini:no,perplexity:no})]});
 assert.equal(report.recognitionScore,0);assert.equal(report.recommendationScore,25);assert.equal(report.recommendations.totalRecommended,2);assert.equal(report.recommendations.totalSuccessful,8);
});
test('an absent brand is zero even when competitor extraction fails',()=>{
 const r=validateAnswer({text:'Не можу назвати агенції. Перевірте рейтинги.'},null,target);
 assert.equal(r.analysisStatus,'ok');assert.equal(r.recommended,false);assert.equal(r.competitorAnalysisStatus,'unavailable');
 const partial=answer('Раджу Beta.',[item('Beta','Раджу Beta.'),item('Invented','Раджу Invented.')]);
 assert.equal(partial.analysisStatus,'ok');assert.equal(partial.recommended,false);assert.equal(partial.competitorAnalysisStatus,'partial');assert.equal(partial.recommendedCompanies.length,1);
});
