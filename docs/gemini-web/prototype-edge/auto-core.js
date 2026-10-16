/* Shared local policy; no DOM, browser storage or network access. */
(() => {
  'use strict';
  const permission = { permissions: ['storage', 'webNavigation'], origins: ['https://gemini.google.com/*'] };
  function usageUrl(raw) {
    try { const u = new URL(raw); return u.origin === 'https://gemini.google.com' && !u.username && !u.password && /^\/u\/\d+\/usage\/?$/u.test(u.pathname); }
    catch { return false; }
  }
  function minimal(raw, now = Date.now()) {
    if (!raw || raw.status !== 'observed' || raw.provider !== 'gemini_web' || !Array.isArray(raw.issues) || raw.issues.length || !Array.isArray(raw.windows) || raw.windows.length !== 2) return null;
    const windows = [];
    for (const id of ['current','weekly']) {
      const matches = raw.windows.filter(w => w && w.id === id);
      if (matches.length !== 1) return null;
      const w = matches[0], r = w.reset, p = w.used_percent;
      if (w.status !== 'observed' || !Array.isArray(w.issues) || w.issues.length || !Number.isFinite(p) || p < 0 || p > 100 || !r) return null;
      if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23 || !Number.isInteger(r.minute) || r.minute < 0 || r.minute > 59) return null;
      if (r.year !== null || r.timezone !== null || r.epoch_ms !== null) return null;
      if ((r.day === null) !== (r.month === null)) return null;
      if (r.day !== null && (!Number.isInteger(r.month) || r.month < 1 || r.month > 12 || !Number.isInteger(r.day) || r.day < 1 || r.day > [31,29,31,30,31,30,31,31,30,31,30,31][r.month-1])) return null;
      windows.push({ id, status: 'observed', used_percent: p, remaining_percent: Number((100-p).toFixed(6)), reset: { day:r.day, month:r.month, year:null, hour:r.hour, minute:r.minute, timezone:null, epoch_ms:null, needs_confirmation:true }, issues: [] });
    }
    if (!Number.isFinite(now) || now < 0) return null;
    return { schema_version:1, provider:'gemini_web', origin:'visible_ui', collection:'dom_on_authorized_usage', model:null, status:'observed', observed_at_ms:now, windows, issues:[] };
  }
  const fingerprint = snap => JSON.stringify(snap.windows);
  function freshness(snap, now = Date.now(), onUsage = false) {
    const age = snap ? now-snap.observed_at_ms : NaN;
    if (!Number.isFinite(age) || age < 0 || age > 86400000) return 'unavailable';
    return age <= 300000 && onUsage ? 'recent' : 'historical';
  }
  globalThis.GeminiAutoCore = Object.freeze({ permission, usageUrl, minimal, fingerprint, freshness });
})();
