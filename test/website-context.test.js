import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIPv4,extractSiteText,fetchSiteContext} from '../website-context.js';
test('private and reserved addresses are never fetched',async()=>{
 for(const ip of ['127.0.0.1','10.0.1.2','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('1.1.1.1'),true);
 await assert.rejects(fetchSiteContext('https://127.0.0.1'));
});
test('current service headings and meta descriptions survive extraction; scripts do not',()=>{
 const html='<title>Топ Маркетинг - Google Ads, Meta Ads та SEO</title><meta name="description" content="Performance marketing"><script>old consulting instructions</script><h2>Послуги</h2><p>Google Ads &amp; Meta Ads</p>';
 const text=extractSiteText(html);assert.match(text,/Google Ads/);assert.match(text,/Meta Ads/);assert.match(text,/SEO/);assert.ok(!text.includes('old consulting'));
});
