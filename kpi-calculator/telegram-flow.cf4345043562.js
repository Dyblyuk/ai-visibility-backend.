(function(){
 'use strict';
 const config=window.FORECAST_CONFIG,query=new URLSearchParams(location.search);
 const active=query.has('report')||query.get('experience')==='telegram'||(config.telegramGate&&!['legacy','forecast'].includes(query.get('experience')));
 if(!active){for(const option of document.querySelectorAll('#industry option'))if(option.value&&option.value!=='Медицина'&&!option.disabled){option.disabled=true;option.textContent+=' — у Telegram-сценарії';}return;}
 const form=document.getElementById('forecast-form'),api=config.reportsUrl;
 const landedAt = Date.now();
 const clickStorage = 'tm_forecast_meta_click';
 function metaAttribution() {
  const consent = window.tmAdsConsent || {};
  const clearClick = () => { try { sessionStorage.removeItem(clickStorage); } catch {} };
  if (navigator.globalPrivacyControl || consent.adStorage === 'denied' || consent.adUserData === 'denied') {
   clearClick(); return null;
  }
  const readCookie = name => {
   try { return decodeURIComponent(document.cookie.split(/;\s*/).find(item => item.startsWith(name+'='))?.slice(name.length+1) || ''); }
   catch { return ''; }
  };
  const click = query.get('fbclid');
  const cookieFbc = readCookie('_fbc');
  const source = (query.get('utm_source') || '').toLowerCase();
  const otherCampaign = ['gclid','gbraid','wbraid','ttclid'].some(key => query.has(key))
   || (source && !['fb','ig','facebook','instagram','meta'].includes(source));
  const attribution = { consent: consent.adUserData === 'granted' ? {adUserData:'granted'} : {} };
  if (click && /^[A-Za-z0-9._~-]{1,460}$/.test(click)) {
   attribution.fbc = cookieFbc.split('.').slice(3).join('.') === click ? cookieFbc : 'fb.1.'+landedAt+'.'+click;
   if (consent.adStorage==='granted') {
    try { sessionStorage.setItem(clickStorage,attribution.fbc); } catch {}
   }
  } else if (otherCampaign) clearClick();
  else if (cookieFbc) attribution.fbc = cookieFbc;
  else if (consent.adStorage==='granted') {
   try {
    const cached=sessionStorage.getItem(clickStorage);
    if(cached && Date.now()-Number(cached.split('.')[2])<30*86400000) attribution.fbc=cached;
   } catch {}
  }
  const fbp = readCookie('_fbp');
  if (fbp) attribution.fbp = fbp;
  return attribution;
 }
 if (!query.has('report')) metaAttribution();
 const artBase = new URL('./assets/landing/', document.currentScript.src);
 const benefitIcons = [
  "<svg aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 24 24\"><path d=\"M4 3.8h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-8l-6 4v-4H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 3.8Z\"/><path d=\"M7 10h.1m4.9 0h.1m4.9 0h.1\" stroke-width=\"2.8\"/></svg>",
  "<svg aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 24 24\"><ellipse cx=\"14.5\" cy=\"6\" rx=\"6.7\" ry=\"2.8\"/><path d=\"M7.8 6v4.4c0 1.55 3 2.8 6.7 2.8s6.7-1.25 6.7-2.8V6m0 4.4v4.4c0 1.6-3 2.8-6.7 2.8\"/><ellipse cx=\"7.2\" cy=\"15.5\" rx=\"5\" ry=\"2.4\"/><path d=\"M2.2 15.5v3.3c0 1.4 2.3 2.4 5 2.4s5-1 5-2.4v-3.3\"/></svg>",
  "<svg aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M7.5 2.8v4.4m9-4.4v4.4M3 10h18m-13 5 2.5 2.5 5-5\"/></svg>"
];
 const arrowIcon = "<svg aria-hidden=\"true\" width=\"18\" height=\"18\" viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 16 16 4M5 4h11v11\"/></svg>";
 const style=document.createElement('style');style.textContent=`
 .gf-overlay{position:fixed;inset:0;z-index:999999;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;align-items:center;padding:clamp(10px,3vw,26px);background:#f0f0e6;color:#141414;font:400 16px/1.45 "Noto Sans",sans-serif}
 .gf-overlay,.gf-overlay *{box-sizing:border-box}
 .gf-dialog{flex:none;width:min(578px,100%);margin:auto;padding:clamp(16px,3vw,30px);border:1px solid #deded3;border-radius:21px;background:#fffdf9;box-shadow:0 8px 25px #2326160c;overflow-wrap:anywhere}
 .gf-dialog:focus{outline:0}.gf-dialog h2{margin:0;font:700 clamp(25px,4.55vw,36px)/1.15 Unbounded,sans-serif;letter-spacing:-.062em;text-wrap:balance}
 .gf-art{width:calc(100% + 36px);max-width:none;height:clamp(130px,19vh,189px);object-fit:cover;object-position:center 54%;margin:-18px -18px 17px;border-radius:11px;background:#f5781e}
 .gf-intro{margin:7px 0 17px;color:#54564e;font-size:15px}
 .gf-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:14px 0 9px}.gf-estimate{text-align:right;flex:none}.gf-label{display:block;color:#54564e;font-size:12px}.gf-estimate .gf-label{font-size:11px}
 #gf-stage{font-weight:700;font-size:17px}.gf-percent{font:650 35px/1.1 Unbounded,sans-serif;letter-spacing:-.07em;font-variant-numeric:tabular-nums}
 .gf-track{height:10px;border-radius:8px;background:#20201e;overflow:hidden}.gf-track>span{display:block;height:100%;width:5%;border-radius:inherit;background:#f5781e;transition:width .38s;position:relative;overflow:hidden}
 .gf-track>span:after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 10%,#ffb76bb0 50%,transparent 78%);animation:gf-shine 1.9s infinite linear}@keyframes gf-shine{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
 .gf-note{display:flex;align-items:baseline;gap:7px;margin:9px 0 12px;min-height:2.7em;color:#54564e;font-size:12px}.gf-note:before{content:'';flex:none;width:7px;height:7px;border-radius:50%;background:#bd530a;animation:gf-pulse 1.7s infinite ease-in-out}@keyframes gf-pulse{50%{opacity:.35}}.gf-note time{margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}
 .gf-steps,.gf-benefits{list-style:none;margin:0;padding:0}.gf-steps li,.gf-benefits li{display:flex;gap:12px;align-items:center;padding:9px 0;border-top:1px solid #deded3;font-size:15px}
 .gf-steps li{color:#54564e}.gf-steps li:before{content:'';width:16px;height:16px;border:1.5px solid #96998c;border-radius:50%;flex:none;box-sizing:border-box}.gf-steps .gf-done{color:#141414}.gf-steps .gf-done:before{content:'✓';background:#f5781e;color:#141414;border:none;font:700 12px/16px "Noto Sans",sans-serif;text-align:center}.gf-steps [aria-current]{font-weight:700;color:#141414}.gf-steps [aria-current]:before{border:2px solid #f5781e}
 .gf-benefits li{font-weight:700}.gf-benefits svg{width:24px;height:24px;flex:none}.gf-found{font-size:13px;color:#54564e;margin:8px 0 14px}.gf-error{font-size:14px;background:#fff4eb;border-left:3px solid #f5781e;border-radius:5px;padding:10px 12px;margin:12px 0}
 .gf-action,.gf-back{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;padding:10px;border:0;border-radius:9px;text-decoration:none;font:700 16px "Noto Sans",sans-serif;text-align:center;cursor:pointer}.gf-action{margin:14px 0 0;background:#f5781e;color:#141414}.gf-action:hover{background:#ff852a}.gf-action svg{width:18px;height:18px}.gf-back{margin:8px 0 0;background:transparent;color:#54564e;font-size:13px;text-decoration:underline}.gf-how{margin:9px auto 0;max-width:52ch;text-align:center;font-size:13px;color:#54564e}.gf-dialog :is(button,a):focus-visible{outline:3px solid #914100;outline-offset:3px}
 @media(max-width:600px){.gf-dialog{padding:18px 17px 10px;border-radius:17px}.gf-art{width:calc(100% + 16px);height:clamp(125px,36vw,165px);margin:-9px -8px 14px}.gf-intro{margin-bottom:12px}.gf-note{margin-bottom:7px}}
 @media(prefers-reduced-motion:reduce){.gf-track>span,.gf-note:before,.gf-track>span:after{animation:none;transition:none}}
`;
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
 function cardTitle(card, title, image) {
  card.replaceChildren();
  if (image) {
   const art = element('img', '', card, 'gf-art');
   art.alt = '';
   art.src = new URL(image, artBase).href;
  }
  const heading = element('h2', title, card);
  heading.id = 'gf-title';
  return heading;
 }
 function progress() {
  const {screen, card} = overlay();
  cardTitle(card, 'Готуємо ваш аналіз', 'analysis-progress.webp');
  const intro = element('p', 'Зазвичай це займає до хвилини. Залиште сторінку відкритою.', card, 'gf-intro');
  const head = element('div', '', card, 'gf-head');
  const active = element('div', '', head);
  element('span', 'Поточний етап', active, 'gf-label');
  const stage = element('div', '', active);
  stage.id = 'gf-stage';
  stage.setAttribute('role', 'status');
  const estimate = element('div', '', head, 'gf-estimate');
  estimate.setAttribute('aria-hidden','true');
  element('span', 'Орієнтовно', estimate, 'gf-label');
  const value = element('div', '', estimate, 'gf-percent');
  value.id = 'gf-percent';
  const track = element('div', '', card, 'gf-track');
  track.setAttribute('role','progressbar');
  track.setAttribute('aria-label','Підготовка аналізу');
  track.setAttribute('aria-valuemin','0');
  track.setAttribute('aria-valuemax','100');
  const fill = element('span', '', track);
  const note = element('div', '', card, 'gf-note');
  const detail = element('span', '', note);
  const clock = element('time', '', note);
  clock.setAttribute('aria-hidden','true');
  const list = element('ol', '', card, 'gf-steps');
  list.setAttribute('aria-label','Етапи аналізу');
  const steps = ['Перевірка даних','Аналіз сайту','Розрахунок прогнозу','Підготовка PDF'].map(label => element('li', label, list));
  const start = performance.now();
  let milestone = 5, updated = start, shown = 0;
  function tick() {
   const now = performance.now();
   const seconds = Math.floor((now - start) / 1000);
   clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
   // Only interpolate within a confirmed stage. The server advances the checklist.
   const waiting = now - updated;
   let percent = milestone;
   if (milestone === 5) percent += Math.min(4, Math.floor(waiting / 1900));
   if (milestone === 10) percent += Math.min(24, Math.floor(waiting / 1700));
   if (percent !== shown) {
    shown = percent;
    value.textContent = percent + '%';
    fill.style.width = percent + '%';
    track.setAttribute('aria-valuenow', String(percent));
    track.setAttribute('aria-valuetext', 'Орієнтовно ' + percent + '%. ' + stage.textContent);
   }
   if (milestone === 5 && seconds >= 7) detail.textContent = 'Запит уже надіслано. Очікуємо відповіді сервісу.';
   if (seconds >= 60) intro.textContent = 'Цього разу підготовка триває довше ніж хвилину. Залиште сторінку відкритою.';
  }
  function update(percent, message) {
   milestone = percent;
   updated = performance.now();
   const step = percent < 40 ? 1 : percent < 50 ? 2 : percent < 100 ? 3 : 4;
   const label = percent < 10 ? 'З’єднуємося із сервісом' : percent < 40 ? 'Читаємо сайт' : percent < 50 ? 'Розраховуємо прогноз' : percent < 95 ? 'Формуємо PDF' : percent < 100 ? 'Зберігаємо звіт' : 'Звіт готовий';
   if (stage.textContent !== label) stage.textContent = label;
   detail.textContent = message;
   steps.forEach((item, index) => {
    item.classList.toggle('gf-done', index < step);
    if (index === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.setAttribute('aria-label', item.textContent + ' — ' + (index < step ? 'завершено' : index === step ? 'триває' : 'попереду'));
   });
   tick();
  }
  update(5, 'Дані форми перевірено. Надсилаємо сайт, сферу та регіон.');
  const timer = setInterval(tick, 250);
  return {screen, card, update, stop: () => clearInterval(timer)};
 }
 function ready(data, screen, card) {
  const preview = data.preview;
  const siteRead = preview.analysisAvailable !== false;
  cardTitle(card, siteRead ? 'Ваш аналіз готовий' : 'Загальний прогноз готовий', 'analysis-ready.webp');
  element('p', [preview.clinic, preview.region].filter(Boolean).join(' · '), card, 'gf-intro');
  const ecommerce = preview.industry === 'E-commerce';
  const list = element('ul', '', card, 'gf-benefits');
  const benefits = [ecommerce ? 'Прогноз обороту, ROAS' : 'Прогноз звернень', 'Сценарії рекламного бюджету', 'План дій на 90 днів'];
  benefits.forEach((label, index) => {
   const item = element('li', '', list);
   item.innerHTML = benefitIcons[index]; // Static brand artwork only.
   element('span', label, item);
  });
  const found = preview.foundServices ?? (siteRead ? preview.services : []);
  if (found.length) {
   const text = element('p', '', card, 'gf-found');
   element('strong', ecommerce ? 'Категорії товарів. ' : 'Знайдені напрями. ', text);
   text.append(found.join(', '));
  }
  const diagnosis = preview.siteDiagnostic;
  if (diagnosis) element('p', diagnosis.message+' '+diagnosis.hint+' Код: '+diagnosis.code+(diagnosis.httpStatus?' · HTTP '+diagnosis.httpStatus:'')+'.', card, 'gf-error');
  else if (preview.warning) element('p', preview.warning, card, 'gf-error');
  else if (preview.partial) element('p', 'Частину сторінок не вдалося прочитати. У звіті враховано доступні матеріали.', card, 'gf-error');
  const link = element('a', 'Отримати звіт у Telegram', card, 'gf-action');
  link.insertAdjacentHTML('beforeend', arrowIcon);
  link.id = 'gf-telegram-link';
  link.href = data.telegramUrl;
  link.rel = 'noopener noreferrer';
  element('p', 'У боті натисніть Start і поділіться контактом, щоб отримати PDF.', card, 'gf-how');
  element('p', 'Команда Top Marketing використовує контакт для видачі звіту та зв’язку щодо вашого запиту.', card, 'gf-how');
  back(card, screen);
  screen.scrollTop = 0;
  link.focus({preventScroll:true});
 }
 const designedLanding = form.hasAttribute('data-telegram-landing');
 let margin, route, marginField, routeField, hint;
 if (designedLanding) {
  margin = document.getElementById('initial-margin');
  route = document.getElementById('acquisition-mode');
  marginField = margin.closest('.field');
  routeField = route.closest('.field');
  hint = document.getElementById('hint');
 } else {
   form.querySelector('h2').textContent='Отримайте персональний аналіз';form.querySelector('p').textContent='Вкажіть сайт, сферу та регіон. Підготуємо прогноз і стратегію, які ви отримаєте в Telegram.';
   form.querySelector('.action').textContent='Аналізувати сайт ↗';
   form.querySelector('.mode-note').textContent='Сайт → підготовка аналізу → Telegram → контакт → персональний звіт.';
   document.getElementById('form-msg').textContent='Готовий звіт видається в Telegram після передачі контакту. Бюджет і середній чек можна додати до аналізу.';
   form.querySelector('.privacy').textContent='Після аналізу перейдіть у бот, натисніть Start і поділіться контактом для отримання звіту.';
   document.querySelector('.copy .lede').textContent='Підготуємо прогноз результатів і план реклами для вашого бізнесу. Додайте відомі показники на сайті та отримайте звіт у Telegram.';
   const optional=element('details','',form.querySelector('.fields'),'gf-inputs');element('summary','Додати дані для розрахунку · необов’язково',optional);
   const optionalFields=element('div','',optional,'fields');
   for(const id of ['budget','aov']){const field=document.getElementById(id).closest('.field');field.classList.remove('detail');optionalFields.append(field);}
   document.getElementById('aov').min='0.01';document.getElementById('aov').step='0.01';
   marginField=element('div','',optionalFields,'field');const marginLabel=element('label','Маржинальність, % · за бажанням',marginField);marginLabel.htmlFor='initial-margin';
   margin=element('input','',marginField);margin.id='initial-margin';margin.type='number';margin.min='0';margin.max='100';margin.step='0.1';margin.placeholder='Без маржі прибуток не прогнозується';
   routeField=element('div','',optionalFields,'field');const routeLabel=element('label','Спосіб залучення',routeField);routeLabel.htmlFor='acquisition-mode';route=element('select','',routeField);route.id='acquisition-mode';
   hint=element('small','Без цих даних використаємо позначений приклад бюджету. Середній чек без частки покупок не дає прогнозу доходу.',optional);
   style.textContent+=' .gf-inputs{border-top:1px solid #DED8CE;padding-top:14px;min-width:0}.gf-inputs summary{font-size:12px;font-weight:700;cursor:pointer;line-height:1.6}.gf-inputs>.fields{margin-top:14px}.gf-inputs small{font-size:11px;color:#66615B;line-height:1.5;display:block;margin-top:12px}.gf-inputs [hidden]{display:none!important}';
 }
 const industryField=document.getElementById('industry');const updateIndustry=()=>{
  const industry=industryField.value;document.getElementById('site').placeholder=industry==='E-commerce'?'Сайт вашого інтернет-магазину':'Сайт вашого бізнесу';
  const routes=config.acquisitionOptions?.[industry];
  marginField.hidden=industry!=='E-commerce';margin.disabled=marginField.hidden;routeField.hidden=!(routes?.options?.length>1);route.disabled=routeField.hidden;route.replaceChildren();
  for(const {value,label} of routes?.options||[]){const option=element('option',label,route);option.value=value;}if(routes)route.value=routes.defaultRoute;
  hint.textContent='Без даних використаємо позначений приклад бюджету. '+(industry==='Освіта'?'Основний сценарій — контакти через лід-магніт. Прямі заявки можна обрати вище.':industry==='Нерухомість'?'Основний сценарій — Google Ads. Meta можна обрати вище.':'Середній чек без частки покупок не дає прогнозу доходу.');
 };industryField.addEventListener('change',updateIndustry);updateIndustry();
 const top=document.querySelector('.topcta');if(top)top.textContent='Аналізувати сайт →';
 const step=document.querySelectorAll('.speed-step>span:last-child')[2];if(step)step.textContent='Отримайте звіт у Telegram';
 const cta=document.querySelector('.cta-block p');if(cta)cta.textContent='Оберіть сферу, вкажіть сайт і регіон. Після підготовки перейдіть у Telegram, щоб отримати звіт.';
 const budgetBenefit=document.querySelectorAll('.benefit')[1]?.querySelector('p');if(budgetBenefit)budgetBenefit.textContent='Порівняйте сценарії бюджету для обраної сфери. Свій бюджет можна вказати у початковій формі до аналізу.';
 const steps=document.querySelectorAll('.how-item');
 const how=[['Введіть сайт','Оберіть сферу, сайт і регіон. За бажанням додайте бюджет та відомі показники.'],['Дочекайтеся аналізу','Визначаємо напрями, розраховуємо прогноз і готуємо стратегію.'],['Отримайте звіт у Telegram','Натисніть Start і поділіться контактом у боті. Отримайте звіт і PDF.']];
 steps.forEach((item,index)=>{if(how[index]){item.querySelector('h3').textContent=how[index][0];item.querySelector('p').textContent=how[index][1];}});
 for(const item of document.querySelectorAll('.faq-items details')){
  const title=item.querySelector('summary')?.textContent||'',body=item.querySelector('p');
  if(title.includes('Звідки'))body.textContent='Використовуємо погоджені експертні орієнтири Top Marketing для обраної сфери. Історичні дані, де вони є, показуємо окремо. На сайті визначаємо теми рекомендацій; рекламні кабінети й CRM не перевіряємо. Джерела та припущення наведені у звіті.';
  if(title.includes('продажі та дохід'))body.textContent='Для інтернет-магазинів оцінюємо можливий оборот за експертним ROAS, а за відомого середнього чека — модельну кількість замовлень. В інших сферах прогнозуємо контакти або заявки. Середнього чека без конверсій воронки недостатньо для розрахунку продажів і доходу.';
  if(title.includes('гарантуєте'))body.textContent='Ні. Це експертний сценарій для планування. Вартість і якість звернень та фактичний результат потрібно перевіряти після запуску реклами.';
  if(title.includes('точніший прогноз'))body.textContent='Перед аналізом відкрийте «Додати дані для розрахунку» та вкажіть бюджет і відомі показники. Без них використаємо позначені базові припущення.';
  if(title.includes('менеджер'))body.textContent='У Telegram-боті попросимо контакт для видачі звіту. Після отримання результату ви можете замовити детальну пропозицію та обговорити її з командою Top Marketing.';
  if(title.includes('швидко'))body.textContent='Після введення даних з’явиться екран підготовки. Коли аналіз буде готовий, перейдіть у Telegram, натисніть Start і поділіться контактом для отримання звіту.';
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();event.stopImmediatePropagation();if(!form.reportValidity())return;
  const button=form.querySelector('.action');if(button.disabled)return;button.disabled=true;const view=progress();
  try{
   const value=id=>{const input=document.getElementById(id);return input.disabled||input.value===''?null:Number(input.value);};
   const args={inputVersion:2,website:document.getElementById('site').value.trim(),industry:document.getElementById('industry').value,region:document.getElementById('city').value.trim(),budget:value('budget'),avgTicket:value('aov'),...(industryField.value==='E-commerce'?{margin:value('initial-margin')}:{}),...(!route.disabled?{acquisitionMode:route.value}:{})};
   const url=new URL(/^https?:\/\//i.test(args.website)?args.website:'https://'+args.website);if(!['https:','http:'].includes(url.protocol)||!url.hostname.includes('.')||url.username||url.password||args.website.length>300)throw Error('Введіть коректну адресу сайту');
   args.metaAttribution=metaAttribution();
   const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify(args),signal:AbortSignal.timeout(90000)});
   let data;
   if((response.headers.get('content-type')||'').includes('application/x-ndjson')){
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',lastPercent=0;
    const receive=line=>{if(!line.trim())return;const packet=JSON.parse(line);if(packet.type==='error')throw Error(packet.error||'Не вдалося підготувати аналіз');if(packet.type==='ready')data=packet.data;else if(packet.type==='progress'&&Number.isInteger(packet.percent)&&packet.percent>=lastPercent&&packet.percent<100){lastPercent=packet.percent;view.update(packet.percent,String(packet.message||''));}};
    try{for(;;){const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});if(buffer.length>65536)throw Error('Некоректна відповідь сервісу');const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(receive);if(part.done){receive(buffer);break;}}}finally{reader.releaseLock();}
   }else data=await response.json();
   if(!response.ok)throw Error(data?.error||'Не вдалося підготувати аналіз');
   if(!data)throw Error('Підготовка перервалася. Повторіть спробу');
   if(data.status!=='ready'||!data.preview||!Array.isArray(data.preview.services))throw Error('Не вдалося отримати результат підготовки');
   const link=new URL(data.telegramUrl);if(link.protocol!=='https:'||link.hostname!=='tg.pulse.is'||link.username||link.password||link.port||!link.searchParams.get('gf_report_token'))throw Error('Не вдалося підготувати перехід у Telegram');
   view.update(100,'Аналіз готовий');ready(data,view.screen,view.card);
  }catch(error){view.card.replaceChildren();const title=element('h2','Не вдалося завершити підготовку',view.card);title.id='gf-title';element('p',error.name==='TimeoutError'?'Сервіс відповідає довше, ніж очікувалося. Повторіть спробу.':error.message,view.card,'gf-error');back(view.card,view.screen).focus();}
  finally{view.stop();button.disabled=false;}
 },true);
 if (designedLanding) form.querySelector('.action').disabled = false;
 if(query.has('report'))(async()=>{
  const view=overlay();cardTitle(view.card, 'Відкриваємо ваш звіт…', 'analysis-ready.webp');
  try{
   const token=query.get('report');if(!/^[a-f0-9]{48}$/.test(token))throw Error('Некоректне посилання на звіт');
   const response=await fetch(api+'/'+token,{cache:'no-store',signal:AbortSignal.timeout(90000)}),data=await response.json();if(!response.ok)throw Error(data.error||'Не вдалося відкрити звіт');
   window.openForecastReport({clinic:data.form.clinic,site:data.form.site,city:data.form.city,specialty:data.form.specialty,service:data.form.service,monthlyBudget:data.form.monthlyBudget,avgTicket:data.form.avgTicket,saleRate:data.form.saleRate,analysisMethod:data.meta.method,analysisConfidence:data.meta.confidence,analysisWarning:data.meta.warning,delivery:{refinementEnabled:data.refinementEnabled,telegramUrl:data.telegramUrl,pdfUrl:data.pdfUrl,version:data.version},policy:data.meta.benchmarkPolicy,model:data.form});
  }catch(error){view.card.replaceChildren();const title=element('h2','Не вдалося відкрити звіт',view.card);title.id='gf-title';element('p',error.message,view.card,'gf-error');const link=element('a','Повернутися до калькулятора',view.card,'gf-action');link.href=location.pathname;link.focus();}
 })();
})();
