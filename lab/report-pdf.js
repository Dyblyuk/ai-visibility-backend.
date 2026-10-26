import PDFDocument from 'pdfkit';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const C={bg:'#F0F0E6',ink:'#141414',orange:'#F5781E',muted:'#62645F',line:'#D9D9CF'};
export function reportPdf(report) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true});const chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  try{
   for(const [name,file] of [['Body','NotoSans-Regular.ttf'],['Bold','NotoSans-Bold.ttf'],['Head','Unbounded-SemiBold.ttf']])doc.registerFont(name,path.join(ROOT,'public/fonts',file));
   const W=515;
   const text=(s,x,y,w,h,size=10,font='Body',color=C.ink)=>doc.font(font).fontSize(size).fillColor(color).text(String(s??'').replace(/\*\*/g,'').replace(/[→↗]/g,' / ').replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').trim(),x,y,{width:w,height:h,ellipsis:true,lineGap:2});
   const box=(x,y,w,h,color='#FFFFFF')=>doc.roundedRect(x,y,w,h,7).fill(color);
   const header=(num,title)=>{
    doc.rect(0,0,595,842).fill(C.bg);text('TOP MARKETING',40,28,300,20,11,'Head');text('AI AUDIT / V2 LAB',360,31,195,15,9,'Bold',C.muted);
    doc.rect(40,59,28,4).fill(C.orange);text(num,40,91,70,35,22,'Head',C.orange);text(title,105,88,450,62,20,'Head');
   };
   header('01','Видимість вашого бренду');
   text(report.profile.brand,40,157,W,36,24,'Head');text(report.profile.website,40,198,W,20,9,'Body',C.muted);
   text(`${new Date(report.createdAt).toLocaleDateString('uk-UA')} · ${report.mode==='recorded'?'Записаний приклад':'Жива перевірка'} · ${report.profile.service}`,40,222,W,36,10,'Body',C.muted);
   const metrics=[['Знання бренду',report.recognitionScore,'Оцінено '+report.coverage.knowledge+'/4 AI'],['Рекомендації',report.summary.score,report.summary.totalRecommended+' із '+report.summary.totalSuccessful+' відповідей']];
   metrics.forEach(([label,score,note],i)=>{const x=40+i*265;box(x,275,250,119);text(label,x+16,289,218,22,10,'Bold');text(score===null?'—':score+'/100',x+16,318,218,39,28,'Head');text(note,x+16,367,218,17,9,'Body',C.muted);});
   text(report.executive,40,416,W,65,12,'Bold');
   report.engines.forEach((e,i)=>{const y=504+i*53;doc.moveTo(40,y).lineTo(555,y).lineWidth(.5).stroke(C.line);text(e.label,40,y+12,110,22,11,'Bold');text(e.score===null?'Оцінку не отримано':e.score===100?'Знає':e.score===50?'Частково знає':'Не знає',165,y+12,160,22,10,'Bold');text(e.error||e.classifierError||e.reason||e.snippet||'',325,y+10,230,35,8,'Body',C.muted);});
   text('Відповіді API - коротка вибірка. Це не позиції в Google AI Overviews і не оцінка всіх можливих запитів.',40,741,W,37,9,'Body',C.muted);

   doc.addPage();header('02','Запити, конкуренти, докази');
   let y=169;
   report.zones.forEach((z,i)=>{box(40,y,W,62);text('0'+(i+1),54,y+14,35,20,11,'Head',C.orange);text(z.query,101,y+12,436,39,10,'Bold');y+=72;});
   text('КОГО РЕКОМЕНДУЮТЬ У ЦІЙ ВИБІРЦІ',40,y+10,W,24,10,'Head');y+=45;
   report.summary.competitors.slice(0,Math.min(4,Math.floor((725-y)/92))).forEach(c=>{
    const occurrence=c.occurrences[0];
    text(c.name,40,y,W,23,12,'Bold');text(`${c.occurrences.length} згадок · ${c.website||'Сайт не вказано'}`,40,y+24,W,18,9,'Body',C.muted);
    text(occurrence?.evidence||'Цитата недоступна.',40,y+45,W,35,9);y+=92;
   });
   if(!report.summary.competitors.length)text('У доступних відповідях не підтверджено конкретних конкурентів. Це не означає, що конкурентів немає.',40,y,W,60,11);
   text('Згадка конкурента не доводить причину його вибору. Домени й твердження AI потрібно перевіряти перед використанням.',40,742,W,36,9,'Body',C.muted);

   doc.addPage();header('03','Перші дії для вашого бізнесу');
   report.actions.forEach((a,i)=>{
    const y=162+i*178;box(40,y,W,166);
    text('0'+(i+1),54,y+13,36,22,12,'Head',C.orange);text(a.title,101,y+11,437,34,12,'Bold');
    text(a.kind==='observed_gap'?'Спостереження на перевіреній сторінці':'Рекомендована перевірка',55,y+43,W-30,13,8,'Bold',C.muted);
    text(a.evidence,55,y+59,W-30,24,8.5);
    text(a.source||'Джерело: дані цієї перевірки',55,y+85,W-30,12,7,'Body',C.muted);
    if(a.source?.startsWith('https://'))doc.link(55,y+84,W-30,13,a.source);
    text(a.task,55,y+101,W-30,29,8.5);
    text('Наступний крок: '+a.example,55,y+133,W-30,20,8,'Body',C.muted);
    text(a.owner,55,y+155,W-30,10,7,'Bold',C.orange);
   });
   text(`Перевірено ${report.audit.pages.length} HTML-сторінок. ${report.audit.scope}`,40,704,W,33,8,'Body',C.muted);
   text('План містить спостереження та гіпотези для перевірки. Він не гарантує появи бренду в рекомендаціях AI.',40,747,W,31,9,'Body',C.muted);
   const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.moveTo(40,789).lineTo(555,789).strokeColor(C.line).stroke();text(`Top Marketing · тестова версія · ${i+1}/${range.count}`,40,799,W,12,8,'Body',C.muted);}
   doc.end();
  }catch(e){doc.destroy();reject(e);}
 });
}
