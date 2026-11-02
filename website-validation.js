import {isIP} from 'node:net';
import {fetchSiteContext} from './website-context.js';

const platforms = ['instagram.com','facebook.com','fb.com','t.me','telegram.me','tiktok.com','youtube.com','youtu.be','linkedin.com','app.weblium.com','lovable.dev'];
export function normalizeBusinessWebsite(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /\s/.test(value.trim())) throw Error('Вкажіть адресу сайту, наприклад topmarketing.com.ua.');
  let url;
  try { url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); }
  catch { throw Error('Вкажіть коректну адресу сайту, наприклад example.com.ua.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port)) || isIP(host) || labels.length < 2 || host.length > 253 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(labels.at(-1)) || /\.(?:test|invalid|localhost|local|example|onion)$/i.test(host)) throw Error('Потрібен публічний домен сайту бізнесу, наприклад example.com.ua.');
  if (platforms.some(domain => host === domain || host.endsWith(`.${domain}`))) throw Error('Вкажіть сайт бізнесу, а не соцмережу, месенджер чи редактор сайту.');
  // Check only the public HTTPS homepage, never user-supplied paths or credentials.
  return {website:`https://${host}`, brand:host.replace(/^www\./,'')};
}

export function createWebsiteValidator({fetchContext=fetchSiteContext,now=Date.now,ttl=600000,maxSize=500}={}) {
  const cache=new Map(), pending=new Map();
  return async function validateWebsite(value) {
    const site=normalizeBusinessWebsite(value), cached=cache.get(site.website);
    if(cached && cached.expires>now()) return site;
    if(pending.has(site.website)) return pending.get(site.website);
    const task=(async()=>{
      try {
        const context=await fetchContext(site.website);
        // Apply the same domain rules after any checked redirect.
        normalizeBusinessWebsite(context.url);
        cache.set(site.website,{expires:now()+ttl});
        while(cache.size>maxSize) cache.delete(cache.keys().next().value);
        return site;
      } catch { throw Error('Не вдалося підтвердити доступність сайту. Перевірте адресу й відкриття сайту через HTTPS. Захист сайту також може блокувати перевірку.'); }
    })();
    pending.set(site.website,task);
    try {return await task;} finally {pending.delete(site.website);}
  };
}

export function websiteGate(validate) {
  return async(req,res,next)=>{
    try {
      const site=await validate(req.body?.website || req.body?.brand);
      req.body={...req.body,...site};
      next();
    } catch(error) {res.status(400).json({error:error.message});}
  };
}
