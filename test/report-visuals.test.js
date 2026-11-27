import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreSignal,recommendationSignal} from '../report-visuals.js';

test('missing and incomplete observations cannot appear as conclusive failure or success',()=>{
 for(const value of [null,undefined,NaN,-1,101])assert.equal(scoreSignal(value).tone,'unavailable');
 assert.equal(scoreSignal(100,{checked:0,expected:20}).tone,'unavailable');
 assert.equal(scoreSignal(100,{checked:1,expected:20}).label,'Неповні дані');
 assert.equal(scoreSignal(0,{checked:1,expected:20}).label,'Неповні дані');
});

test('internal score bands consistently mark low, middle and strong observations',()=>{
 for(const value of [0,25,39])assert.equal(scoreSignal(value).tone,'critical');
 for(const value of [40,50,74])assert.equal(scoreSignal(value).tone,'attention');
 for(const value of [75,88,100])assert.equal(scoreSignal(value).tone,'good');
});

test('matrix keeps recommendation, mere mention, absence and missing check distinct',()=>{
 const zone={analysisVersion:2,engines:{chatgpt:{analysisStatus:'ok',brandRecommended:true}}};
 assert.equal(recommendationSignal(zone,'chatgpt').tone,'good');
 zone.engines.chatgpt={analysisStatus:'ok',targetStatus:'mentioned'};
 assert.equal(recommendationSignal(zone,'chatgpt').tone,'attention');
 for(const targetStatus of ['negative','not_mentioned']){
  zone.engines.chatgpt.targetStatus=targetStatus;
  assert.equal(recommendationSignal(zone,'chatgpt').tone,'critical');
 }
 zone.engines.chatgpt.analysisStatus='unavailable';
 assert.equal(recommendationSignal(zone,'chatgpt').tone,'unavailable');
});
