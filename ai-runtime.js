// One deadline covers connection, response body and retries (not each attempt).
export async function fetchWithDeadline(url, options, {timeoutMs=25000,maxRetries=1}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('AI request deadline exceeded')),timeoutMs);
  try {
    for(let attempt=0;;attempt++) {
      const response=await fetch(url,{...options,signal:controller.signal});
      const body=await response.arrayBuffer();
      if(response.status!==429 || attempt>=maxRetries) {
        return new Response(body.byteLength?body:null,{status:response.status,headers:response.headers});
      }
      const retryAfter=response.headers.get('retry-after');
      const delay=retryAfter ? (Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now())) : 500;
      // Long quota resets cannot be solved by keeping a person waiting.
      if(!Number.isFinite(delay)||delay>1500)return new Response(body,{status:429,headers:response.headers});
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(t);reject(controller.signal.reason);};
        const t=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},delay);
        controller.signal.addEventListener('abort',abort,{once:true});
        if(controller.signal.aborted)abort();
      });
    }
  } finally { clearTimeout(timer); }
}

export function singleFlight() {
  const pending=new Map();
  return (key,work)=>{
    if(pending.has(key))return pending.get(key);
    const promise=Promise.resolve().then(work).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  };
}
