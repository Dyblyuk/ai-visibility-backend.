import test from 'node:test';
import assert from 'node:assert/strict';
for(const key of ['OPENAI_API_KEY','GEMINI_API_KEY','PERPLEXITY_API_KEY','ANTHROPIC_API_KEY'])process.env[key]='test';
process.env.REPORT_DATABASE_URL='';process.env.LEAD_WEBHOOK_URL='';process.env.TELEGRAM_BOT_TOKEN='';
process.env.TELEGRAM_BOT_USERNAME='test_bot';process.env.SENDPULSE_FLOW_ID='test';
const {app}=await import('../server.js');
const originalFetch=globalThis.fetch;
const keys=['chatgpt','gemini','perplexity','claude'];
const answer='Acme надає SEO для магазинів у Києві.';
const recommendation='Рекомендую Beta (https://beta.ua) для SEO магазинів.';
const queryPlan={verified:true,niche:'SEO, Київ',services:['SEO','Реклама'],queries:['Хто надає SEO для магазинів у Києві?','Де замовити рекламу магазину в Києві?','Хто налаштовує аналітику для магазинів?']};
const events=[];let activeRecommendations=0,peakRecommendations=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('full scan overlaps planning with knowledge and runs exactly eight recommendation calls in parallel',async()=>{
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return originalFetch(url,options);
  const body=JSON.parse(options.body);const anthropic=String(url).includes('anthropic.com');
  const prompt=body.input||body.messages?.[0]?.content||body.contents?.[0]?.parts?.[0]?.text||'';
  if(anthropic&&body.max_tokens===2200){events.push('plan:start');await delay(25);events.push('plan:end');return Response.json({content:[{type:'text',text:JSON.stringify(queryPlan)}]});}
  if(anthropic&&body.max_tokens===700){await delay(10);return Response.json({content:[{type:'text',text:JSON.stringify({identityMatch:'same',hasConcreteFacts:true,explicitlyUnknown:false,evidence:answer,reason:'Конкретний опис послуги та міста.'})}]});}
  if(anthropic&&body.max_tokens===4000){
   await delay(10);return Response.json({content:[{type:'text',text:JSON.stringify({engines:Object.fromEntries(keys.map(key=>[key,{complete:true,companies:[{name:'Beta',website:'https://beta.ua',stance:'recommended',evidence:recommendation}]}]))})}]});
  }
  const discovery=prompt.includes('Порадь до 3 конкретних');
  events.push(discovery?'recommendation:start':'knowledge:start');
  if(discovery){activeRecommendations++;peakRecommendations=Math.max(peakRecommendations,activeRecommendations);assert.ok(!prompt.includes('Acme'));}
  await delay(60);
  if(discovery)activeRecommendations--;
  events.push(discovery?'recommendation:end':'knowledge:end');
  const text=discovery?recommendation:answer;
  if(String(url).includes('openai.com'))return Response.json({output_text:text,status:'completed'});
  if(String(url).includes('googleapis.com'))return Response.json({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]});
  if(String(url).includes('perplexity.ai'))return Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});
  return Response.json({content:[{type:'text',text}],stop_reason:'end_turn'});
 };
 const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
 try {
  const scan=await post('/api/scan',{brand:'Acme',niche:'SEO, Київ',website:'127.0.0.1'});
  assert.equal(scan.queryPlan.queries.length,2);
  assert.equal(scan.zoneOfInvisibility.length,2);
  assert.equal(events.filter(e=>e==='knowledge:start').length,4);
  assert.equal(events.filter(e=>e==='recommendation:start').length,8);
  assert.equal(peakRecommendations,8);
  assert.ok(events.indexOf('knowledge:start')<events.indexOf('plan:end'));
  assert.ok(events.indexOf('recommendation:start')<events.indexOf('knowledge:end'));
  assert.equal(scan.recommendations.totalSuccessful,8);
  assert.equal(scan.recommendations.score,0);
  for(const engine of Object.values(scan.engines))assert.equal(engine.score,100);
  for(const zone of scan.zoneOfInvisibility){assert.ok(zone.timings.providerMs>=0);assert.ok(zone.timings.extractionMs>=0);}
  const saved=await post('/api/save-report',{brand:'Acme',niche:'SEO, Київ',website:'127.0.0.1',engines:Object.entries(scan.engines).map(([key,e])=>({key,...e})),zoneOfInvisibility:scan.zoneOfInvisibility,queryPlan:scan.queryPlan});
  const callsBefore=events.length;
  const report=await post('/api/sendpulse-report',{token:saved.token});
  assert.equal(report.recognitionScore,100);assert.equal(report.recommendationScore,0);
  const pdf=Buffer.from(await (await originalFetch(base+new URL(report.pdfUrl).pathname)).arrayBuffer());
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2);
  assert.equal(events.length,callsBefore,'PDF generation must not trigger AI again');
 } finally {globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));}
});
