(function(){
 'use strict';
 const config=window.FORECAST_CONFIG,query=new URLSearchParams(location.search);
 const active=query.has('report')||query.get('experience')==='telegram'||(config.telegramGate&&!['legacy','forecast'].includes(query.get('experience')));
 if(!active)return;
 const form=document.getElementById('forecast-form'),api=config.reportsUrl;
 const style=document.createElement('style');style.textContent=`
 .gf-overlay{position:fixed;inset:0;z-index:999999;background:#F0F0E6;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;color:#141414;font-family:'Noto Sans',sans-serif}
 .gf-dialog{width:min(640px,100%);box-sizing:border-box;padding:clamp(22px,5vw,46px);background:#fff;border:1px solid #DED8CE;border-radius:22px;margin-block:auto}
 .gf-dialog h1,.gf-dialog h2{font-family:Unbounded,sans-serif;font-size:clamp(24px,5vw,35px);line-height:1.3;margin:22px 0}
 .gf-kicker{font-size:11px;letter-spacing:.12em;font-weight:800;color:#B34D08}.gf-percent{font:800 44px Unbounded,sans-serif;margin:24px 0 12px}.gf-track{height:9px;background:#F0F0E6;border-radius:10px;overflow:hidden}.gf-track>span{height:100%;display:block;background:#F5781E;width:0;transition:width .25s}
 .gf-dialog p,.gf-dialog li{font-size:15px;line-height:1.65}.gf-dialog small{display:block;color:#66615B;line-height:1.6}.gf-dialog a.gf-action,.gf-dialog button{display:flex;width:100%;box-sizing:border-box;justify-content:center;text-align:center;padding:16px 20px;margin:18px 0 10px;border:0;border-radius:30px;background:#F5781E;color:#141414;font:750 15px 'Noto Sans',sans-serif;text-decoration:none;cursor:pointer}.gf-dialog button.gf-back{background:#F0F0E6}.gf-error{padding:13px 16px;background:#FFF4EB;border-left:4px solid #F5781E;border-radius:6px}
 @media(prefers-reduced-motion:reduce){.gf-track>span{transition:none}}`;
 document.head.append(style);
 const referrer=document.createElement('meta');referrer.name='referrer';referrer.content='no-referrer';document.head.append(referrer);
 function element(tag,value,parent,cls=''){const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;parent.append(node);return node;}
 let opener=null;
 function overlay(){
  document.getElementById('telegram-flow-screen')?.gfClose();opener=document.activeElement;
  const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const screen=element('div','',document.body,'gf-overlay');screen.id='telegram-flow-screen';screen.setAttribute('role','dialog');screen.setAttribute('aria-modal','true');screen.setAttribute('aria-labelledby','gf-title');
  screen.gfClose=()=>{document.body.style.overflow=previousOverflow;screen.remove();};
  const card=element('div','',screen,'gf-dialog');card.tabIndex=-1;
  screen.addEventListener('keydown',event=>{if(event.key==='Tab'){const focusable=[...card.querySelectorAll('a[href],button:not([disabled])')];if(!focusable.length){event.preventDefault();card.focus();return;}if(event.shiftKey&&(document.activeElement===focusable[0]||document.activeElement===card)){event.preventDefault();focusable.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0].focus();}}});
  card.focus();return {screen,card};
 }
 function back(card,screen){const button=element('button','Повернутися до форми',card,'gf-back');button.type='button';button.addEventListener('click',()=>{screen.gfClose();opener?.focus();});return button;}
 function progress(){
  const {screen,card}=overlay();element('div','TOP MARKETING / AI GROWTH FORECAST',card,'gf-kicker');const heading=element('h2','Готуємо ваш аналіз',card);heading.id='gf-title';
  const value=element('div','0%',card,'gf-percent');value.id='gf-percent';value.setAttribute('aria-hidden','true');
  const track=element('div','',card,'gf-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label','Підготовка аналізу');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');const fill=element('span','',track);
  const stage=element('p','Перевіряємо введені дані…',card);stage.id='gf-stage';stage.setAttribute('role','status');
  element('small','Відсоток показує завершені етапи підготовки. Поки сайт відповідає, значення може залишатися незмінним.',card);
  return {screen,card,update(percent,message){value.textContent=percent+'%';fill.style.width=percent+'%';track.setAttribute('aria-valuenow',String(percent));stage.textContent=message;}};
 }
 function ready(data,screen,card){
  card.replaceChildren();element('div','TOP MARKETING / АНАЛІЗ ГОТОВИЙ',card,'gf-kicker');const heading=element('h2','Ваш аналіз готовий',card);heading.id='gf-title';
  element('p',data.preview.clinic+' · '+data.preview.region,card);
  element('p','Підготували прогноз результатів і стратегію просування для вашого сайту.',card);
  const list=element('ul','',card);for(const line of ['Прогноз можливих звернень і сценарії рекламного бюджету','Пріоритетні напрями та стратегія Google Ads і Meta','Повний PDF-звіт із прикладами'])element('li',line,list);
  element('p','Знайдені напрями: '+data.preview.services.join(', '),card);
  if(data.preview.warning)element('p',data.preview.warning,card,'gf-error');
  else if(data.preview.partial)element('p','Частину сторінок не вдалося прочитати. У звіті враховано доступні матеріали.',card,'gf-error');
  element('p','Перейдіть у Telegram, натисніть Start і поділіться контактом у боті, щоб отримати ваш звіт. Потім за бажанням уточніть бюджет і пріоритетні послуги — зі списку або введіть свої.',card);
  const link=element('a','Отримати звіт у Telegram →',card,'gf-action');link.id='gf-telegram-link';link.href=data.telegramUrl;link.rel='noopener noreferrer';
  element('small','Контакт передається в боті Top Marketing для видачі звіту та зв’язку щодо вашого запиту.',card);back(card,screen);link.focus();
 }
 form.querySelector('h2').textContent='Отримайте персональний аналіз';form.querySelector('p').textContent='Вкажіть сайт, сферу та регіон. Підготуємо прогноз і стратегію, які ви отримаєте в Telegram.';
 form.querySelector('.action').textContent='Аналізувати сайт ↗';
 form.querySelector('.mode-note').textContent='Сайт → підготовка аналізу → Telegram → контакт → персональний звіт.';
 document.getElementById('form-msg').textContent='Зараз доступна сфера «Медицина». Готовий звіт видається в Telegram після передачі контакту.';
 form.querySelector('.privacy').textContent='Після аналізу перейдіть у бот, натисніть Start і поділіться контактом для отримання звіту.';
 document.querySelector('.copy .lede').textContent='Підготуємо прогноз результатів і план реклами для вашої клініки. Отримайте звіт у Telegram та за бажанням уточніть його.';
 const top=document.querySelector('.topcta');if(top)top.textContent='Аналізувати сайт →';
 const step=document.querySelectorAll('.speed-step>span:last-child')[2];if(step)step.textContent='Отримайте звіт у Telegram';
 const cta=document.querySelector('.cta-block p');if(cta)cta.textContent='Оберіть сферу, вкажіть сайт і регіон. Після підготовки перейдіть у Telegram, щоб отримати звіт.';
 const steps=document.querySelectorAll('.how-item');
 const how=[['Введіть сайт','Оберіть сферу, вкажіть сайт і регіон просування.'],['Дочекайтеся аналізу','Визначаємо напрями, розраховуємо прогноз і готуємо стратегію.'],['Отримайте звіт у Telegram','Натисніть Start і поділіться контактом у боті. Отримайте звіт і PDF; за бажанням уточніть прогноз.']];
 steps.forEach((item,index)=>{if(how[index]){item.querySelector('h3').textContent=how[index][0];item.querySelector('p').textContent=how[index][1];}});
 for(const item of document.querySelectorAll('.faq-items details')){
  const title=item.querySelector('summary')?.textContent||'',body=item.querySelector('p');
  if(title.includes('точніший прогноз'))body.textContent='Отримайте звіт у Telegram після передачі контакту. Далі бот запропонує уточнити бюджет, напрями та відому частку записів і перерахувати результат.';
  if(title.includes('менеджер'))body.textContent='У Telegram-боті попросимо контакт для видачі звіту. Після отримання результату ви можете замовити детальну пропозицію та обговорити її з командою Top Marketing.';
  if(title.includes('швидко'))body.textContent='Після введення даних з’явиться екран підготовки. Коли аналіз буде готовий, перейдіть у Telegram, натисніть Start і поділіться контактом для отримання звіту.';
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();event.stopImmediatePropagation();if(!form.reportValidity())return;
  const button=form.querySelector('.action');if(button.disabled)return;button.disabled=true;const view=progress();
  try{
   const args={website:document.getElementById('site').value.trim(),industry:document.getElementById('industry').value,region:document.getElementById('city').value.trim()};
   const url=new URL(/^https?:\/\//i.test(args.website)?args.website:'https://'+args.website);if(!['https:','http:'].includes(url.protocol)||!url.hostname.includes('.')||url.username||url.password||args.website.length>300)throw Error('Введіть коректну адресу сайту');
   const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify(args),signal:AbortSignal.timeout(90000)});
   let data;
   if((response.headers.get('content-type')||'').includes('application/x-ndjson')){
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',lastPercent=0;
    const receive=line=>{if(!line.trim())return;const packet=JSON.parse(line);if(packet.type==='error')throw Error(packet.error||'Не вдалося підготувати аналіз');if(packet.type==='ready')data=packet.data;else if(packet.type==='progress'&&Number.isInteger(packet.percent)&&packet.percent>=lastPercent&&packet.percent<=100){lastPercent=packet.percent;view.update(packet.percent,String(packet.message||''));}};
    try{for(;;){const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});if(buffer.length>65536)throw Error('Некоректна відповідь сервісу');const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(receive);if(part.done){receive(buffer);break;}}}finally{reader.releaseLock();}
   }else data=await response.json();
   if(!response.ok)throw Error(data?.error||'Не вдалося підготувати аналіз');
   if(!data)throw Error('Підготовка перервалася. Повторіть спробу');
   if(data.status!=='ready'||!data.preview||!Array.isArray(data.preview.services))throw Error('Не вдалося отримати результат підготовки');
   const link=new URL(data.telegramUrl);if(link.protocol!=='https:'||link.hostname!=='tg.pulse.is'||link.username||link.password||link.port||!link.searchParams.get('gf_report_token'))throw Error('Не вдалося підготувати перехід у Telegram');
   view.update(100,'Аналіз готовий');ready(data,view.screen,view.card);
  }catch(error){view.card.replaceChildren();const title=element('h2','Не вдалося завершити підготовку',view.card);title.id='gf-title';element('p',error.name==='TimeoutError'?'Сервіс відповідає довше, ніж очікувалося. Повторіть спробу.':error.message,view.card,'gf-error');back(view.card,view.screen).focus();}
  finally{button.disabled=false;}
 },true);
 if(query.has('report'))(async()=>{
  const view=progress();view.update(25,'Відкриваємо ваш звіт…');
  try{
   const token=query.get('report');if(!/^[a-f0-9]{48}$/.test(token))throw Error('Некоректне посилання на звіт');
   const response=await fetch(api+'/'+token,{cache:'no-store',signal:AbortSignal.timeout(90000)}),data=await response.json();if(!response.ok)throw Error(data.error||'Не вдалося відкрити звіт');
   view.update(100,'Звіт завантажено');
   window.openForecastReport({clinic:data.form.clinic,site:data.form.site,city:data.form.city,specialty:data.form.specialty,service:data.form.service,monthlyBudget:data.form.monthlyBudget,avgTicket:data.form.avgTicket,saleRate:data.form.saleRate,analysisMethod:data.meta.method,analysisConfidence:data.meta.confidence,analysisWarning:data.meta.warning,delivery:{telegramUrl:data.telegramUrl,pdfUrl:data.pdfUrl,version:data.version},policy:data.meta.benchmarkPolicy,model:data.form});
  }catch(error){view.card.replaceChildren();const title=element('h2','Не вдалося відкрити звіт',view.card);title.id='gf-title';element('p',error.message,view.card,'gf-error');const link=element('a','Повернутися до калькулятора',view.card,'gf-action');link.href=location.pathname;link.focus();}
 })();
})();
