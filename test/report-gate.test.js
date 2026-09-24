import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const tick = () => new Promise(resolve=>setTimeout(resolve,10));
async function waitUntil(fn) { for(let n=0;n<100;n++) { if(fn()) return; await tick(); } throw new Error('UI did not settle'); }
function setup({saveFails=false, enginesFail=false, badUrl=false,classifiersFail=false}={}) {
 const dom = new JSDOM(html,{runScripts:'outside-only',url:'https://services.topmarketing.com.ua/'});
 const w=dom.window;let saveCount=0,engineCount=0;
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 const timeout=w.setTimeout.bind(w);w.setTimeout=(fn)=>timeout(fn,1);
 w.console.warn=()=>{};
 w.fetch=async(url,opts)=>{
  if(url.endsWith('/api/scan-engine')) {engineCount++;return {ok:true,json:async()=>enginesFail?{error:'Offline'}:classifiersFail?{verdict:'unavailable',classifierError:'timeout',score:null}:{verdict:'know',score:63,snippet:'Test'}};}
  if(url.endsWith('/api/discovery-queries')) return {ok:true,json:async()=>({queries:[]})};
  if(url.endsWith('/api/save-report')) {
   saveCount++;
   if(saveFails&&saveCount===1)return {ok:false,json:async()=>({error:'temporary'})};
   return {ok:true,json:async()=>({telegramLink:badUrl?'https://untrusted.example/test':`https://tg.pulse.is/test_bot?start=test&scan_token=test${saveCount}`})};
  }
  throw new Error('Unexpected URL '+url);
 };
 w.eval(mainScript);
 const submit=()=>{w.document.getElementById('brandName').value='QA Brand';w.document.getElementById('scanForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 return {dom,w,submit,counts:()=>({saveCount,engineCount})};
}

test('result shows only report contents and Telegram CTA; no score or old forms',async()=>{
 const t=setup();try{
 t.submit();await waitUntil(()=>t.w.document.getElementById('telegramLink').hasAttribute('href'));
 const d=t.w.document;
 assert.equal(d.getElementById('gateTitle').textContent,'Ваш звіт уже готовий');
 assert.equal(d.getElementById('reportGate').hidden,false);
 for(const id of ['scoreNum','reportBadge','consultForm','ctaBlock','restartBtn'])assert.equal(d.getElementById(id),null);
 assert.equal(d.getElementById('scanStatus').hidden,true);
 assert.equal(d.getElementById('reportGate').textContent.includes('100/100'),false);
 assert.equal(new URL(d.getElementById('telegramLink').href).searchParams.get('scan_token'),'test1');
 t.submit();assert.equal(d.getElementById('telegramLink').hasAttribute('href'),false);
 await waitUntil(()=>t.counts().saveCount===2&&d.getElementById('telegramLink').hasAttribute('href'));
 assert.equal(new URL(d.getElementById('telegramLink').href).searchParams.get('scan_token'),'test2');
 }finally{t.dom.window.close();}
});

test('save failure offers retry without repeating paid AI calls',async()=>{
 const t=setup({saveFails:true});try{
 t.submit();await waitUntil(()=>!t.w.document.getElementById('gateRetry').hidden);
 assert.equal(t.w.document.getElementById('telegramLink').hasAttribute('href'),false);
 assert.equal(t.counts().engineCount,4);
 t.w.document.getElementById('gateRetry').click();
 await waitUntil(()=>t.w.document.getElementById('telegramLink').hasAttribute('href'));
 assert.deepEqual(t.counts(),{engineCount:4,saveCount:2});
 }finally{t.dom.window.close();}
});

test('all engines failing never produces a fake ready report',async()=>{
 const t=setup({enginesFail:true});try{
 t.submit();await waitUntil(()=>!t.w.document.getElementById('gateRetry').hidden);
 assert.equal(t.counts().saveCount,0);
 assert.equal(t.w.document.getElementById('gateTitle').textContent,'Не вдалося завершити перевірку');
 }finally{t.dom.window.close();}
});

test('untrusted delivery URL is not presented to users',async()=>{
 const t=setup({badUrl:true});try{
 t.submit();await waitUntil(()=>!t.w.document.getElementById('gateRetry').hidden);
 assert.equal(t.w.document.getElementById('telegramLink').hasAttribute('href'),false);
 }finally{t.dom.window.close();}
});

test('classifier outages do not present a completed knowledge report',async()=>{
 const t=setup({classifiersFail:true});try{
 t.submit();await waitUntil(()=>!t.w.document.getElementById('gateRetry').hidden);
 assert.equal(t.counts().saveCount,0);assert.equal(t.w.document.getElementById('gateTitle').textContent,'Не вдалося завершити перевірку');
 }finally{t.dom.window.close();}
});
