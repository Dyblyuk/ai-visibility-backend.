import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export function publicIPv4(address) {
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
export function extractSiteText(html) {
 const metas=(html.match(/<meta\b[^>]*>/gi)||[]).filter(tag=>/description|og:title/i.test(tag)).map(tag=>tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]||'').join(' ');
 const body=html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]+>/g,' ');
 return (metas+' '+body).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/gi,"'").replace(/\s+/g,' ').trim().slice(0,24000);
}
export async function fetchSiteContext(website, redirects=0) {
 const url=new URL(/^https?:\/\//i.test(website)?website:`https://${website}`);
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.includes('.'))throw Error('Unsupported site address');
 // Pin the request to a checked public IPv4 address, including on redirects.
 const addresses=await lookup(url.hostname,{family:4,all:true});
 if(!addresses.length||addresses.some(item=>!publicIPv4(item.address)))throw Error('Site address is not public');
 const chosen=addresses[0];
 const response=await new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{'User-Agent':'TopMarketing-Visibility/3.1','Accept':'text/html,text/plain'},lookup:(host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,4)},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>600000){request.destroy(Error('Site too large'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location,type:res.headers['content-type']||'',body:Buffer.concat(chunks).toString('utf8')}));
  });
  request.setTimeout(12000,()=>request.destroy(Error('Site timeout')));request.on('error',reject);
 });
 if([301,302,303,307,308].includes(response.status)&&response.location&&redirects<3)return fetchSiteContext(new URL(response.location,url).href,redirects+1);
 if(response.status!==200||!/text\/(html|plain)/i.test(response.type))throw Error('Site content unavailable');
 const text=extractSiteText(response.body);if(text.length<40)throw Error('Site has insufficient text');
 return {url:url.href,text};
}
