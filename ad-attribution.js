// Browser-only attribution capture. No conversion fires on a click or scan.
(function () {
  const key = 'tm_ad_attribution_v1';
  const ttl = 30 * 86400000;
  const params = new URLSearchParams(location.search);
  const keys = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const cookie = name => {
    try { return decodeURIComponent(document.cookie.split('; ').find(v => v.startsWith(name + '='))?.slice(name.length + 1) || ''); }
    catch { return ''; }
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  if (!saved || Date.now() - saved.capturedAt > ttl) saved = {};
  if (keys.some(k => params.has(k))) {
    saved = { capturedAt: Date.now() };
    for (const k of keys) if (params.get(k)) saved[k] = params.get(k).slice(0, 256);
    if (saved.fbclid) saved.fbc = 'fb.1.' + saved.capturedAt + '.' + saved.fbclid;
  }
  saved.capturedAt ||= Date.now();
  function snapshot() {
    const consent = window.tmAdsConsent || {};
    if (consent.adUserData === 'denied' || consent.adStorage === 'denied') {
      try { localStorage.removeItem(key); } catch {}
      saved = { capturedAt: Date.now(), consent: { adUserData: 'denied' } };
      return saved;
    }
    const out = { ...saved, consent: {} };
    // A Google landing must not inherit an old Meta click cookie.
    const isGoogle = !!(out.gclid || out.gbraid || out.wbraid);
    if (!isGoogle) out.fbc ||= cookie('_fbc');
    out.fbp = cookie('_fbp');
    for (const k of ['adUserData', 'adPersonalization']) {
      if (['granted','denied'].includes(consent[k])) out.consent[k] = consent[k];
    }
    try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
    return out;
  }
  window.tmAdAttribution = snapshot;
  snapshot();
})();
