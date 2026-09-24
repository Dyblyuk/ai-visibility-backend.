import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompactReport,recommendationCard} from '../compact-report.js';
import {ENGINE_LABELS} from '../recommendation-analysis.js';

test('compact PDF stays at two pages even for oversized historical report data',async()=>{
 const long='Дуже довгий опис компанії, її продуктів, послуг і географії. '.repeat(100);
 const zones=Array.from({length:6},()=>({analysisVersion:2,query:long,engines:Object.fromEntries(Object.keys(ENGINE_LABELS).map(key=>[key,{analysisStatus:'ok',recommendedCompanies:Array.from({length:20},()=>({name:long,isTarget:false}))}]))}));
 const bytes=await buildCompactReport({brand:long,niche:long,engines:Object.entries(ENGINE_LABELS).map(([key,label])=>({key,label,verdict:'confused',snippet:long,reason:long,model:long})),zoneOfInvisibility:zones});
 assert.equal(bytes.subarray(0,4).toString(),'%PDF');
 assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2);
});

test('recommendation cards distinguish alternatives, co-recommendations and missing evidence',()=>{
 const result={analysisStatus:'ok',brandRecommended:false,websiteRecommended:false,recommendedCompanies:[{name:'Beta',isTarget:false}]};
 const zone={analysisVersion:2,engines:{gemini:result}};
 assert.equal(recommendationCard(zone,'gemini').detail,'Замість вас: Beta');
 assert.equal(recommendationCard(zone,'gemini').status,'Не рекомендує вас');
 result.brandRecommended=true;
 assert.equal(recommendationCard(zone,'gemini').detail,'Також: Beta');
 assert.equal(recommendationCard(zone,'gemini').status,'Рекомендує вас');
 result.analysisStatus='unavailable';
 assert.equal(recommendationCard(zone,'gemini').status,'Немає оцінки');
 result.analysisStatus='ok';result.brandRecommended=false;result.recommendedCompanies=[];result.competitorAnalysisStatus='unavailable';
 assert.match(recommendationCard(zone,'gemini').detail,/Не вдалося розібрати список альтернатив/);
});
