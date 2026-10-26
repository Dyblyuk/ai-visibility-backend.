import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {auditSite,normalizeSite} from './site-audit.js';
import {suggestedQueries,validateQueries,buildAuditReport,LABELS} from './analysis.js';
import {reportPdf} from './report-pdf.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM='https://ai-visibility-backend-ybg2.onrender.com';
// Only stateless computation is allowed across the production boundary.
export const ALLOWED_UPSTREAM=new Set(['/api/discovery-queries','/api/scan-engine','/api/zone-query']);
async function upstream(route,body) {
  if(!ALLOWED_UPSTREAM.has(route))throw Error('Маршрут не дозволено у тестовому режимі');
  const response=await fetch(UPSTREAM+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(52000)});
  if(!response.ok)throw Error(`AI-сервіс повернув HTTP ${response.status}`);
  return response.json();
}
export function validateProfile(input) {
  const fields=['brand','website','service','city'];const p={};
  for(const key of fields){if(typeof input?.[key]!=='string'||input[key].length>300)throw Error('Перевірте дані компанії');p[key]=input[key].trim();}
  if(!p.brand||!p.service||!p.website)throw Error('Вкажіть бренд, сайт і пріоритетну послугу');
  p.website=normalizeSite(p.website);return p;
}
export function createLab({callAI=upstream,inspectSite=auditSite,clock=()=>Date.now()}={}) {
  const app=express(),preparations=new Map(),jobs=new Map();let running=0;
  app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
  app.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow');next();});
  app.get('/api/status',async(_req,res)=>{
    let available=false;
    try{available=(await fetch(UPSTREAM+'/api/health',{signal:AbortSignal.timeout(6000)})).ok;}catch{}
    res.json({mode:'isolated-lab',liveAnalysisAvailable:available,productionWrites:false,integrations:{crm:false,sendpulse:false,ads:false,telegram:false},version:'0.1.0'});
  });
  const clean=()=>{for(const store of [preparations,jobs])for(const [id,item] of store)if(clock()-item.createdAt>3600000)store.delete(id);};
  app.post('/api/prepare',async(req,res)=>{
    try{
      clean();if(preparations.size>=20)return res.status(429).json({error:'Забагато підготовлених перевірок. Зачекайте або перезапустіть тестовий сервер.'});
      const profile=validateProfile(req.body);
      // Plan around the explicitly selected service, not every service in the site's menu.
      const [audit,planResult]=await Promise.all([inspectSite(profile),callAI('/api/discovery-queries',{brand:profile.brand,website:'',niche:profile.service+(profile.city?', '+profile.city:'')}).catch(e=>({queries:[],warning:e.message}))]);
      const id=randomUUID(),queries=suggestedQueries(profile,planResult);
      const item={id,createdAt:clock(),profile,audit,queries,plan:planResult};preparations.set(id,item);
      res.json({id,profile,audit,queries,warning:planResult.warning?'Живий AI-сервіс недоступний із цього середовища. Показано шаблонні запити; вони потребують перевірки.':(!audit.pages.length?'Не вдалося прочитати сайт. У звіті не буде непідтверджених висновків про сторінки.':null)});
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/jobs',(req,res)=>{
    try{
      clean();const prep=preparations.get(req.body?.preparationId);if(!prep)throw Error('Підготуйте перевірку ще раз');
      const queries=validateQueries(req.body.queries,prep.profile);
      if(running>=1)return res.status(429).json({error:'Тестова перевірка вже виконується. Дочекайтеся завершення.'});
      const id=randomUUID(),job={id,createdAt:clock(),status:'running',stage:'Перевіряємо знання бренду у 4 AI',progress:10,profile:prep.profile};jobs.set(id,job);running++;
      res.status(202).json({id});
      void (async()=>{
        try{
          const niche=prep.profile.service+(prep.profile.city?', '+prep.profile.city:'');
          const entries=await Promise.all(Object.keys(LABELS).map(async engine=>[engine,await callAI('/api/scan-engine',{...prep.profile,niche,engine}).catch(e=>({error:e.message,verdict:'unavailable'}))]));
          const engines=Object.fromEntries(entries);
          if(entries.every(([,e])=>e.error||e.classifierError||e.verdict==='unavailable'))throw Error('Не вдалося оцінити відповіді AI. Перевірте API-баланс і доступність сервісів. Технічний збій не означає, що бренд невідомий.');
          job.progress=35;job.stage='Перевіряємо підтверджені вами запити';
          const zones=[];let completed=0;
          // Bounded concurrency avoids multiplying pressure on the shared AI provider quotas.
          for(let i=0;i<queries.length;i+=2){
            const batch=await Promise.all(queries.slice(i,i+2).map(async query=>{
              const result=await callAI('/api/zone-query',{brand:prep.profile.brand,website:prep.profile.website,query}).catch(e=>({query,analysisVersion:2,engines:{},error:e.message}));
              completed++;job.progress=35+Math.round(completed/queries.length*48);return result;
            }));zones.push(...batch);
          }
          job.progress=90;job.stage='Формуємо спостереження й персональний план';
          job.report=buildAuditReport(prep.profile,{engines,zoneOfInvisibility:zones,queryPlan:{queries,confirmedByUser:true,services:[prep.profile.service]}},prep.audit);
          job.status='done';job.progress=100;job.stage='Звіт готовий';
        }catch(e){job.status='error';job.error=e.message;job.stage='Перевірку не завершено';}finally{running--;}
      })();
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.get('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Тестову перевірку не знайдено'});res.json({id:j.id,status:j.status,stage:j.stage,progress:j.progress,error:j.error,report:j.report});});
  app.get('/api/jobs/:id/report.pdf',async(req,res)=>{
    const j=jobs.get(req.params.id);if(!j?.report)return res.status(404).json({error:'Звіт ще не готовий'});
    try{const pdf=await reportPdf(j.report);res.set('Content-Disposition','attachment; filename="Top-Marketing-AI-Audit-v2.pdf"');res.type('pdf').send(pdf);}catch(e){console.warn('Lab PDF generation failed:',e.message);res.status(500).json({error:'Не вдалося створити PDF'});}
  });
  app.get('/api/demo',(_req,res)=>{
    try{
      const fixture=JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures/demo.json'),'utf8'));
      const report=buildAuditReport(fixture.profile,fixture.scan,fixture.audit,'recorded');report.createdAt=fixture.recordedAt;
      const id=randomUUID();jobs.set(id,{id,createdAt:clock(),status:'done',stage:'Записаний приклад',progress:100,report});res.json({id,report});
    }catch{res.status(503).json({error:'Приклад ще не підготовлено'});}
  });
  // Never proxy, import, or expose production contact / delivery / conversion routes.
  app.use('/api',(_req,res)=>res.status(404).json({error:'Маршрут відсутній у тестовій версії'}));
  app.use(express.static(path.join(ROOT,'public'),{index:'index.html'}));
  return app;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const portAt=process.argv.indexOf('--port');
  const port=Number(portAt>=0?process.argv[portAt+1]:process.env.PORT||3000);
  createLab().listen(port,'0.0.0.0',()=>console.log('AI Audit Lab is ready'));
}
