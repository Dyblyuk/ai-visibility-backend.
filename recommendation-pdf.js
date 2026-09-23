import { ENGINE_LABELS, summarizeRecommendations } from './recommendation-analysis.js';

export function drawRecommendations(doc, data, layout) {
  const {newPage,ensureSpace,mL,contentW}=layout;
  const ink='#EEF1F4', dim='#9AA5B1', orange='#F5781E', cyan='#4FD1C5';
  const zones=data.zoneOfInvisibility || [];
  const summary=data.recommendations || summarizeRecommendations(zones,data.brand,data.website);
  let y=newPage();
  const plain=value=>String(value).replace(/\*\*/g,'').replace(/\[(\d+)\]/g,'');
  const text=(value,{bold=false,size=10,color=dim,after=8}={})=>{
    value=plain(value);
    doc.font(bold?'PT-Sans-Bold':'PT-Sans').fontSize(size);
    y=ensureSpace(y,doc.heightOfString(value,{width:contentW})+after);
    doc.fillColor(color).text(value,mL,y,{width:contentW});y=doc.y+after;
  };
  const heading=value=>{y=ensureSpace(y,110);text(value,{bold:true,size:17,color:orange,after:14});};
  heading('2. Чи рекомендують вас AI');
  text(`Загальний бал рекомендацій: ${summary.score===null?'немає даних':summary.score+'/100'}`,{bold:true,size:15,color:ink,after:12});
  text(`Рекомендацій бренду або сайту: ${summary.totalRecommended} з ${summary.totalSuccessful} успішно перевірених відповідей усіх чотирьох AI.`,{bold:true,color:ink});
  text('Кожен запит доповнюємо однаковим проханням порадити 3–5 конкретних компаній або постачальників і пояснити вибір.');
  text('Один запит перевіряємо в кожній AI. Якщо у відповіді рекомендують ваш бренд або сайт - це 1 рекомендація; якщо не рекомендують, не знають або лише згадують - 0. Частка рекомендацій у всіх перевірених відповідях × 100 і є загальним балом.');
  text('Приклад: 5 запитів × 4 AI = 20 відповідей. Рекомендації у 6 відповідях дають 30/100. Якщо рекомендацій немає - 0/100. Знання бренду саме по собі цей бал не підвищує.');
  const missing=summary.queryCount*4-summary.totalSuccessful;
  if(missing)text(`Непідтверджених або недоступних відповідей: ${missing}. Технічна помилка не є відповіддю «не рекомендує»: її виключено з розрахунку.${!summary.totalSuccessful?' У цій перевірці немає даних для оцінки.':''}`,{color:orange});
  if(summary.website)text(`Перевіряємо бренд «${data.brand}» або його сайт ${summary.website}. Це один сигнал рекомендації, без подвійного рахування.`);
  y+=12;
  heading('Основні запити потенційних клієнтів');
  if(data.queryPlan?.services?.length)text(`Послуги або товари, на яких базуються запити: ${data.queryPlan.services.join('; ')}.`);
  if(data.queryPlan?.querySource==='niche_templates')text('Не вдалося уточнити перелік послуг з джерел. Використано загальні запити за вказаною нішею; для точнішої перевірки уточніть нішу та сайт.',{color:orange});
  text('Це потенційні формулювання клієнтів за послугами, товарами та географією компанії. Вони не містять вашої назви й не є статистикою пошукової частотності.');
  if(!zones.length)text('Запити не сформовано. Уточніть нішу і сайт та повторіть аналіз.');
  for(const [index,zone] of zones.entries())text(`${index+1}. ${zone.query}`,{bold:true,color:ink});
  text('Нижче - конкуренти окремо для ChatGPT, Claude, Gemini та Perplexity. До списку «замість вас» потрапляють тільки рекомендації з відповідей, у яких ваш бренд або сайт не рекомендовано.');

  for(const [key,label] of Object.entries(ENGINE_LABELS)) {
    if(key==='chatgpt')y=newPage();
    else {y+=22;y=ensureSpace(y,220);}
    heading(`3. ${label}: кого рекомендує замість вас`);
    const available=zones.filter(zone=>zone.analysisVersion===2&&zone.engines?.[key]?.analysisStatus==='ok');
    const names=[...new Set(available.filter(zone=>!zone.engines[key].recommended).flatMap(zone=>(zone.engines[key].recommendedCompanies||[]).filter(item=>!item.isTarget).map(item=>item.name)))];
    text(names.length?`Конкуренти: ${names.join(', ')}.`:'У доступних відповідях не зафіксовано компаній, рекомендованих замість вас.',{bold:true,color:ink,after:14});
    const observed=zones.map(zone=>zone.engines?.[key]).find(Boolean);
    if(observed?.model)text(`Модель: ${observed.model}. ${observed.searchMode==='model_knowledge'?'Відповідь без веб-пошуку.':'Веб-пошук увімкнений у налаштуваннях.'}`,{size:8.5});
    for(const [index,zone] of zones.entries()) {
      y=ensureSpace(y,120);
      text(`${label} · Запит ${index+1}. ${zone.query}`,{bold:true,size:11,color:orange,after:10});
      const result=zone.engines?.[key];
      if(zone.analysisVersion!==2||result?.analysisStatus!=='ok') {
        text('Немає підтверджених даних. Цю відповідь не включено в загальний бал.');
        if(result?.rawText)text(`Отриманий уривок: «${result.rawText.slice(0,400)}»`,{size:9});
        y+=12;continue;
      }
      const hit=result.brandRecommended===true||result.websiteRecommended===true;
      text(`Рекомендує ваш бренд або сайт: ${hit?'ТАК':'НІ'}.`,{bold:true,color:hit?cyan:ink});
      if(result.checkedAt)text(`Зафіксовано: ${new Date(result.checkedAt).toLocaleString('uk-UA',{timeZone:'UTC'})} UTC${result.cached?' (відповідь із кешу)':''}.`,{size:8.5});
      if(hit) {
        for(const quote of result.targetEvidence||[])text(`Підтвердження: «${quote}»`,{size:9.5});
        text('Ваш бренд або сайт є серед рекомендацій, тому інші варіанти в цій відповіді не зараховуємо до конкурентів «замість вас».',{size:9});
      } else {
        const others=(result.recommendedCompanies||[]).filter(item=>!item.isTarget);
        if(!others.length)text(result.competitorAnalysisStatus && result.competitorAnalysisStatus!=='ok' ? 'Вашого бренду або сайту у відповіді немає: 0 рекомендацій. Список конкурентів не вдалося надійно підтвердити.' : 'Конкретних компаній замість вас AI не рекомендувала. Для загального бала це 0 рекомендацій.');
        else if(result.competitorAnalysisStatus==='partial')text('Наведено лише конкурентів із підтвердженими цитатами; частину назв не вдалося перевірити.',{size:9});
        for(const company of others) {
          y=ensureSpace(y,90);
          text(`${company.name}${company.website?' · '+company.website:''}`,{bold:true,color:ink,after:5});
          text(`«${company.evidence}»`,{size:9.5,after:13});
        }
        if(!others.length&&result.rawText)text(`Уривок відповіді: «${result.rawText.slice(0,500)}»`,{size:9});
        for(const quote of result.targetEvidence||[])text(`Згадка про вас без рекомендації: «${quote}»`,{size:9});
      }
      y+=14;
    }
  }
  text('Це знімок відповідей API на дату перевірки. У застосунках AI відповіді можуть відрізнятися через моделі, пошук і персоналізацію. Назви конкурентів наведено як спостереження за відповідями, а не як підтвердження якості цих компаній.',{size:8.5});
  return y;
}
