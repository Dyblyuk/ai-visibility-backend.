import { ENGINE_LABELS, summarizeRecommendations } from './recommendation-analysis.js';
import { assessmentStatus } from './assessment-status.js';

// Compact presentation only: full queries, raw answers and evidence stay in report data.
export function drawRecommendations(doc, data, layout) {
  const {newPage,ensureSpace,mL,contentW}=layout;
  const ink='#EEF1F4',dim='#9AA5B1',orange='#F5781E',cyan='#4FD1C5';
  const zones=data.zoneOfInvisibility || [];
  const summary=summarizeRecommendations(zones,data.brand,data.website);
  let y=newPage();
  const text=(value,size=10,color=dim,bold=false)=>{
    doc.font(bold?'PT-Sans-Bold':'PT-Sans').fontSize(size);
    y=ensureSpace(y,doc.heightOfString(value,{width:contentW})+8);
    doc.fillColor(color).text(value,mL,y,{width:contentW});y=doc.y+8;
  };
  text('2. Кого AI рекомендують за запитами клієнтів',17,orange,true);
  text(`${summary.score===null?'—':summary.score}/100 · ${assessmentStatus(summary.score,'recommendation').label}`,14,ink,true);
  text(`Ваш бренд або сайт рекомендують у ${summary.totalRecommended} з ${summary.totalSuccessful} перевірених відповідей. Бал = частка таких відповідей × 100.`,10);
  const missing=zones.length*4-summary.totalSuccessful;
  if(missing)text(`Без оцінки: ${missing} із ${zones.length*4} перевірок. Технічні збої виключено з бала; результати неповні.`,9,orange);
  text('0 - не рекомендує; 1–99 - частково рекомендує; 100 - рекомендує в усіх доступних перевірках. Знання бренду не підвищує бал рекомендацій.',9);
  if(data.queryPlan?.querySource==='niche_templates')text('Запити сформовано за вказаною нішею: профіль послуг із сайту підтвердити не вдалося.',9,orange);
  if(!zones.length){text('Запити не сформовано. Уточніть сайт і нішу та повторіть перевірку.');return y;}
  const keys=Object.keys(ENGINE_LABELS);
  const widths=[151,...keys.map(()=>(contentW-151)/4)];
  const offsets=widths.map((_,i)=>mL+widths.slice(0,i).reduce((a,b)=>a+b,0));
  const cellHeight=(value,i,bold=false)=>{
    doc.font(bold?'PT-Sans-Bold':'PT-Sans').fontSize(8.5);
    return doc.heightOfString(value,{width:widths[i]-14})+18;
  };
  const drawRow=(cells,header=false)=>{
    const height=Math.max(header?74:52,...cells.map((cell,i)=>cellHeight(cell.text,i,header)));
    if(y+height>doc.page.height-doc.page.margins.bottom){y=newPage();if(!header)drawHeader();}
    cells.forEach((cell,i)=>{
      doc.rect(offsets[i],y,widths[i],height).fill(header?'#26303B':'#1D232B');
      doc.rect(offsets[i],y,widths[i],height).lineWidth(0.5).stroke('#3B4652');
      doc.font(header?'PT-Sans-Bold':'PT-Sans').fontSize(8.5).fillColor(cell.color||ink).text(cell.text,offsets[i]+7,y+9,{width:widths[i]-14});
    });
    y+=height;
  };
  const drawHeader=()=>drawRow([{text:'Потенційний запит клієнта'},...keys.map(key=>{
    const item=summary.byEngine[key];
    return {text:`${ENGINE_LABELS[key]}\n${item.status}\n${item.recommended}/${item.checked} відповідей`,color:item.score===100?cyan:ink};
  })],true);
  y=ensureSpace(y+5,150);drawHeader();
  for(const [index,zone] of zones.entries()){
    const cells=[{text:`${index+1}. ${zone.query}`}];
    for(const key of keys){
      const result=zone.engines?.[key];
      if(zone.analysisVersion!==2||result?.analysisStatus!=='ok'){cells.push({text:'Оцінку не отримано',color:dim});continue;}
      if(result.brandRecommended===true||result.websiteRecommended===true){cells.push({text:'Рекомендує вас',color:cyan});continue;}
      const companies=[...new Set((result.recommendedCompanies||[]).filter(c=>!c.isTarget).map(c=>c.name))];
      const short=name=>name.length>42?name.slice(0,39)+'…':name;
      const detail=companies.length?companies.slice(0,2).map(short).join('\n')+(companies.length>2?`\n+ ще ${companies.length-2}`:'')
        : result.competitorAnalysisStatus&&result.competitorAnalysisStatus!=='ok'?'Конкурентів не підтверджено':'Немає рекомендацій компаній';
      cells.push({text:detail,color:dim});
    }
    drawRow(cells);
  }
  y+=10;
  text('У клітинках - до двох компаній, яких AI рекомендує замість вас, або позначка про рекомендацію вашого бренду. «+ ще» означає скорочений список. Усі перевірки враховано в балах; повні відповіді збережено в даних аналізу.',8.5);
  text('Це потенційні запити без назви вашого бренду, не статистика частотності. Звіт відображає відповіді API на дату перевірки; у застосунках відповіді можуть відрізнятися.',8.5);
  return y;
}
