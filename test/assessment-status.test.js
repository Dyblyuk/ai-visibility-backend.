import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentStatus} from '../assessment-status.js';
import {enrichReport,summarizeRecommendations} from '../recommendation-analysis.js';
test('knowledge and recommendation statuses match score boundaries without inventing missing scores',()=>{
 for(const score of [null,undefined,NaN,-1,101])assert.equal(assessmentStatus(score).key,'unavailable');
 assert.equal(assessmentStatus(0).label,'Не знає');assert.equal(assessmentStatus(50).label,'Частково знає');assert.equal(assessmentStatus(100).label,'Знає');
 for(const [score,label] of [[0,'Не рекомендує'],[1,'Частково рекомендує'],[99,'Частково рекомендує'],[100,'Рекомендує']])assert.equal(assessmentStatus(score,'recommendation').label,label);
});
test('report statuses use available evidence and survive mixed or missing provider answers',()=>{
 const zones=[{query:'Яку агенцію обрати?',analysisVersion:2,engines:{chatgpt:{analysisStatus:'ok',brandRecommended:true},claude:{analysisStatus:'ok',brandRecommended:false}}}];
 const summary=summarizeRecommendations(zones,'Acme');
 assert.equal(summary.score,50);assert.equal(summary.status,'Частково рекомендує');
 assert.equal(summary.byEngine.chatgpt.status,'Рекомендує');assert.equal(summary.byEngine.claude.status,'Не рекомендує');assert.equal(summary.byEngine.gemini.status,'Оцінку не отримано');
 const report=enrichReport({engines:[{verdict:'know'},{verdict:'unknown'},{verdict:'unavailable'}],zoneOfInvisibility:zones});
 assert.equal(report.recognitionScore,50);assert.equal(report.recognitionStatus,'Частково знає');assert.equal(report.recommendationStatus,'Частково рекомендує');assert.equal(report.engines[2].knowledgeScore,null);
 assert.equal(enrichReport({engines:[]}).recognitionStatus,'Оцінку не отримано');
});
