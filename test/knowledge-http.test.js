import test from 'node:test';
import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test';process.env.ANTHROPIC_API_KEY='test';process.env.REPORT_DATABASE_URL='';
const {app}=await import('../server.js');
const originalFetch=globalThis.fetch;
test('knowledge requires identity classification, not a matching brand string',async()=>{
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 let verdict='confused';const prompts=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return originalFetch(url,options);
  const body=JSON.parse(options.body);
  if(String(url).includes('openai.com')){prompts.push(body.input);return Response.json({output_text:'Acme: є кілька компаній із цією назвою, можливо американський магазин.'});}
  assert.match(body.messages[0].content,/acme\.ua/);
  return Response.json({content:[{type:'text',text:verdict}]});
 };
 try{
  for(const [i,value,expected] of [[0,'confused',50],[1,'unknown',0],[2,'know',100],[3,'probably unknown',null]]){
   verdict=value;
   const res=await fetch(base+'/api/scan-engine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:'Acme',website:'https://acme.ua',niche:'SEO '+i,engine:'chatgpt'})});
   assert.equal(res.status,200);const data=await res.json();assert.equal(data.score,expected);
   if(expected===null)assert.ok(data.classifierError);
  }
  for(const prompt of prompts)assert.match(prompt,/https:\/\/acme\.ua/);
 }finally{globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));}
});
