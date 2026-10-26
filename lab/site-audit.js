import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {publicIPv4,extractSiteText} from '../website-context.js';

export function normalizeSite(value) {
  const url=new URL(/^https:\/\//i.test(value)?value:`https://${value}`);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.includes('.'))throw Error('Вкажіть публічний HTTPS-сайт');
  url.hash='';return url.href;
}
export async function fetchPage(value,redirects=0,deadline=Date.now()+16000) {
  const url=new URL(normalizeSite(value));
  const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('Сайт не відповів вчасно');return ms;};
  let addresses;
  try{
    addresses=await Promise.race([lookup(url.hostname,{family:4,all:true}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Час DNS вичерпано')),Math.min(1500,remaining()));t.unref();})]);
  }catch{
    // Managed previews use an egress proxy and have no local DNS. Resolve
    // via DoH, then still pin HTTPS to the checked public IP (including via CONNECT).
    const resolver=await fetch('https://dns.google/resolve?name='+encodeURIComponent(url.hostname)+'&type=A',{signal:AbortSignal.timeout(remaining())});
    if(!resolver.ok)throw Error('Не вдалося перевірити публічну адресу сайту');
    const data=await resolver.json();addresses=(data.Answer||[]).filter(a=>a.type===1).map(a=>({address:a.data,family:4}));
  }
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('Адреса не є публічною');
  const chosen=addresses[0];
  const response=await new Promise((resolve,reject)=>{
    const pinned=new URL(url);pinned.hostname=chosen.address;
    const req=https.get(pinned,{servername:url.hostname,signal:AbortSignal.timeout(remaining()),headers:{Host:url.host,'User-Agent':'TopMarketing-Audit-Lab/0.1','Accept':'text/html'}},res=>{
      let size=0;const chunks=[];
      res.on('data',c=>{size+=c.length;if(size>800000){req.destroy(Error('Сторінка завелика'));return;}chunks.push(c);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location,type:res.headers['content-type']||'',html:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
  });
  if([301,302,303,307,308].includes(response.status)&&response.location&&redirects<3)return fetchPage(new URL(response.location,url).href,redirects+1,deadline);
  if(response.status!==200||!/text\/html/i.test(response.type))throw Error(`Сторінка недоступна: HTTP ${response.status}`);
  return inspectHtml(response.html,url.href);
}
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const clip=(s,max=220)=>s.length>max?s.slice(0,max-1)+'…':s;
const excerpt=(text,re)=>{const m=text.match(re);return m?clip(text.slice(Math.max(0,m.index-65),m.index+m[0].length+120)):null;};
export function inspectHtml(html,url) {
  const text=extractSiteText(html);
  const title=plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const headings=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>plain(m[1])).filter(Boolean);
  const meta=(html.match(/<meta\b[^>]*>/gi)||[]).find(t=>/name\s*=\s*["']description["']/i.test(t));
  const description=plain(meta?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]);
  const robots=(html.match(/<meta\b[^>]*>/gi)||[]).filter(t=>/name\s*=\s*["'](?:robots|googlebot)["']/i.test(t)).join(' ');
  const links=[...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{
    try{const u=new URL(m[1],url);return u.origin===new URL(url).origin&&u.protocol==='https:'?[{url:u.href.split('#')[0],label:plain(m[2])}]:[];}catch{return [];}
  });
  return {url,title,headings,description,noindex:/noindex/i.test(robots),textLength:text.length,text,links};
}
export function signalsFor(page,profile) {
  const {text=''}=page;const city=String(profile.city||'').trim();
  const cityStem=city.length>4?city.slice(0,-1):city;
  const cityAt=/^київ$/i.test(city)?text.search(/ки[їє]в/i):cityStem?text.toLocaleLowerCase('uk').indexOf(cityStem.toLocaleLowerCase('uk')):-1;
  return [
    {id:'index',label:'Індексування',status:page.noindex?'gap':'observed',evidence:page.noindex?'У meta robots знайдено noindex.':'У HTML не знайдено meta noindex. Фактичну індексацію Google не перевірено.'},
    {id:'title',label:'Заголовок сторінки',status:page.title?'observed':'gap',evidence:page.title||'У отриманому HTML не знайдено title.'},
    {id:'h1',label:'Основний заголовок',status:page.headings.length===1?'observed':'gap',evidence:page.headings.length?`H1: ${page.headings.join(' / ')}`:'У отриманому HTML не знайдено H1.'},
    {id:'geo',label:'Географія',status:!city?'not_checked':cityAt>=0?'observed':'gap',evidence:!city?'Географію не задано.':cityAt>=0?clip(text.slice(Math.max(0,cityAt-40),cityAt+170)):`На цій сторінці не знайдено згадки «${city}».`},
    {id:'proof',label:'Досвід і приклади',status:/кейс|портфоліо|досвід|результат|відгук|case stud|testimoni/i.test(text)?'observed':'gap',evidence:excerpt(text,/кейс|портфоліо|досвід|результат|відгук|case stud|testimoni/i)||'У тексті цієї сторінки не знайдено маркерів кейсів, досвіду чи відгуків. Це текстова перевірка, не оцінка достовірності.'},
    {id:'contact',label:'Контактні дані',status:/\+?380[\s(\d)-]{9,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)?'observed':'gap',evidence:excerpt(text,/\+?380[\s(\d)-]{9,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)||'У видимому тексті не знайдено українського телефону чи email. Форми й кнопки можуть бути доступні окремо.'}
  ].map(s=>({...s,url:page.url}));
}
export async function auditSite(profile,{crawl=true}={}) {
  const pages=[],failures=[];
  try{
    const first=await fetchPage(profile.website);pages.push(first);
    if(crawl){
      const candidates=[...new Map(first.links.filter(l=>/послуг|послуг|services?|poslug|uslug|каталог|catalog|лікуван|likuvan|google.ads|meta.ads/i.test(l.label+' '+l.url)).filter(l=>l.url!==first.url).map(l=>[l.url,l])).values()].slice(0,2);
      await Promise.all(candidates.map(async l=>{try{pages.push(await fetchPage(l.url));}catch(e){failures.push({url:l.url,error:e.message});}}));
    }
  }catch(e){failures.push({url:profile.website,error:e.message});}
  return {checkedAt:new Date().toISOString(),pages:pages.map(p=>({url:p.url,title:p.title,headings:p.headings,textLength:p.textLength,signals:signalsFor(p,profile)})),failures,scope:'До 3 HTML-сторінок. Без рендерингу JavaScript, Search Console та перевірки всього сайту.'};
}
