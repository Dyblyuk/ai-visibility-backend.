import test from 'node:test';
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test';process.env.ANTHROPIC_API_KEY='test';process.env.GEMINI_API_KEY='test';process.env.PERPLEXITY_API_KEY='test';process.env.REPORT_DATABASE_URL='';process.env.GEMINI_MODEL='gemini-3.6-flash';
const {app}=await import('../server.js');
const originalFetch=globalThis.fetch;
const answer='Я не маю доступу до сайту в реальному часі. Acme — українська агенція, що надає SEO та рекламу для магазинів.';
const evidence='Acme — українська агенція, що надає SEO та рекламу для магазинів.';
const good={identityMatch:'same',hasConcreteFacts:true,explicitlyUnknown:false,evidence,reason:'Наведено конкретний опис потрібної компанії.'};
test('all four providers preserve knowledge despite access disclaimer, with model and evidence',async()=>{
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 let invalid=false,truncated=false,calls=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return originalFetch(url,options);
  const body=JSON.parse(options.body);calls++;
  if(String(url).includes('openai.com'))return Response.json({output_text:answer,status:truncated?'incomplete':'completed'});
  if(String(url).includes('googleapis.com')){assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');assert.ok(body.generationConfig.maxOutputTokens>=4096);return Response.json({candidates:[{content:{parts:[{thought:true,text:'Internal reasoning must not be quoted'},{text:answer}]},finishReason:truncated?'MAX_TOKENS':'STOP'}]});}
  if(String(url).includes('perplexity.ai'))return Response.json({choices:[{message:{content:answer},finish_reason:truncated?'length':'stop'}]});
  if(body.max_tokens===700){assert.match(body.messages[0].content,/acme\.ua/);return Response.json({content:[{type:'text',text:invalid?'unknown':JSON.stringify(good)}]});}
  return Response.json({content:[{type:'text',text:answer}],stop_reason:truncated?'max_tokens':'end_turn'});
 };
 const post=(engine,niche='SEO')=>fetch(base+'/api/scan-engine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:'Acme',website:'https://acme.ua',niche,engine})}).then(r=>r.json());
 try {
  for(const engine of ['chatgpt','gemini','perplexity','claude']) {
   const data=await post(engine);assert.equal(data.score,100);assert.equal(data.verdict,'know');assert.equal(data.snippet,evidence);assert.equal(data.rawText,answer);assert.ok(data.model);assert.ok(data.reason);
  }
  const before=calls;await post('chatgpt');assert.equal(calls,before);
  invalid=true;const bad=await post('chatgpt','invalid');assert.equal(bad.score,null);assert.equal(bad.verdict,'unavailable');
  invalid=false;const retry=await post('chatgpt','invalid');assert.equal(retry.score,100); // error wasn't cached
  truncated=true;
  for(const engine of ['chatgpt','gemini','perplexity','claude']) {const data=await post(engine,'truncated');assert.equal(data.score,null);assert.equal(data.verdict,'unavailable');}
  truncated=false;
  const debug=await fetch(base+'/api/debug-mention?brand=Acme&website=https://acme.ua&engine=chatgpt').then(r=>r.json());assert.equal(debug.result.verdict,'know');
 } finally{globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));}
});
