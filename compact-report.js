import PDFDocument from 'pdfkit';
import path from 'node:path';
import {ENGINE_LABELS} from './recommendation-analysis.js';
import {buildReportInsights,evidenceId} from './report-insights.js';
import {answerStatus} from './evidence-report.js';

const BG='#F0F0E6',INK='#141414',DIM='#585852',ORANGE='#F5781E',WHITE='#FFFFFF';
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const shorten=(value,length)=>{const s=clean(value);return s.length>length?s.slice(0,length-1)+'…':s;};

export function recommendationCard(zone,key) {
 const r=zone.engines?.[key];
 if(zone.analysisVersion!==2||r?.analysisStatus!=='ok')return {status:'Немає оцінки',detail:'Відповідь не вдалося перевірити.',color:DIM};
 const hit=r.brandRecommended===true||r.websiteRecommended===true;
 const names=[...new Set((r.recommendedCompanies||[]).filter(c=>!c.isTarget).map(c=>clean(c.name)))];
 return {status:hit?'Рекомендує вас':'Не рекомендує вас',color:hit?ORANGE:INK,
  detail:names.length?`${hit?'Також':'Замість вас'}: ${names.slice(0,2).join(' · ')}${names.length>2?` (+${names.length-2})`:''}`:
   r.competitorAnalysisStatus&&r.competitorAnalysisStatus!=='ok'?'Не вдалося розібрати список альтернатив. Потрібна повторна перевірка.':hit?'Інших компаній не названо.':'Конкретних компаній не рекомендує.'};
}

// Three readable summary pages. Full raw answers live on the private evidence
// page, linked from every matrix cell. Historical input is never discarded.
export function buildCompactReport(data) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:`AI Visibility · ${shorten(data.brand,120)}`,Author:'Top Marketing'}}),chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  try {
   const root=process.cwd(),fonts=path.join(root,'node_modules','@expo-google-fonts');
   // Full licensed fonts contain both Cyrillic and Latin. Font files remain
   // package dependencies, with their OFL licenses, rather than user artifacts.
   doc.registerFont('Body',path.join(fonts,'noto-sans','400Regular','NotoSans_400Regular.ttf'));
   doc.registerFont('Bold',path.join(fonts,'noto-sans','700Bold','NotoSans_700Bold.ttf'));
   doc.registerFont('Head',path.join(fonts,'unbounded','600SemiBold','Unbounded_600SemiBold.ttf'));
   const runs=(value,style)=>[{font:style,text:value}];
   const width=(value,size,style)=>runs(value,style).reduce((sum,run)=>sum+doc.font(run.font).fontSize(size).widthOfString(run.text),0);
   const wrap=(value,w,size,style)=>{
    const lines=[];let line='';
    for(const word of clean(value).split(' ')) {
     const next=line?line+' '+word:word;
     if(width(next,size,style)<=w){line=next;continue;}
     if(line){lines.push(line);line='';}
     if(width(word,size,style)<=w){line=word;continue;}
     for(const ch of word){if(line&&width(line+ch,size,style)>w){lines.push(line);line='';}line+=ch;}
    }
    if(line)lines.push(line);return lines;
   };
   const text=(value,x,y,w,{size=10,style='Body',color=INK,maxLines=100,lineHeight=size*1.4,link}={})=>{
    const full=wrap(value,w,size,style),lines=full.slice(0,maxLines);
    if(full.length>maxLines&&lines.length){let end=lines.at(-1);while(end&&width(end+'…',size,style)>w)end=end.slice(0,-1);lines[lines.length-1]=end+'…';}
    lines.forEach((line,i)=>{let dx=x;for(const run of runs(line,style)){doc.font(run.font).fontSize(size).fillColor(color).text(run.text,dx,y+i*lineHeight,{lineBreak:false});dx+=width(run.text,size,style);}if(link)doc.link(x,y+i*lineHeight,w,lineHeight,link);});
    return lines.length*lineHeight;
   };
   const W=doc.page.width-80;
   const panel=(x,y,w,h,dark=false)=>{doc.roundedRect(x,y,w,h,8).fill(dark?INK:WHITE);};
   const rule=y=>doc.moveTo(40,y).lineTo(40+W,y).lineWidth(.5).stroke('#C7C7BC');
   const page=(number,label)=>{if(number>1)doc.addPage();doc.rect(0,0,doc.page.width,doc.page.height).fill(BG);text('TOP MARKETING',40,27,240,{size:12,style:'Head'});text(`AI VISIBILITY / ${data.isDemo?'ДЕМО / ':''}${label}`,290,31,W-250,{size:8,color:DIM});doc.rect(40,55,34,4).fill(ORANGE);};
   const report=buildReportInsights(data),zones=data.zoneOfInvisibility||[],detail=data.isDemo?undefined:data.reportUrl;
   const detailLink=(id)=>detail?`${detail}#${id}`:undefined;
   const evidence=(refs,x,y,w)=>text(refs.map(ref=>ref.startsWith('knowledge-')?`Знання: ${ENGINE_LABELS[ref.slice(10)]}`:ref.replace(/^query-(\d+)-(.*)$/,(m,n,key)=>`Q${n} ${ENGINE_LABELS[key]}`)).join(' · '),x,y,w,{size:7.5,color:DIM,maxLines:2,link:refs[0]?detailLink(refs[0]):detail});

   page(1,'РЕЗУЛЬТАТ');
   text(shorten(data.brand||'Ваш бренд',150),40,77,W,{size:23,style:'Head',maxLines:2,lineHeight:30});
   text(`${new Date(data.ts||Date.now()).toLocaleDateString('uk-UA',{timeZone:'Europe/Kyiv'})} · ${shorten(data.niche||data.website||'Аналіз знання й рекомендацій',150)}`,40,143,W,{size:9,maxLines:2,color:DIM});
   const half=(W-14)/2;
   [{title:'ЗНАННЯ БРЕНДУ',score:report.recognitionScore,detail:`Оцінено ${report.knowledge.filter(e=>e.score!==null).length}/4 систем`},{title:'РЕКОМЕНДАЦІЇ',score:report.summary.score,detail:`${report.summary.totalRecommended}/${report.checkedAnswers} оцінених відповідей`}].forEach((item,i)=>{
    const x=40+i*(half+14);panel(x,185,half,103,i===1);const color=i?WHITE:INK;
    text(item.title,x+14,199,half-28,{size:9,style:'Bold',color});text(item.score===null?'Немає даних':`${item.score}/100`,x+14,220,half-28,{size:item.score===null?17:30,style:'Head',color:i?ORANGE:INK});text(item.detail,x+14,266,half-28,{size:8,color});
   });
   text(`Перевірено ${report.checkedQueries}/${report.expectedQueries} сценаріїв · оцінено ${report.checkedAnswers}/${report.expectedAnswers} відповідей`,40,302,W,{size:9,style:'Bold'});
   text('ЩО AI ЗНАЄ ПРО КОМПАНІЮ',40,333,W,{size:12,style:'Head'});
   report.knowledge.forEach((item,i)=>{
    const y=366+i*63;panel(40,y,W,56);text(item.label,52,y+9,125,{size:11,style:'Bold'});text(item.score===null?'Немає оцінки':`${item.score}/100`,W-35,y+10,65,{size:10,style:'Bold',color:item.score===null?DIM:INK});
    text(shorten(item.value?.snippet||item.value?.reason||'Надійної відповіді немає.',240),183,y+9,W-260,{size:8.5,maxLines:3,link:detailLink(`knowledge-${item.key}`)});
   });
   text('ГОЛОВНІ СПОСТЕРЕЖЕННЯ',40,637,W,{size:12,style:'Head'});
   report.findings.forEach((finding,i)=>{const y=667+i*31;doc.rect(40,y+3,4,19).fill(ORANGE);text(shorten(finding.text,260),53,y,W-13,{size:8.5,maxLines:2,lineHeight:11,link:finding.evidence[0]?detailLink(finding.evidence[0]):detail});});

   page(2,'ЗАПИТИ ТА КОНКУРЕНТИ');
   text('ДЕ ВАС РЕКОМЕНДУЮТЬ',40,81,W,{size:18,style:'Head'});
   text(detail?'Кожна клітинка веде до повної відповіді за приватним посиланням.':'Зіставлення п’яти запитів і відповідей чотирьох AI-систем.',40,112,W,{size:9,color:DIM});
   const qW=235,cellW=(W-qW)/4,top=145;
   text('Запит потенційного клієнта',48,top,qW-12,{size:9,style:'Bold'});
   Object.entries(ENGINE_LABELS).forEach(([key,label],j)=>text(label,40+qW+j*cellW+4,top,cellW-6,{size:7.6,style:'Bold'}));
   zones.slice(0,5).forEach((zone,i)=>{
    const y=top+25+i*64;panel(40,y,W,60);
    text(`${i+1}. ${zone.query}`,48,y+8,qW-16,{size:9,maxLines:3,lineHeight:13,link:detailLink(evidenceId(i,'chatgpt'))});
    Object.keys(ENGINE_LABELS).forEach((key,j)=>text(answerStatus(zone,key),40+qW+j*cellW+4,y+13,cellW-8,{size:8,maxLines:3,lineHeight:12,style:'Bold',color:answerStatus(zone,key)==='Рекомендує'?ORANGE:INK,link:detailLink(evidenceId(i,key))}));
   });
   if(!zones.length)text('Запити не сформовано. Уточніть профіль бізнесу й повторіть перевірку.',40,185,W,{size:12,maxLines:3});
   text('КОГО ЩЕ РЕКОМЕНДУЮТЬ',40,516,W,{size:13,style:'Head'});
   report.competitors.slice(0,2).forEach((company,i)=>{
    const y=550+i*80;panel(40,y,W,74);text(shorten(company.name,80),52,y+6,W-150,{size:11,style:'Bold',maxLines:1});
    text(`${company.occurrences.length}/${report.checkedAnswers}`,W-25,y+7,60,{size:13,style:'Bold',color:ORANGE});
    text(`У ${company.insteadCount} відповідях без рекомендації вашого бренду. Запити: ${[...new Set(company.occurrences.map(o=>o.queryNumber))].join(', ')}.`,52,y+26,W-24,{size:8,maxLines:1,link:detailLink(company.evidence[0])});
    text(`«${shorten(company.occurrences[0]?.evidence || 'Цитата не збережена.',185)}»`,52,y+43,W-24,{size:8.5,maxLines:2,lineHeight:11,link:detailLink(company.evidence[0])});
   });
   if(!report.competitors.length)text('Підтверджених конкурентів у збережених відповідях немає. Це не означає відсутності конкурентів на ринку.',40,552,W,{size:10,maxLines:3});
   text(`Показано ${Math.min(2,report.competitors.length)} із ${report.competitors.length} виявлених альтернатив. Усі запити, цитати й повні відповіді - у деталізації. Частота у вибірці не є часткою ринку.`,40,736,W,{size:8,color:DIM,maxLines:3});
   if(zones.length>5)text(`Історичний звіт: ще ${zones.length-5} запитів збережено в деталізації; оцінка враховує всі.`,40,711,W,{size:8,color:DIM,maxLines:2});

   page(3,'ПРІОРИТЕТНИЙ ПЛАН');
   text('ЩО ПЕРЕВІРИТИ ПЕРШИМ',40,81,W,{size:17,style:'Head'});
   text('Дії спираються на цей скан. Причини результату потребують окремої перевірки.',40,112,W,{size:9,color:DIM,maxLines:2});
   report.actions.forEach((action,i)=>{
    const y=149+i*172;panel(40,y,W,160);
    text(`0${i+1} / ${action.priority}`,54,y+10,W-28,{size:8,style:'Bold',color:ORANGE});
    text(shorten(action.title,105),54,y+28,W-28,{size:11,style:'Head',maxLines:2,lineHeight:15});
    text(shorten(action.observation,170),54,y+62,W-28,{size:8.5,style:'Bold',maxLines:2,lineHeight:11});
    text(action.action,54,y+88,W-28,{size:9,maxLines:4,lineHeight:12});
    evidence(action.evidence.slice(0,4),54,y+140,W-28);
   });
   panel(40,676,W,71,true);text('ОБГОВОРИМО ПЛАН ДЛЯ ВАШОГО БІЗНЕСУ',54,688,W-28,{size:10,style:'Bold',color:WHITE});text('Уточнимо задачі й підберемо наступні кроки з командою Top Marketing.',54,710,W-28,{size:9,color:WHITE,maxLines:2,link:'https://topmarketing.com.ua/#contacts'});
   text('Це знімок відповідей API. Моделі, пошук, кеш і персоналізація впливають на результат. Звіт не гарантує рекомендацій AI, звернень або продажів.',40,756,W,{size:7.8,color:DIM,maxLines:2,lineHeight:10});
   const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);rule(787);text(`Top Marketing · ${i+1}/${range.count}`,40,796,190,{size:8,color:DIM});text(detail?'Повні відповіді й докази':'Докази збережено у вихідному звіті',265,796,W-225,{size:8,color:DIM,link:detail});}
   doc.end();
  } catch(error){doc.destroy();reject(error);}
 });
}
