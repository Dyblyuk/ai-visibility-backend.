import {knowledgeScore,summarizeRecommendations} from '../recommendation-analysis.js';

export const LABELS={chatgpt:'ChatGPT',gemini:'Gemini',perplexity:'Perplexity',claude:'Claude'};
const norm=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('uk').replace(/[^\p{L}\p{N}]/gu,'');
export function cleanQuery(query) {
  return String(query||'').replace(/з\s+гарантією\s+результат(?:ів|у)/gi,'').replace(/гарантован(?:им|ими|ою|і)\s+результат(?:ом|ами|и)/gi,'').replace(/\s+/g,' ').trim().slice(0,240);
}
export function validateQueries(queries,profile) {
  if(!Array.isArray(queries)||queries.length<2||queries.length>3)throw Error('Потрібно 2 або 3 запити');
  const cleaned=queries.map(q=>String(q||'').trim());
  const blocked=[norm(profile.brand),norm(new URL(profile.website).hostname.replace(/^www\./,''))].filter(s=>s.length>=4);
  for(const q of cleaned){if(q.length<12||q.length>240)throw Error('Кожен запит має містити від 12 до 240 символів');if(blocked.some(b=>norm(q).includes(b)))throw Error('Приберіть із запитів назву й домен вашого бренду');}
  if(new Set(cleaned.map(norm)).size!==cleaned.length)throw Error('Запити мають відрізнятися');
  return cleaned;
}
export function suggestedQueries(profile,plan) {
  const geo=profile.city?` Географія: ${profile.city}.`:'';
  const candidates=[...(plan?.queries||[]).map(cleanQuery),`Які компанії надають послугу «${profile.service}»?${geo}`,`Кого обрати для «${profile.service}»?${geo}`];
  const unique=[...new Map(candidates.filter(q=>q.length>=12).map(q=>[norm(q),q])).values()];
  return unique.slice(0,2);
}
function actionsFor(profile,audit,summary) {
  const signals=audit.pages.flatMap(p=>p.signals);const actions=[];
  const gap=id=>signals.find(s=>s.id===id&&s.status==='gap');
  const push=(id,title,signal,task,example,owner)=>{if(signal)actions.push({id,title,kind:'observed_gap',priority:actions.length+1,source:signal.url,evidence:signal.evidence,task,example,owner});};
  push('index','Перевірити обмеження індексування',gap('index'),'Перевірте, чи потрібен noindex на цій сторінці. Для комерційної сторінки, яку потрібно знаходити, узгодьте його зняття з розробником.','Перевірка URL у Search Console після зміни.','SEO-фахівець / розробник');
  push('h1','Чітко назвати послугу на сторінці',gap('h1'),'Перевірте структуру H1 у відрендереній сторінці. Задайте один основний заголовок, який описує її зміст.',`${profile.service}${profile.city?' — '+profile.city:''}`,'Редактор / розробник');
  push('title','Уточнити заголовок для пошуку',gap('title'),'Додайте унікальний title із послугою й назвою компанії.',`${profile.service} | ${profile.brand}`,'SEO-фахівець');
  push('geo','Уточнити географію послуги',gap('geo'),'Додайте на відповідній сторінці точну географію роботи й умови обслуговування. Перевірте текст вручну.',`«${profile.service}${profile.city?' у '+profile.city:''}». Додайте фактичні райони, адреси або умови онлайн-роботи.`,'Маркетолог / редактор');
  push('proof','Додати перевірювані приклади досвіду',gap('proof'),'Покажіть релевантний кейс, досвід команди або відгук із контекстом. Публікуйте тільки реальні дані.','Завдання клієнта → виконані роботи → період → підтверджений результат.','Маркетолог / профільний експерт');
  push('contact','Зробити контакти доступними текстом',gap('contact'),'Перевірте доступність контактів на сторінці. За потреби додайте телефон, email і адресу текстом.','Блок «Контакти»: актуальні способи зв’язку та географія.','Редактор / розробник');
  if(actions.length<3&&summary.competitors.length){const c=summary.competitors[0];actions.push({id:'competitor',title:'Порівняти сторінку з конкурентом',kind:'recommended_check',priority:actions.length+1,source:c.website||'',evidence:`${c.name}: ${c.occurrences.length} згадок у цій вибірці.`,task:`Перегляньте, як ${c.name} пояснює послугу, досвід і критерії вибору. Зіставте з власною сторінкою.`,example:`Візьміть запит «${c.occurrences[0]?.query||profile.service}» та перевірте, чи ваша сторінка дає повну відповідь.`,owner:'Маркетолог / SEO-фахівець'});}
  if(actions.length<3)actions.push({id:'service',title:'Доповнити сторінку відповідями для вибору',kind:'recommended_check',priority:actions.length+1,source:audit.pages[0]?.url||profile.website,evidence:`Пріоритетна послуга, яку ви вказали: ${profile.service}.`,task:'Перевірте, чи сторінка пояснює, кому підходить послуга, як проходить робота, що входить і як дізнатися вартість.',example:`Для «${profile.service}»: кому підходить → склад послуги → обмеження → наступний крок.`,owner:'Редактор / експерт'});
  if(actions.length<3)actions.push({id:'recheck',title:'Зафіксувати результат і повторити перевірку',kind:'recommended_check',priority:actions.length+1,source:'',evidence:`Ця перевірка містить ${summary.queryCount} запити.`,task:'Після впроваджень повторіть ті самі запити з тією самою географією. Порівнюйте цитати й рекомендації, а не лише загальний бал.',example:'Збережіть дату, формулювання запитів і конкретні посилання з відповідей.','owner':'Маркетолог'});
  if(actions.length<3)actions.push({id:'facts',title:'Звірити опис бренду з актуальними даними',kind:'recommended_check',priority:actions.length+1,source:profile.website,evidence:audit.pages.length?'Факти про бренд потрібно звірити з першоджерелом.':'HTML-сторінки не вдалося перевірити; прогалини на сайті не встановлено.',task:'Звірте назву, спеціалізацію, географію й адреси у відповідях AI з актуальним сайтом. Зафіксуйте тільки перевірені розбіжності.',example:'Твердження AI → актуальний факт → сторінка, яка це підтверджує.',owner:'Маркетолог / представник компанії'});
  return actions.slice(0,3);
}
export function buildAuditReport(profile,scan,audit,mode='live') {
  const engines=Object.entries(LABELS).map(([key,label])=>{const r=scan.engines?.[key]||{error:'Відповідь відсутня',verdict:'unavailable'};return {...r,key,label,score:knowledgeScore(r)};});
  const valid=engines.filter(e=>e.score!==null);const summary=summarizeRecommendations(scan.zoneOfInvisibility||[],profile.brand,profile.website);
  const brandName=norm(profile.brand);
  const facts=engines.map(e=>({key:e.key,label:e.label,status:e.error||e.classifierError?'unavailable':'review',brandMentioned:brandName.length>=3&&norm(e.rawText).includes(brandName),geoMentioned:profile.city?norm(e.rawText).includes(norm(profile.city).slice(0,-1)):null,quote:e.snippet||e.rawText?.slice(0,400)||'',reason:e.reason||'',model:e.model,searchMode:e.searchMode,checkedAt:e.checkedAt}));
  const successful=summary.totalSuccessful,total=summary.queryCount*4;
  return {version:'0.1.0',mode,createdAt:new Date().toISOString(),profile,engines,facts,audit,queryPlan:scan.queryPlan,zones:scan.zoneOfInvisibility||[],summary,recognitionScore:valid.length?Math.round(valid.reduce((a,e)=>a+e.score,0)/valid.length):null,coverage:{knowledge:valid.length,knowledgeTotal:4,recommendations:successful,recommendationTotal:total},actions:actionsFor(profile,audit,summary),limitations:['Це експрес-вибірка відповідей API, а не позиції в інтерфейсах ChatGPT чи Google.','Gemini та Google AI Overviews — різні перевірки. AI Overviews тут не вимірюється.','Згадка бренду й посилання на сайт враховуються окремо. Посилання в тексті не завжди є джерелом, використаним AI.','Відсутність маркера на перевірених сторінках не означає, що його немає на всьому сайті.','Спостережені прогалини не доводять причину, з якої AI обрала конкурента.'],executive:successful?`За підтвердженими вами запитами бренд або сайт рекомендовано у ${summary.totalRecommended} із ${successful} доступних відповідей. ${total-successful?`${total-successful} відповідей не оцінено.`:''}`:'Надійних відповідей недостатньо для висновку. Перевірте доступність сервісів і повторіть аналіз.'};
}
