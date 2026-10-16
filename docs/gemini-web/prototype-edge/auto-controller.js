/* One bounded observer per authorized limits page; injectable hooks enable fixture tests. */
(() => {
  'use strict';
  function create(hooks) {
    let stopped = false, timer = null, observer = null, observedRoot = null, attempts = 0, published = 0, last = null, running = false, dirty = false;
    const stats = { attempts:0, publications:0, observers:0, stopped:false,last_code:'idle',events:0,invalid_readings:0,last_attempt:null,last_publish:null };
    function stop(code='stopped') {
      if (stopped) return;
      stopped = true; stats.stopped = true; stats.last_code=code;
      if (timer !== null) hooks.clear(timer);
      timer = null; observer?.disconnect(); observer = null;
      hooks.cleanup?.();
    }
    function schedule(delay) {
      if (stopped || timer !== null) return;
      timer = hooks.later(() => { timer = null; void capture(); }, delay);
    }
    async function capture() {
      if (running) { dirty = true; return; }
      running = true;
      try {
      if (stopped || !hooks.allowed()) { stop('blocked_route_or_hidden'); return; }
      if (++attempts > 4) { stop('retry_exhausted'); return; }
      stats.attempts++;
      stats.last_attempt=Date.now();
      if (!await hooks.authorized()) { stop('authorization_denied'); return; }
      if (stopped || !hooks.allowed()) { stop(); return; }
      stats.last_code='reading';
      const raw = hooks.read();
      if (stopped || !hooks.allowed()) { stop(); return; }
      const snap = hooks.validate(raw);
      if (!snap) { stats.invalid_readings++;stats.last_code='invalid_reading';schedule(1000); return; }
      const root = hooks.root();
      if (!root) { stats.last_code='root_absent';schedule(1000); return; }
      attempts = 0;
      const key = hooks.key(snap);
      if (key !== last) {
        if (++published > 20) { stop('budget_exhausted'); return; }
        const ack=await hooks.publish(snap);
        if (ack===true || ack?.accepted===true) { last = key; stats.publications++;stats.last_publish=snap.observed_at_ms;stats.last_code=ack?.code||'persisted'; }
        else stats.last_code=ack?.code||'worker_rejected';
      }
      if (stopped || !hooks.allowed()) { stop(); return; }
      if (!observer || observedRoot !== root) {
        observer?.disconnect();
        observedRoot = root;
        observer = hooks.observe(root, () => {
          stats.events++;
          if (!hooks.allowed()) { stop(); return; }
          schedule(350);
        });
        stats.observers++;
      }
      } catch { stop(); }
      finally {
        running = false;
        if (dirty && !stopped) { dirty = false; schedule(350); }
      }
    }
    return Object.freeze({ start() { schedule(0); }, stop, stats });
  }
  globalThis.GeminiAutoController = Object.freeze({ create });
})();
