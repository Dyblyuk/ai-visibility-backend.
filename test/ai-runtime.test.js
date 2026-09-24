import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fetchWithDeadline,singleFlight} from '../ai-runtime.js';
test('deadline cancels stalled response bodies and short retries share one budget',async()=>{
 let attempts=0;
 const server=http.createServer((req,res)=>{
  if(req.url==='/slow'){res.writeHead(200);res.write('partial');return;}
  attempts++;res.writeHead(429,{'retry-after':'0.02'});res.end('quota');
 });
 server.listen(0);await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port;
 try {
  const started=Date.now();await assert.rejects(fetchWithDeadline(url+'/slow',{}, {timeoutMs:80}));assert.ok(Date.now()-started<600);
  const r=await fetchWithDeadline(url+'/quota',{}, {timeoutMs:300,maxRetries:1});assert.equal(r.status,429);assert.equal(attempts,2);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('identical concurrent work is shared and failures can be retried',async()=>{
 const run=singleFlight();let count=0;
 const work=async()=>{count++;await new Promise(r=>setTimeout(r,5));return 5;};
 assert.deepEqual(await Promise.all([run('a',work),run('a',work)]),[5,5]);assert.equal(count,1);
 await assert.rejects(run('bad',()=>{throw Error('temporary');}));assert.equal(await run('bad',()=>7),7);
});
