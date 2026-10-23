(() => {
  'use strict';
  if (!GeminiAutoCore.usageUrl(location.href)) return;
  globalThis.CodenotchGeminiAutoSession?.stop();
  let controller = null, disposed = false, currentRoot = null;
  const allowed = () => GeminiAutoCore.usageUrl(location.href);
  function pause() { controller?.stop(); controller = null; currentRoot=null; }
  function stop() {
    disposed = true; pause();
    chrome.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', pause);
    window.removeEventListener('pageshow', onShow);
  }
  function start() {
    if (disposed || !allowed()) return;
    // A real return/gesture grants a fresh finite budget, never a polling loop.
    pause();
    controller = GeminiAutoController.create({
    allowed,
    authorized: async () => {
      try { return (await chrome.runtime.sendMessage({ type:'AUTO_CHECK' }))?.enabled === true; } catch { return false; }
    },
    read: () => CodenotchGeminiQuotaPrototype.extract(),
    validate: raw => {
      const m = GeminiAutoCore.minimal(raw,raw?.observed_at_ms);
      return m ? { ...m, is_pro_tier: Boolean(raw?.is_pro_tier), account_tier: raw?.account_tier || 'unknown', profile_index: raw?.profile_index ?? null, profile_path: raw?.profile_path ?? null } : null;
    },
    key: GeminiAutoCore.fingerprint,
    publish: async snapshot => {
      try { return await chrome.runtime.sendMessage({ type:'AUTO_SNAPSHOT', snapshot }); } catch { return {accepted:false,code:'worker_rejected'}; }
    },
    root: () => CodenotchGeminiQuotaPrototype.getContainer(),
    observe: (root, changed) => {
      currentRoot=root;
      const observer = new MutationObserver(changed);
      observer.observe(root, { subtree:true, childList:true, characterData:true });
      // Watch only direct removal of the recognized panel; never inspect siblings.
      const parent = root.parentElement, main = root.closest('main,[role="main"]');
      let boundary = null;
      if (parent && main && main.contains(parent)) {
        boundary = new MutationObserver(() => { if (!root.isConnected) changed(); });
        boundary.observe(parent,{childList:true});
      }
      return {disconnect() { observer.disconnect(); boundary?.disconnect(); }};
    },
    later: (fn, delay) => setTimeout(fn, delay), clear: timer => clearTimeout(timer)
  });
    controller.start();
  }
  function onVisibility() {
    if (!GeminiAutoCore.usageUrl(location.href)) { stop(); return; }
    if (document.visibilityState === 'visible') start();
  }
  function onShow() { if (!GeminiAutoCore.usageUrl(location.href)) stop(); else if (!controller) start(); }
  const onMessage = (message,_sender,reply) => {
    if (message?.type === 'AUTO_STOP') stop();
    if (message?.type === 'AUTO_DIAGNOSTICS') reply?.({listener_active:!disposed,root_attached:!!currentRoot?.isConnected,observer_active:!!controller&&!controller.stats.stopped&&controller.stats.observers>0,attempts:controller?.stats.attempts||0,publications:controller?.stats.publications||0,events:controller?.stats.events||0,invalid_readings:controller?.stats.invalid_readings||0,last_attempt:controller?.stats.last_attempt||null,last_publish:controller?.stats.last_publish||null,last_code:allowed()?(controller?.stats.last_code||'paused'):'blocked_route_or_hidden'});
  };
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', onShow);
  globalThis.CodenotchGeminiAutoSession = {stop,recheck:start};
  start();
  // Only the authorized controller may read; injection itself never extracts.
  return null;
})();
