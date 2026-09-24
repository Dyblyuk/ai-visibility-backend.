import PDFDocument from 'pdfkit';
import path from 'node:path';
import {assessmentStatus} from './assessment-status.js';
import {ENGINE_LABELS,knowledgeScore,summarizeRecommendations} from './recommendation-analysis.js';

const BG='#14181D',PANEL='#1D232B',INK='#EEF1F4',DIM='#AAB4C0',ORANGE='#F5781E',CYAN='#4FD1C5',RED='#FF5A5F';
const plain=value=>String(value??'').replace(/\*\*/g,'').replace(/\s+/g,' ').trim();
// Fixed two-page layout. Every text box has a height and ellipsis; no data-driven page growth.
export function buildCompactReport(data) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true});const chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  try {
   const root=process.cwd();
   doc.registerFont('Regular',path.join(root,'assets/fonts/PTSans-Regular.ttf'));
   doc.registerFont('Bold',path.join(root,'assets/fonts/PTSans-Bold.ttf'));
   const W=doc.page.width-80;
   const text=(value,x,y,w,h,{size=10,bold=false,color=INK}={})=>doc.font(bold?'Bold':'Regular').fontSize(size).fillColor(color).text(plain(value),x,y,{width:w,height:h,ellipsis:true,lineGap:1});
   const card=(x,y,w,h,color=ORANGE)=>{doc.roundedRect(x,y,w,h,7).fill(PANEL);doc.rect(x,y,3,h).fill(color);};
   const page=()=>{doc.rect(0,0,doc.page.width,doc.page.height).fill(BG);try{doc.image(path.join(root,'assets/logo.png'),40,30,{width:95});}catch{};};
   const engines=Object.entries(ENGINE_LABELS).map(([key,label])=>{
    const e=(data.engines||[]).find(e=>e.key===key||e.label===label)||{verdict:'unavailable'};
    return {...e,key,label,score:knowledgeScore(e)};
   });
   const available=engines.filter(e=>e.score!==null);
   const recognition=available.length?Math.round(available.reduce((a,e)=>a+e.score,0)/available.length):null;
   const allZones=data.zoneOfInvisibility||[];
   const summary=summarizeRecommendations(allZones,data.brand,data.website);
   page();text(data.brand||'Ваш бренд',40,76,W,42,{size:23,bold:true});
   const date=new Date(data.ts||Date.now()).toLocaleDateString('uk-UA');
   text(`AI-видимість · ${date} · ${data.niche||data.website||''}`,40,119,W,25,{size:9,color:DIM});
   const half=(W-14)/2;
   for(const [i,value] of [{title:'ЗНАННЯ БРЕНДУ',score:recognition,kind:'knowledge'},{title:'РЕКОМЕНДАЦІЇ',score:summary.score,kind:'recommendation'}].entries()){
    const x=40+i*(half+14);card(x,154,half,103);
    text(value.title,x+15,166,half-30,18,{size:10,bold:true});
    text(value.score===null?'—':`${value.score}/100`,x+15,187,half-30,39,{size:29,bold:true,color:ORANGE});
    text(assessmentStatus(value.score,value.kind).label,x+15,230,half-30,18,{size:11});
   }
   text(`Знання: 100 - знає, 50 - частково знає, 0 - не знає. Оцінено ${available.length}/4 AI. Технічні збої не є нульовими оцінками.`,40,269,W,29,{size:9,color:DIM});
   text('1. Що кожна AI знає про вас',40,301,W,25,{size:15,bold:true,color:ORANGE});
   engines.forEach((e,i)=>{
    const y=336+i*106;const status=assessmentStatus(e.score);
    const color=e.score===null?DIM:e.score===100?CYAN:e.score===0?RED:ORANGE;
    card(40,y,W,98,color);
    text(`${e.label}  ·  ${status.label}${e.score===null?'':`  ·  ${e.score}/100`}`,54,y+9,W-28,19,{size:11,bold:true,color});
    const quote=e.snippet?`«${plain(e.snippet)}»`:(e.error||e.classifierError||'Відповідь для оцінки не отримано.');
    text(quote,54,y+32,W-28,32,{size:9.5,color:DIM});
    text(e.reason||'',54,y+65,W-28,14,{size:9,color:DIM});
    text(e.model?`${e.model} · ${e.searchMode==='model_knowledge'?'без веб-пошуку':'веб-пошук увімкнено'}`:'',54,y+81,W-28,12,{size:8,color:DIM});
   });
   doc.addPage();page();
   text('2. Чи рекомендують вас і кого радять замість',40,78,W,31,{size:17,bold:true,color:ORANGE});
   text(`${summary.score===null?'—':summary.score}/100 · ${assessmentStatus(summary.score,'recommendation').label}`,40,118,W,25,{size:16,bold:true});
   const missing=allZones.length*4-summary.totalSuccessful;
   text(`Вас рекомендують у ${summary.totalRecommended}/${summary.totalSuccessful} доступних відповідей. Бал - частка рекомендацій × 100. Без оцінки: ${missing}.`,40,153,W,27,{size:9,color:DIM});
   // Three representative query rows are sufficient for a short lead-magnet report.
   const zones=allZones.slice(0,3);
   zones.forEach((zone,i)=>text(`${i+1}. ${zone.query}`,40,194+i*34,W,31,{size:10,bold:true}));
   if(!zones.length)text('Не вдалося сформувати запити. Уточніть сайт і нішу та повторіть аналіз.',40,194,W,45,{color:ORANGE});
   const keys=Object.keys(ENGINE_LABELS);const widths=[39,...keys.map(()=>(W-39)/4)];
   const xs=widths.map((_,i)=>40+widths.slice(0,i).reduce((a,b)=>a+b,0));
   const row=(cells,y,h,header=false)=>cells.forEach((cell,i)=>{
    doc.rect(xs[i],y,widths[i],h).fill(header?'#26303B':PANEL);doc.rect(xs[i],y,widths[i],h).lineWidth(.5).stroke('#414C58');
    text(cell.text,xs[i]+7,y+8,widths[i]-14,h-14,{size:8.5,bold:header,color:cell.color||INK});
   });
   row([{text:'№'},...keys.map(key=>({text:`${ENGINE_LABELS[key]} · ${summary.byEngine[key].status}`}))],309,53,true);
   zones.forEach((zone,i)=>row([{text:String(i+1)},...keys.map(key=>{
    const r=zone.engines?.[key];
    if(zone.analysisVersion!==2||r?.analysisStatus!=='ok')return{text:'Оцінку не отримано',color:DIM};
    if(r.brandRecommended===true||r.websiteRecommended===true)return{text:'Рекомендує вас',color:CYAN};
    const names=[...new Set((r.recommendedCompanies||[]).filter(c=>!c.isTarget).map(c=>c.name))];
    return {text:names.length?names.slice(0,2).join('; ')+(names.length>2?` (+${names.length-2})`:''):r.competitorAnalysisStatus&&r.competitorAnalysisStatus!=='ok'?'Конкурентів не підтверджено':'Компаній не рекомендує',color:DIM};
   })],362+i*65,65));
   text(`У таблиці - до двох конкурентів у кожній відповіді; число в дужках - решта.${allZones.length>3?' Показано перші 3 запити; бал враховує всі '+allZones.length+'.':''} Повні відповіді збережено в даних аналізу.`,40,574,W,32,{size:8.5,color:DIM});
   text('0 - не рекомендує; 1–99 - частково рекомендує; 100 - рекомендує в усіх доступних перевірках. Це знімок відповідей API, а не гарантія результатів у застосунках AI.',40,614,W,30,{size:8.5,color:DIM});
   text('Наступні кроки',40,660,W,21,{size:13,bold:true,color:ORANGE});
   text('1. Уточніть опис послуг і географії на сайті.  2. Підсильте сторінки за запитами, де AI радить конкурентів.  3. Повторіть перевірку після змін.',40,691,W,36,{size:10});
   text('Розібрати результати з Top Marketing → topmarketing.com.ua',40,744,W,22,{size:10,bold:true,color:ORANGE});
   const range=doc.bufferedPageRange();
   for(let i=0;i<range.count;i++){doc.switchToPage(i);text(`Top Marketing · ${i+1}/${range.count}`,40,784,W,16,{size:8,color:DIM});}
   doc.end();
  } catch(error){doc.destroy();reject(error);}
 });
}
