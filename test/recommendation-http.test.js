import test from 'node:test';
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test';process.env.GEMINI_API_KEY='test';process.env.PERPLEXITY_API_KEY='test';process.env.ANTHROPIC_API_KEY='test';
process.env.REPORT_DATABASE_URL='';process.env.LEAD_WEBHOOK_URL='';process.env.TELEGRAM_BOT_TOKEN='';
process.env.TELEGRAM_BOT_USERNAME='test_bot';process.env.SENDPULSE_FLOW_ID='test-flow';
const {app}=await import('../server.js');
const realFetch=globalThis.fetch;
const raw='Раджу Acme (https://acme.ua) для SEO. Також рекомендую Beta (https://beta.ua) для реклами.';
const extracted={complete:true,companies:[{name:'Acme',website:'https://acme.ua',stance:'recommended',evidence:'Раджу Acme (https://acme.ua) для SEO.'},{name:'Beta',website:'https://beta.ua',stance:'recommended',evidence:'Також рекомендую Beta (https://beta.ua) для реклами.'}]};
const queryPlan={verified:true,niche:'SEO, Київ',services:['SEO','Google Ads','Аналітика'],queries:['Кого обрати для SEO магазину в Києві?','Де замовити Google Ads для магазину?','Хто налаштовує аналітику GA4 для магазину?']};
const calls=[];
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('http://127.0.0.1:')) return realFetch(url,options);
 const body=JSON.parse(options.body);calls.push({url,body});
 if(String(url).includes('openai.com'))return Response.json({output_text:raw});
 if(String(url).includes('googleapis.com'))return Response.json({candidates:[{content:{parts:[{text:raw}]}}]});
 if(String(url).includes('perplexity.ai'))return Response.json({choices:[{message:{content:raw}}]});
 if(String(url).includes('anthropic.com'))return Response.json({content:[{type:'text',text:body.max_tokens===2200?JSON.stringify(queryPlan):body.max_tokens===7000?JSON.stringify({engines:{chatgpt:extracted,claude:extracted,gemini:extracted,perplexity:extracted}}):raw}]});
 throw new Error('Unexpected external request: '+url);
};
test('discovery -> stored report -> SendPulse summary/PDF preserves per-AI evidence and cached scores',async()=>{
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 try {
  const plan=await post('/api/discovery-queries',{brand:'Acme',website:'127.0.0.1',niche:'SEO, Київ'});
  assert.equal(plan.querySource,'company_profile');assert.equal(plan.queries.length,3);
  const query=plan.queries[0];
  const zone=await post('/api/zone-query',{brand:'Acme',website:'acme.ua',query});
  assert.equal(zone.analysisVersion,2);assert.match(zone.requestPrompt,/Порадь 3–5 конкретних компаній/);assert.ok(!zone.requestPrompt.includes('Acme'));assert.deepEqual(zone.competitors,['Beta']);
  for(const value of Object.values(zone.engines)){assert.equal(value.brandRecommended,true);assert.equal(value.websiteRecommended,true);assert.equal(value.rawText,raw);}
  // Four independent unbranded answers plus one extraction; no market search.
  assert.equal(calls.length,6);
  for(const call of calls.filter(call=>call.body.max_tokens!==7000&&call.body.max_tokens!==2200))assert.ok(!JSON.stringify(call.body).includes('Acme'));
  const cached=await post('/api/zone-query',{brand:'Acme',website:'acme.ua',query});assert.equal(calls.length,6);assert.equal(cached.engines.chatgpt.cached,true);
  const saved=await post('/api/save-report',{brand:'Acme',website:'acme.ua',niche:'SEO, Київ',score:5,engines:[{label:'ChatGPT',verdict:'know'}],zoneOfInvisibility:[zone],queryPlan:plan});
  const report=await post('/api/sendpulse-report',{token:saved.token});
  assert.equal(report.score,100);assert.equal(report.recommendations.byEngine.claude.websiteScore,100);
  assert.match(report.reportSummary,/Рекомендації: 100\/100/);assert.match(report.reportSummary,/Знання бренду: 100\/100/);assert.equal(report.recommendationScore,100);assert.ok(!report.reportSummary.includes('ChatGPT: 100'));assert.ok(report.reportSummary.length<1024);
  const pdf=await realFetch(base+new URL(report.pdfUrl).pathname);assert.equal(pdf.status,200);
  const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  const again=await post('/api/sendpulse-report',{token:saved.token});assert.equal(report.pdfUrl,again.pdfUrl);
 } finally {globalThis.fetch=realFetch;await new Promise(resolve=>server.close(resolve));}
});
