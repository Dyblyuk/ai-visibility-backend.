import { createHash, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const ID = /^[a-zA-Z0-9._~-]{1,512}$/;
// Reserved fake click IDs can only validate. They must never become live imports.
export function isGoogleValidation(attribution) {
  return typeof attribution?.gclid === 'string' && attribution.gclid.startsWith('tm_google_validation_');
}
export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
}
export function cleanAttribution(input = {}) {
  const out = {};
  for (const key of ['gclid','gbraid','wbraid','fbclid','fbc','fbp']) {
    if (typeof input?.[key] === 'string' && ID.test(input[key])) out[key] = input[key];
  }
  for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    if (typeof input?.[key] === 'string') out[key] = input[key].replace(/[\x00-\x1f]/g, '').slice(0,256);
  }
  out.consent = {};
  for (const key of ['adUserData','adPersonalization']) {
    if (['granted','denied'].includes(input?.consent?.[key])) out.consent[key] = input.consent[key];
  }
  if (out.consent.adUserData === 'denied') return {consent: out.consent};
  if (Number.isFinite(input?.capturedAt)) out.capturedAt = input.capturedAt;
  return out;
}
export function trustedSendPulse(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function makeContactEvent(phone, attribution, now = Date.now()) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const a = cleanAttribution(attribution);
  if (a.consent.adUserData === 'denied') return null;
  return {
    id: isGoogleValidation(a) ? 'tg_google_test_' + hash(normalized + ':' + a.gclid) : 'tg_contact_' + hash(normalized),
    time: new Date(now).toISOString(),
    metaPhone: hash(normalized.slice(1)), googlePhone: hash(normalized),
    attribution: a
  };
}
export function metaPayload(event, env) {
  if (isGoogleValidation(event.attribution)) return null;
  const a = event.attribution;
  const user_data = {};
  if (a.fbc) user_data.fbc = a.fbc;
  if (a.fbp) user_data.fbp = a.fbp;
  if (a.consent.adUserData === 'granted') user_data.ph = [event.metaPhone];
  if (!Object.keys(user_data).length) return null;
  const payload = {data: [{event_name:'Lead', event_time:Math.floor(Date.parse(event.time)/1000),
    event_id:event.id, action_source:'chat', user_data, custom_data:{lead_source:'telegram',content_name:'AI Visibility report'}}]};
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;
  return payload;
}
export function googlePayload(event, env) {
  const a = event.attribution;
  const validateOnly = isGoogleValidation(a);
  const adIdentifiers = {};
  for (const k of ['gclid','gbraid','wbraid']) if (a[k]) adIdentifiers[k] = a[k];
  // A bot-only phone is not sufficient to establish the original Google click.
  if (!Object.keys(adIdentifiers).length) return null;
  const destination = {reference:'telegram', operatingAccount:{accountType:'GOOGLE_ADS',accountId:env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g,'')}, productDestinationId:env.GOOGLE_ADS_CONVERSION_ACTION_ID};
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) destination.loginAccount = {accountType:'GOOGLE_ADS',accountId:env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g,'')};
  const item = {destinationReferences:['telegram'],transactionId:event.id,eventTimestamp:event.time,eventSource:'MESSAGE',adIdentifiers};
  const consent = {};
  for (const k of ['adUserData','adPersonalization']) if (a.consent[k]) consent[k] = a.consent[k] === 'granted' ? 'CONSENT_GRANTED' : 'CONSENT_DENIED';
  if (Object.keys(consent).length) item.consent = consent;
  if (!validateOnly && a.consent.adUserData === 'granted') item.userData = {userIdentifiers:[{phoneNumber:event.googlePhone}]};
  return {destinations:[destination],events:[item],...(validateOnly ? {validateOnly:true} : {}),...(item.userData ? {encoding:'HEX'} : {})};
}

// No volatile fallback for conversion delivery. SQL outbox survives redeploys.
export class ConversionOutbox {
  constructor(db) { this.db = db; }
  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS ad_conversion_outbox (
      event_id TEXT NOT NULL, platform TEXT NOT NULL, payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(), receipt TEXT, error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(event_id, platform)
    )`);
  }
  async enqueue(event) {
    for (const platform of (isGoogleValidation(event.attribution) ? ['google'] : ['meta','google'])) await this.db.query(
      'INSERT INTO ad_conversion_outbox(event_id,platform,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
      [event.id,platform,JSON.stringify(event)]);
  }
  async claim(platform) {
    const {rows} = await this.db.query(`UPDATE ad_conversion_outbox SET next_attempt=NOW()+INTERVAL '2 minutes', attempts=attempts+1
      WHERE (event_id,platform) IN (SELECT event_id,platform FROM ad_conversion_outbox
      WHERE platform=$1 AND status IN ('pending','processing') AND next_attempt<=NOW()
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [platform]);
    return rows[0];
  }
  async finish(row, status, receipt = null, error = null) {
    await this.db.query(`UPDATE ad_conversion_outbox SET status=$3,receipt=COALESCE($4,receipt),error_code=$5,
      next_attempt=NOW()+($6 * INTERVAL '1 second') WHERE event_id=$1 AND platform=$2`,
      [row.event_id,row.platform,status,receipt,error,Math.min(3600,30*2**Math.min(row.attempts,7))]);
  }
}
export function trackingStatus(env, durable) {
  const meta = !!(env.META_PIXEL_ID && env.META_CAPI_ACCESS_TOKEN && env.META_API_VERSION);
  const google = !!(env.GOOGLE_ADS_CUSTOMER_ID && env.GOOGLE_ADS_CONVERSION_ACTION_ID && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN);
  return {version:2,googleValidationLinks:true,enabled:env.ADS_CONVERSIONS_ENABLED==='true',durable,sendpulseAuthenticated:!!env.SENDPULSE_TRACKING_SECRET,metaConfigured:meta,googleConfigured:google,
    ready:env.ADS_CONVERSIONS_ENABLED==='true' && durable && !!env.SENDPULSE_TRACKING_SECRET && (meta||google)};
}
export function createConversionWorker({outbox,env=process.env,fetchFn=fetch}) {
  let running=false, oauth=null;
  const request = async (url,options) => {
    const response = await fetchFn(url,{...options,signal:AbortSignal.timeout(12000)});
    const data = await response.json();
    if (!response.ok || data.error) throw new Error('HTTP_'+response.status);
    return data;
  };
  const googleToken = async () => {
    if (oauth && oauth.expires>Date.now()+60000) return oauth.token;
    const data = await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:env.GOOGLE_OAUTH_REFRESH_TOKEN,grant_type:'refresh_token'}).toString()});
    if (!data.access_token) throw new Error('OAUTH_TOKEN_MISSING');
    oauth={token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};
    return oauth.token;
  };
  return async function tick() {
    if (running || !outbox || !trackingStatus(env,true).ready) return;
    running=true;
    try {
      for (const platform of ['meta','google']) {
        const status=trackingStatus(env,true);
        if (!status[platform+'Configured']) continue;
        const row=await outbox.claim(platform);
        if (!row) continue;
        try {
          if (platform==='google' && row.receipt) {
            const token=await googleToken();
            const result=await request('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+encodeURIComponent(row.receipt),{headers:{Authorization:'Bearer '+token}});
            const states=result.requestStatusPerDestination || [];
            const failed=states.some(s=>['FAILED','PARTIAL_SUCCESS'].includes(s.requestStatus));
            const done=states.length>0 && states.every(s=>s.requestStatus==='SUCCESS');
            await outbox.finish(row,failed?'failed':done?'sent':'processing',row.receipt,failed?'GOOGLE_PROCESSING_FAILED':null);
            continue;
          }
          if (Date.now()-Date.parse(row.payload.time)>6*86400000) {await outbox.finish(row,'expired',null,'EVENT_TOO_OLD');continue;}
          const payload=platform==='meta'?metaPayload(row.payload,env):googlePayload(row.payload,env);
          if (!payload) {await outbox.finish(row,'skipped',null,'NO_MATCH_IDENTIFIERS');continue;}
          if (platform==='meta') {
            const data=await request(`https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PIXEL_ID}/events`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.META_CAPI_ACCESS_TOKEN},body:JSON.stringify(payload)});
            if (data.events_received!==1) throw new Error('META_NOT_ACCEPTED');
            await outbox.finish(row,env.META_TEST_EVENT_CODE?'test_sent':'sent',data.fbtrace_id||null);
          } else {
            const token=await googleToken();
            const data=await request('https://datamanager.googleapis.com/v1/events:ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload)});
            if (!data.requestId) throw new Error('GOOGLE_RECEIPT_MISSING');
            await outbox.finish(row,payload.validateOnly ? 'validated' : 'processing',data.requestId);
          }
        } catch(error) {
          const code=/^(HTTP_\d+|META_NOT_ACCEPTED|GOOGLE_RECEIPT_MISSING|OAUTH_TOKEN_MISSING)$/.test(error.message)?error.message:'DELIVERY_ERROR';
          await outbox.finish(row,row.attempts>=12?'failed':row.receipt?'processing':'pending',row.receipt,code);
        }
      }
    } finally {running=false;}
  };
}
