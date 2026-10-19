/* Shared local policy; no DOM, browser storage or network access. */
(() => {
  'use strict';
  const permission = { permissions: ['storage', 'webNavigation'], origins: ['https://gemini.google.com/*'] };
  function usageUrl(raw) {
    try { const u = new URL(raw); return u.origin === 'https://gemini.google.com' && !u.username && !u.password && /^\/(?:u\/\d+\/)?usage\/?$/u.test(u.pathname); }
    catch { return false; }
  }
  function chatUrl(raw) {
    try { const u = new URL(raw); return u.origin === 'https://gemini.google.com' && !u.username && !u.password && !usageUrl(raw) && /^\/(?:u\/\d+\/)?app(?:\/|$)/u.test(u.pathname); }
    catch { return false; }
  }
  function resetEpochMs(r, observedAtMs) {
    if (r.epoch_ms !== null) return Number.isInteger(r.epoch_ms) ? r.epoch_ms : null;
    const now = new Date(observedAtMs);
    if (r.day !== null && r.month !== null) {
      let dt = new Date(now.getFullYear(), r.month - 1, r.day, r.hour, r.minute, 0, 0);
      if (observedAtMs - dt.getTime() > 30 * 86400000) {
        dt = new Date(now.getFullYear() + 1, r.month - 1, r.day, r.hour, r.minute, 0, 0);
      }
      return dt.getTime();
    }
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.hour, r.minute, 0, 0);
    if (dt.getTime() <= observedAtMs - 60000) {
      dt.setDate(dt.getDate() + 1);
    }
    return dt.getTime();
  }
  function minimal(raw, now = Date.now()) {
    if (!raw || raw.status !== 'observed' || raw.provider !== 'gemini_web' || !Array.isArray(raw.issues) || raw.issues.length || !Array.isArray(raw.windows) || raw.windows.length !== 2) return null;
    if (!Number.isFinite(now) || now < 0) return null;
    const windows = [];
    for (const id of ['current','weekly']) {
      const matches = raw.windows.filter(w => w && w.id === id);
      if (matches.length !== 1) return null;
      const w = matches[0], r = w.reset, p = w.used_percent;
      if (w.status !== 'observed' || !Array.isArray(w.issues) || w.issues.length || !Number.isFinite(p) || p < 0 || p > 100 || !r) return null;
      if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23 || !Number.isInteger(r.minute) || r.minute < 0 || r.minute > 59) return null;
      if (r.year !== null || r.timezone !== null || (r.epoch_ms !== null && !Number.isInteger(r.epoch_ms))) return null;
      if ((r.day === null) !== (r.month === null)) return null;
      if (r.day !== null && (!Number.isInteger(r.month) || r.month < 1 || r.month > 12 || !Number.isInteger(r.day) || r.day < 1 || r.day > [31,29,31,30,31,30,31,31,30,31,30,31][r.month-1])) return null;
      const epochMs = resetEpochMs(r, now);
      windows.push({ id, status: 'observed', used_percent: p, remaining_percent: Number((100-p).toFixed(6)), reset: { day:r.day, month:r.month, year:null, hour:r.hour, minute:r.minute, timezone:null, epoch_ms:epochMs, needs_confirmation:true }, issues: [] });
    }
    return { schema_version:1, provider:'gemini_web', origin:'visible_ui', collection:'dom_on_authorized_usage', model:null, status:'observed', observed_at_ms:now, windows, issues:[] };
  }
  const CURRENT_CYCLE_MS = 5 * 3600 * 1000;
  const WEEKLY_CYCLE_MS = 7 * 86400 * 1000;
  function applyClockResetIfExpired(snap, now = Date.now()) {
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.windows)) return snap;
    const observedAt = snap.observed_at_ms;
    if (!Number.isFinite(observedAt) || !Number.isFinite(now) || now < observedAt || now - observedAt > WEEKLY_CYCLE_MS) return snap;
    let changed = false;
    const windows = snap.windows.map(w => {
      const epoch = w?.reset?.epoch_ms;
      if (!w || !w.reset || !Number.isInteger(epoch) || !(observedAt < epoch && now >= epoch)) return w;
      changed = true;
      const cycleMs = w.id === 'weekly' ? WEEKLY_CYCLE_MS : CURRENT_CYCLE_MS;
      const steps = Math.floor((now - epoch) / cycleMs) + 1;
      const nextEpoch = epoch + steps * cycleMs;
      const nextDt = new Date(nextEpoch);
      const nextReset = {
        ...w.reset,
        day: w.reset.day !== null ? nextDt.getDate() : null,
        month: w.reset.month !== null ? nextDt.getMonth() + 1 : null,
        hour: nextDt.getHours(),
        minute: nextDt.getMinutes(),
        epoch_ms: nextEpoch,
        needs_confirmation: true
      };
      return { ...w, used_percent: 0, remaining_percent: 100, reset: nextReset };
    });
    return changed ? { ...snap, windows } : snap;
  }
  const fingerprint = snap => JSON.stringify(snap.windows.map(w => ({ ...w, reset: { ...w.reset, epoch_ms: null } })));
  function freshness(snap, now = Date.now(), onUsage = false) {
    const age = snap ? now-snap.observed_at_ms : NaN;
    if (!Number.isFinite(age) || age < 0 || age > 86400000) return 'unavailable';
    return age <= 300000 && onUsage ? 'recent' : 'historical';
  }
  globalThis.GeminiAutoCore = Object.freeze({ permission, usageUrl, chatUrl, minimal, fingerprint, freshness, applyClockResetIfExpired });
})();
