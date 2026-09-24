import PDFDocument from 'pdfkit';
import path from 'node:path';
import {assessmentStatus} from './assessment-status.js';
import {ENGINE_LABELS,knowledgeScore,summarizeRecommendations} from './recommendation-analysis.js';

const BG='#F0F0E6',PANEL='#FFFFFF',INK='#19232C',DIM='#586571',ORANGE='#F5781E',BLUE='#3D71B8',GREEN='#147D64',RED='#B9433F';
const plain=value=>String(value??'').replace(/\*\*/g,'').replace(/\s+/g,' ').trim();
const statusColor=score=>score===null?DIM:score===100?GREEN:score===0?RED:BLUE;
const labelFor=key=>key==='gemini'?'Gemini (Google)':ENGINE_LABELS[key];

// Shared presentation data: a technical failure must never look like a negative answer.
export function recommendationCard(zone,key) {
 const r=zone.engines?.[key];
 if(zone.analysisVersion!==2||r?.analysisStatus!=='ok')return {status:'Немає оцінки',detail:'Відповідь не вдалося перевірити.',color:DIM};
 const hit=r.brandRecommended===true||r.websiteRecommended===true;
 const names=[...new Set((r.recommendedCompanies||[]).filter(c=>!c.isTarget).map(c=>plain(c.name)))];
 const more=names.length>2?` (+${names.length-2})`:'';
 const competitors=names.slice(0,2).join(' · ')+more;
 return {
  status:hit?'Рекомендує вас':'Не рекомендує вас',color:hit?GREEN:RED,
  detail:competitors?`${hit?'Також':'Замість вас'}: ${competitors}`:
   r.competitorAnalysisStatus&&r.competitorAnalysisStatus!=='ok'?'Конкурентів не вдалося підтвердити.':
   hit?'Інших компаній не названо.':'Конкретних компаній не рекомендує.'
 };
}

// Fixed two-page layout with bounded text boxes, including historical long reports.
export function buildCompactReport(data) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true});const chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  try {
   const root=process.cwd();
   doc.registerFont('Regular',path.join(root,'assets/fonts/PTSans-Regular.ttf'));
   doc.registerFont('Bold',path.join(root,'assets/fonts/PTSans-Bold.ttf'));
   const W=doc.page.width-80,half=(W-16)/2;
   const text=(value,x,y,w,h,{size=10,bold=false,color=INK}={})=>doc.font(bold?'Bold':'Regular').fontSize(size).fillColor(color).text(plain(value),x,y,{width:w,height:h,ellipsis:true,lineGap:1});
   const card=(x,y,w,h,color=ORANGE)=>{doc.roundedRect(x,y,w,h,8).fill(PANEL);doc.rect(x,y,3,h).fill(color);};
   const rule=(x,y,w)=>doc.moveTo(x,y).lineTo(x+w,y).lineWidth(.5).stroke('#DCE1DF');
   const page=()=>{
    doc.rect(0,0,doc.page.width,doc.page.height).fill(BG);
    text('TOP MARKETING',40,30,W,22,{size:13,bold:true});
    doc.rect(40,58,28,3).fill(ORANGE);
    text('AI-VISIBILITY / ЕКСПРЕС-ЗВІТ',245,33,W-205,16,{size:8,color:DIM});
   };
   const engines=Object.entries(ENGINE_LABELS).map(([key,label])=>{
    const e=(data.engines||[]).find(e=>e.key===key||e.label===label)||{verdict:'unavailable'};
    return {...e,key,label:labelFor(key),score:knowledgeScore(e)};
   });
   const available=engines.filter(e=>e.score!==null);
   const recognition=available.length?Math.round(available.reduce((a,e)=>a+e.score,0)/available.length):null;
   const allZones=data.zoneOfInvisibility||[],zones=allZones.slice(0,3);
   const summary=summarizeRecommendations(allZones,data.brand,data.website);
   page();text(data.brand||'Ваш бренд',40,80,W,38,{size:25,bold:true});
   text(`${new Date(data.ts||Date.now()).toLocaleDateString('uk-UA')} · ${data.niche||data.website||'Аналіз знання та рекомендацій бренду'}`,40,122,W,27,{size:9,color:DIM});
   for(const [i,value] of [{title:'ЗНАННЯ БРЕНДУ',score:recognition,kind:'knowledge'},{title:'РЕКОМЕНДАЦІЇ',score:summary.score,kind:'recommendation'}].entries()){
    const x=40+i*(half+16);card(x,162,half,104);
    text(value.title,x+16,176,half-32,17,{size:10,bold:true,color:DIM});
    text(value.score===null?'—':`${value.score}/100`,x+16,198,half-32,35,{size:29,bold:true});
    text(assessmentStatus(value.score,value.kind).label,x+16,240,half-32,18,{size:10,bold:true,color:statusColor(value.score)});
   }
   text('01 / ЩО КОЖНА AI ЗНАЄ ПРО ВАС',40,291,W,24,{size:13,bold:true});
   text('Короткий доказ із відповіді та узгоджена з ним оцінка.',40,317,W,17,{size:9,color:DIM});
   engines.forEach((e,i)=>{
    const y=346+i*98,color=statusColor(e.score),status=assessmentStatus(e.score);
    card(40,y,W,90,color);
    text(e.label,55,y+12,175,20,{size:13,bold:true});
    text(`${status.label}${e.score===null?'':` · ${e.score}/100`}`,244,y+14,W-220,18,{size:10,bold:true,color});
    const quote=e.snippet?`«${plain(e.snippet)}»`:(e.error||e.classifierError||'Відповідь для оцінки не отримано.');
    text(quote,55,y+37,W-30,31,{size:10});
    text(e.reason||'',55,y+71,W-30,13,{size:8,color:DIM});
   });
   text(`Оцінено ${available.length}/4 AI. Знання: 100 - знає; 50 - частково знає; 0 - не знає. Збій API позначається окремо та не перетворюється на 0.`,40,750,W,27,{size:8.5,color:DIM});

   doc.addPage();page();
   text('02 / ЧИ РЕКОМЕНДУЮТЬ ВАС',40,79,W,25,{size:18,bold:true});
   text(`${summary.score===null?'—':summary.score}/100`,40,115,160,40,{size:29,bold:true,color:ORANGE});
   text(assessmentStatus(summary.score,'recommendation').label,211,119,W-171,21,{size:13,bold:true});
   text(`${summary.totalRecommended} із ${summary.totalSuccessful} оцінених відповідей - на вашу користь`,211,144,W-171,17,{size:9,color:DIM});
   text('ЗАПИТИ ПОТЕНЦІЙНИХ КЛІЄНТІВ',40,180,W,18,{size:10,bold:true,color:DIM});
   zones.forEach((zone,i)=>{
    doc.roundedRect(40,205+i*30,24,22,4).fill(ORANGE);
    text(`0${i+1}`,45,208+i*30,19,15,{size:10,bold:true,color:'#FFFFFF'});
    text(zone.query,75,205+i*30,W-35,27,{size:10,bold:true});
   });
   if(!zones.length)text('Запити не сформовано. Уточніть сайт або нішу та повторіть перевірку.',40,208,W,44,{size:11,color:BLUE});
   const top=zones.length===3?310:280,height=zones.length===3?181:188;
   Object.keys(ENGINE_LABELS).forEach((key,i)=>{
    const x=40+(i%2)*(half+16),y=top+Math.floor(i/2)*(height+14),item=summary.byEngine[key],color=statusColor(item.score);
    card(x,y,half,height,color);
    text(labelFor(key),x+14,y+12,half-28,22,{size:14,bold:true});
    text(item.status,x+14,y+37,half-28,17,{size:10,bold:true,color});
    text(`${item.recommended}/${item.checked} рекомендацій · без оцінки: ${item.unavailable}`,x+14,y+56,half-28,13,{size:8,color:DIM});
    rule(x+14,y+75,half-28);
    const rowHeight=zones.length===3?32:49;
    zones.forEach((zone,j)=>{
     const row=recommendationCard(zone,key),ry=y+83+j*rowHeight;
     text(`0${j+1}  ${row.status}`,x+14,ry,half-28,15,{size:9,bold:true,color:row.color});
     text(row.detail,x+14,ry+16,half-28,rowHeight-17,{size:zones.length===3?8:9});
    });
    if(!zones.length)text('Немає даних для оцінки рекомендацій.',x+14,y+88,half-28,38,{color:DIM});
   });
   const bottom=top+height*2+14;
   text(`Бал - частка рекомендацій у доступних відповідях за ${allZones.length} запитами. 0 - не рекомендує; 1-99 - частково; 100 - рекомендує в усіх перевірених відповідях.`,40,bottom+16,W,29,{size:8.5,color:DIM});
   text(`${allZones.length>zones.length?`Показано ${zones.length} із ${allZones.length} запитів; бал враховує всі. `:''}Це коротка вибірка відповідей API, а не повне дослідження ринку. До 2 конкурентів на запит; (+N) - решта.`,40,bottom+48,W,28,{size:8.5,color:DIM});
   text('Перший крок: посильте сторінки послуг, за якими AI радить конкурентів.',40,767,W,16,{size:9,bold:true});
   const range=doc.bufferedPageRange();
   for(let i=0;i<range.count;i++){doc.switchToPage(i);rule(40,784,W);text(`Top Marketing · ${i+1}/${range.count}`,40,790,W,10,{size:8,color:DIM});}
   doc.end();
  } catch(error){doc.destroy();reject(error);}
 });
}
