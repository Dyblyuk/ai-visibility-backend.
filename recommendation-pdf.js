import { ENGINE_LABELS, summarizeRecommendations } from './recommendation-analysis.js';

export function drawRecommendations(doc, data, layout) {
  const { newPage, ensureSpace, card, mL, contentW } = layout;
  const ink='#EEF1F4', dim='#9AA5B1', orange='#F5781E', cyan='#4FD1C5';
  const zones = data.zoneOfInvisibility || [];
  const summary = data.recommendations || summarizeRecommendations(zones,data.brand,data.website);
  let y = newPage();
  const text = (value,{bold=false,size=10,color=dim,after=7}={}) => {
    doc.font(bold?'PT-Sans-Bold':'PT-Sans').fontSize(size);
    const h=doc.heightOfString(value,{width:contentW});
    y=ensureSpace(y,h+after);
    doc.fillColor(color).text(value,mL,y,{width:contentW});
    y=doc.y+after;
  };
  const title = value => { y=ensureSpace(y,100);text(value,{bold:true,size:17,color:orange,after:12}); };
  const score = value => value === null || value === undefined ? 'немає даних' : `${value}/100`;
  title('Чи рекомендує AI ваш бренд і сайт');
  text('Перевіряємо запити клієнтів без назви вашого бренду. Рекомендація - конкретна позитивна порада обрати компанію. Нейтральна згадка, заперечення та посилання на джерело не зараховуються.');
  text('Бал = кількість запитів із рекомендацією / кількість успішно проаналізованих відповідей цієї AI × 100. Наприклад, 2 з 3 = 67/100. Один запит має однакову вагу. Помилки не перетворюються на нулі.');
  text(summary.website ? `Домен для перевірки: ${summary.website}` : 'Сайт не вказаний: оцінюємо назву бренду. Для окремого бала сайту введіть його адресу в уточненнях на початку нового аналізу.');
  text(`Запитів у вибірці: ${summary.queryCount}. Успішно перевірених відповідей: ${summary.totalSuccessful}/${summary.queryCount*4}.`,{bold:true,color:ink});
  text('Це разова вибірка відповідей API, а не статистика всіх користувачів ChatGPT, Claude, Gemini чи Perplexity. Моделі, пошук і персоналізація в їхніх застосунках можуть відрізнятися.');
  for (const [key,item] of Object.entries(summary.byEngine)) {
    const observed = zones.map(zone=>zone.engines?.[key]).find(Boolean);
    const mode = observed?.searchMode === 'model_knowledge' ? 'без веб-пошуку' : observed?.searchMode === 'web_search_enabled' ? 'веб-пошук увімкнений' : 'режим не зафіксовано';
    const lines = [
      `Бренд або сайт: ${score(item.score)}  |  Рекомендацій: ${item.recommended}/${item.checked}`,
      `Назва бренду: ${score(item.brandScore)}  |  Сайт: ${summary.website ? score(item.websiteScore) : 'не вказано'}`,
      `Перевірено: ${item.checked}/${item.total}; без даних: ${item.unavailable}. ${mode}.`,
      observed?.model ? `Модель: ${observed.model}` : ''
    ].filter(Boolean);
    doc.font('PT-Sans').fontSize(9.5);
    const h=40+lines.reduce((sum,line)=>sum+doc.heightOfString(line,{width:contentW-32})+4,0);
    y=ensureSpace(y,h+12);card(mL,y,contentW,h,{borderLeft:item.score===null?dim:orange});
    doc.font('PT-Sans-Bold').fontSize(12).fillColor(ink).text(item.label,mL+16,y+12);
    let rowY=doc.y+7;
    for(const line of lines) {doc.font('PT-Sans').fontSize(9.5).fillColor(dim).text(line,mL+16,rowY,{width:contentW-32});rowY=doc.y+4;}
    y+=h+12;
  }
  y=newPage();
  title('Кого рекомендують поряд із вами або замість вас');
  text('Нижче лише компанії, які названі як рекомендації в отриманих відповідях. «Замість» означає, що в цій відповіді ваш бренд і сайт не рекомендовані. Номери запитів розшифровані далі.');
  if(!summary.competitors.length) text('Підтверджених рекомендацій інших компаній у доступних відповідях немає. Це не означає, що конкурентів немає або ніша вільна.');
  for (const entry of summary.competitors) {
    y=ensureSpace(y,90);
    text(`${entry.name}${entry.website ? ' · '+entry.website : ''}`,{bold:true,color:ink});
    for(const key of Object.keys(ENGINE_LABELS)) {
      const occurrences=entry.occurrences.filter(item=>item.engine===key);
      if(!occurrences.length)continue;
      text(`${ENGINE_LABELS[key]}: ${occurrences.map(item=>`запит ${item.queryNumber} (${item.insteadOf?'замість вас':'поряд із вами'})`).join('; ')}.`,{size:9.5});
    }
    y+=5;
  }
  for (const [index,zone] of zones.entries()) {
    y=newPage();
    title(`Запит ${index+1} · відповіді кожної AI`);
    text(zone.query,{bold:true,size:11,color:ink,after:15});
    for (const [key,label] of Object.entries(ENGINE_LABELS)) {
      const result=zone.engines?.[key];
      y=ensureSpace(y,120);
      text(label,{bold:true,size:13,color:orange});
      if(zone.analysisVersion!==2 || result?.analysisStatus!=='ok') {
        text('Немає достатніх даних для оцінки рекомендацій. Цю відповідь не враховано в балі.');
        if(result?.rawText) text(`Уривок отриманої відповіді (класифікація не підтверджена): «${result.rawText.slice(0,350)}»`,{size:9});
        continue;
      }
      const status = result.targetStatus==='negative' ? 'є негативна згадка' : result.targetStatus==='mentioned' ? 'лише згадка' : 'не рекомендовано';
      text(`Назва бренду: ${result.brandRecommended?'рекомендує':status}. Сайт: ${!summary.website?'не вказано':result.websiteRecommended?'рекомендує':'не рекомендовано'}.`,{bold:true,color:ink});
      if(result.checkedAt) text(`Відповідь зафіксована: ${new Date(result.checkedAt).toLocaleString('uk-UA',{timeZone:'UTC'})} UTC${result.cached?' (із кешу)':''}.`,{size:8.5});
      for(const evidence of result.targetEvidence || []) text(`Про вас: «${evidence}»`,{size:9});
      const others=(result.recommendedCompanies || []).filter(item=>!item.isTarget);
      if(!others.length) text('Інших конкретних компаній як рекомендацій не зафіксовано.',{size:9.5});
      else {
        text(result.recommended?'Інші рекомендовані варіанти:':'Кого рекомендує замість вас:',{bold:true,color:cyan});
        for(const company of others) {
          y=ensureSpace(y,75);
          text(`${company.name}${company.website?' · '+company.website:''}`,{bold:true,size:10,color:ink,after:4});
          text(`«${company.evidence}»`,{size:9,after:10});
        }
      }
      if(!others.length && !(result.targetEvidence || []).length && result.rawText) text(`Уривок відповіді: «${result.rawText.slice(0,500)}»`,{size:9});
      y+=12;
    }
  }
  return y;
}
