'use strict';
importScripts('auto-core.js');
const core = GeminiAutoCore;
const activeTabs = new Set(); // transient ids only; never serialized
const navigations = new Map();
const navigationQueues = new Map();
const pendingReads = new Map();
const diagnostic = {last_code:'idle',checks:0,publications:0,rejections:0};
const CHAT_AUTO_REFRESH_COOLDOWN_MS = 180000;
const ALARM_STALE_THRESHOLD_MS = 55000;
const AUTO_REFRESH_ALARM = 'gemini-web-auto-refresh';
const POLL_MAX_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 600;
let lastBgRefreshTriggerAt = 0;
let lastProfileId = null;
let lastKnownUsageUrl = null;
let lastAccountTier = null;
let seenProfile1 = false;
let revision = 0;
let serial = Promise.resolve();
const locked = task => { const next = serial.then(task, task); serial = next.catch(() => {}); return next; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function ensureAlarm() {
  try { chrome.alarms?.create?.(AUTO_REFRESH_ALARM, { delayInMinutes: 1, periodInMinutes: 1 }); } catch {}
}
function clearAlarm() {
  try { void chrome.alarms?.clear?.(AUTO_REFRESH_ALARM); } catch {}
}
function updateBadge(snapshot) {
  try {
    const current = snapshot?.windows?.find(w => w && w.id === 'current');
    const used = current?.used_percent;
    if (!Number.isFinite(used) || used < 0 || used > 100) {
      void chrome.action?.setBadgeText?.({ text: '' });
      return;
    }
    const color = used >= 80 ? '#dc2626' : used >= 50 ? '#d97706' : '#16a34a';
    void chrome.action?.setBadgeBackgroundColor?.({ color });
    void chrome.action?.setBadgeText?.({ text: `${used}%` });
  } catch {}
}
function notifyNativeHost(snapshot) {
  try {
    const res = chrome.runtime?.sendNativeMessage?.('com.codenotch.gemini_web', snapshot, () => void chrome.runtime?.lastError);
    if (res && typeof res.catch === 'function') res.catch(() => {});
  } catch {}
}
function extractProfileIdFromUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.origin !== 'https://gemini.google.com' || u.username || u.password) return null;
    const m = /^\/u\/(\d+)(?:\/|$)/u.exec(u.pathname);
    return m ? m[1] : null;
  } catch { return null; }
}
async function persistKnownUsageUrl(url) {
  try {
    if (!url || !await enabled()) return;
    await chrome.storage.local.set({ lastKnownUsageUrl: url });
  } catch {}
}
function extractProfileId(raw) {
  const pid = extractProfileIdFromUrl(raw);
  if (pid !== null) {
    if (pid === '1') seenProfile1 = true;
    const proProtected = seenProfile1 || lastAccountTier === 'pro' || lastProfileId === '1';
    if (!(pid === '0' && proProtected)) {
      lastProfileId = pid;
      lastKnownUsageUrl = `https://gemini.google.com/u/${pid}/usage?pageId=none`;
      void persistKnownUsageUrl(lastKnownUsageUrl);
    }
    return pid;
  }
  return null;
}
async function queryGeminiTabs() {
  const tabs = (await chrome.tabs.query({ url: 'https://gemini.google.com/*' })) || [];
  for (const t of tabs) extractProfileId(t?.url);
  return tabs;
}
function usageTargetUrl(raw, tabs = [], storedUrl = null) {
  const proProtected = seenProfile1 || lastAccountTier === 'pro';
  const direct = extractProfileId(raw);
  if (direct !== null && !(direct === '0' && proProtected)) {
    return `https://gemini.google.com/u/${direct}/usage?pageId=none`;
  }
  if (Array.isArray(tabs)) {
    for (const t of tabs) {
      const pid = extractProfileIdFromUrl(t?.url);
      if (pid !== null && pid !== '0') {
        extractProfileId(t.url);
        return `https://gemini.google.com/u/${pid}/usage?pageId=none`;
      }
    }
    if (!proProtected) {
      for (const t of tabs) {
        const pid = extractProfileId(t?.url);
        if (pid !== null) return `https://gemini.google.com/u/${pid}/usage?pageId=none`;
      }
    }
  }
  if (proProtected) return 'https://gemini.google.com/u/1/usage?pageId=none';
  const candidate = lastKnownUsageUrl || storedUrl;
  if (candidate && core.usageUrl(candidate)) return candidate;
  if (lastProfileId !== null) return `https://gemini.google.com/u/${lastProfileId}/usage?pageId=none`;
  return 'https://gemini.google.com/u/1/usage?pageId=none';
}
function finishRead(tabId,result,expected) {
  const pending=pendingReads.get(tabId);
  if (!pending || (expected && pending!==expected)) return;
  pendingReads.delete(tabId); clearTimeout(pending.timer); pending.resolve({requested:true,...result});
}
function cancelReads() { for (const id of pendingReads.keys()) finishRead(id,{confirmed:false,code:'cancelled'}); }
function reportRead(tabId,observed,result) {
  const pending=pendingReads.get(tabId);
  if (pending && pending.revision===revision && observed>=pending.started) finishRead(tabId,result);
}
async function waitForTabRead(tabId,generation,trigger) {
  finishRead(tabId,{confirmed:false,code:'superseded'});
  let pendingRequest;
  const completion=new Promise(resolve=>{
    const pending=pendingRequest={resolve,revision:generation,started:Date.now(),timer:null};
    pendingReads.set(tabId,pending);
  });
  try {
    if (!await trigger()) finishRead(tabId,{confirmed:false,code:'execution_failed'},pendingRequest);
    else if (pendingReads.get(tabId)===pendingRequest) {
      pendingRequest.timer=setTimeout(()=>finishRead(tabId,{confirmed:false,code:'no_observation'},pendingRequest),14000);
    }
  } catch {
    finishRead(tabId,{confirmed:false,code:'execution_failed'},pendingRequest);
  }
  return completion;
}
async function ingestSnapshot(tabId, sourceUrl, rawSnapshot, generation) {
  const observed = rawSnapshot?.observed_at_ms;
  if (!Number.isFinite(observed) || observed < 0 || observed > Date.now()+1000 || Date.now()-observed > 86400000) {
    diagnostic.last_code='invalid_timestamp';
    return {accepted:false,code:'invalid_timestamp'};
  }
  const snapshot = core.minimal(rawSnapshot,observed);
  if (!snapshot) {
    diagnostic.last_code='invalid_snapshot';
    return {accepted:false,code:'invalid_snapshot'};
  }
  if (generation !== revision) return {accepted:false};
  const stored = await chrome.storage.local.get(['lastSnapshot','lastAccountTier','lastKnownUsageUrl']);
  if (generation !== revision) return {accepted:false};
  const previous = stored.lastSnapshot;
  const incomingTier = rawSnapshot?.account_tier || (rawSnapshot?.is_pro_tier || rawSnapshot?.plan === 'PRO' ? 'pro' : 'unknown');
  const urlPid = extractProfileIdFromUrl(sourceUrl) ?? (rawSnapshot?.profile_index !== undefined && rawSnapshot?.profile_index !== null ? String(rawSnapshot.profile_index) : null);
  const isDefaultOrZeroProfile = (urlPid === null || urlPid === '0');
  const prevTier = lastAccountTier || stored.lastAccountTier || null;
  const prevUrl = lastKnownUsageUrl || stored.lastKnownUsageUrl || '';
  const prevWasProOrU1 = Boolean(previous && (prevTier === 'pro' || seenProfile1 || lastProfileId === '1' || /\/u\/1\/usage/u.test(prevUrl)));
  if (prevWasProOrU1 && isDefaultOrZeroProfile && incomingTier === 'free') {
    seenProfile1 = true;
    lastProfileId = '1';
    lastKnownUsageUrl = 'https://gemini.google.com/u/1/usage?pageId=none';
    try { await chrome.storage.local.set({ lastKnownUsageUrl }); } catch {}
    diagnostic.last_code = 'free_tier_overwrite_blocked';
    diagnostic.rejections++;
    reportRead(tabId, observed, { confirmed: false, code: 'free_tier_overwrite_blocked' });
    return { accepted: false, code: 'free_tier_overwrite_blocked' };
  }
  if (previous && observed<previous.observed_at_ms) {
    diagnostic.last_code='stale_observation';diagnostic.rejections++;
    return {accepted:false,code:'stale_observation'};
  }
  const unchanged=previous && core.fingerprint(previous)===core.fingerprint(snapshot);
  if (previous && observed===previous.observed_at_ms) {
    reportRead(tabId,observed,{confirmed:false,code:'duplicate'});
    return {accepted:unchanged,code:'duplicate'};
  }
  if (incomingTier === 'pro') lastAccountTier = 'pro';
  else if (incomingTier === 'free' && !lastAccountTier) lastAccountTier = 'free';
  if (urlPid === '1') seenProfile1 = true;
  if (urlPid !== null && !(urlPid === '0' && (seenProfile1 || lastAccountTier === 'pro'))) {
    lastProfileId = urlPid;
    lastKnownUsageUrl = `https://gemini.google.com/u/${urlPid}/usage?pageId=none`;
  }
  const toStore = { lastSnapshot: snapshot };
  if (lastKnownUsageUrl) toStore.lastKnownUsageUrl = lastKnownUsageUrl;
  if (lastAccountTier) toStore.lastAccountTier = lastAccountTier;
  try {await chrome.storage.local.set(toStore);}
  catch {
    diagnostic.last_code='storage_failed';diagnostic.rejections++;
    reportRead(tabId,observed,{confirmed:false,code:'storage_failed'});
    return {accepted:false,code:'storage_failed'};
  }
  updateBadge(snapshot);
  notifyNativeHost(snapshot);
  diagnostic.last_code='persisted';diagnostic.publications++;
  reportRead(tabId,observed,{confirmed:true,code:unchanged?'unchanged':'updated'});
  return {accepted:true,code:'persisted'};
}
async function injectVisibilityShim(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'MAIN',
      injectImmediately: true,
      files: ['visibility-shim.js']
    });
  } catch {}
}
async function pollUsageTab(tabId, generation, ticket = null) {
  try {
    if (generation !== revision || (ticket && navigations.get(tabId) !== ticket)) return false;
    const firstTab = await chrome.tabs.get(tabId);
    if (!firstTab || !core.usageUrl(firstTab.url)) return false;
    activeTabs.add(tabId);
    if (firstTab.active === false) {
      await injectVisibilityShim(tabId);
    }
    const firstRes = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'ISOLATED',
      files: ['auto-core.js', 'extractor.js', 'auto-controller.js', 'auto-content.js']
    });
    if (generation !== revision || (ticket && navigations.get(tabId) !== ticket)) return false;
    if (!Array.isArray(firstRes)) return true;
    const initialRaw = firstRes[0]?.result;
    if (initialRaw && initialRaw.status === 'observed' && core.minimal(initialRaw, initialRaw.observed_at_ms)) {
      await locked(() => ingestSnapshot(tabId, firstTab.url, initialRaw, generation));
      return true;
    }
    await injectVisibilityShim(tabId);
    for (let attempt = 2; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
      await delay(POLL_INTERVAL_MS);
      if (generation !== revision || (ticket && navigations.get(tabId) !== ticket)) return false;
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !core.usageUrl(tab.url)) return false;
      await injectVisibilityShim(tabId);
      const execRes = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'ISOLATED',
        files: ['extractor.js']
      });
      let raw = Array.isArray(execRes) ? execRes[0]?.result : null;
      if (!raw || typeof raw !== 'object') {
        const fnRes = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: 'ISOLATED',
          func: () => globalThis.CodenotchGeminiQuotaPrototype?.extract?.(document, Date.now()) || null
        });
        raw = Array.isArray(fnRes) ? fnRes[0]?.result : null;
      }
      if (raw && raw.status === 'observed' && core.minimal(raw, raw.observed_at_ms)) {
        await locked(() => ingestSnapshot(tabId, tab.url, raw, generation));
        return true;
      }
      if (attempt >= 3 && raw && raw.account_tier === 'free') {
        const pid = extractProfileIdFromUrl(tab.url);
        if ((pid === null || pid === '0') && (seenProfile1 || lastAccountTier === 'pro' || lastProfileId === '1')) {
          seenProfile1 = true;
          lastProfileId = '1';
          lastKnownUsageUrl = 'https://gemini.google.com/u/1/usage?pageId=none';
          void persistKnownUsageUrl(lastKnownUsageUrl);
          reportRead(tabId, Date.now(), { confirmed: false, code: 'free_tier_overwrite_blocked' });
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
async function recheck() {
  const generation=revision;
  if (!await enabled()) return {requested:false,confirmed:false,code:'not_authorized'};
  const stored = await chrome.storage.local.get(['lastKnownUsageUrl','lastAccountTier']);
  if (stored?.lastAccountTier && !lastAccountTier) lastAccountTier = stored.lastAccountTier;
  if (stored?.lastKnownUsageUrl && !lastKnownUsageUrl) lastKnownUsageUrl = stored.lastKnownUsageUrl;
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  extractProfileId(tab?.url);
  if (generation!==revision) return {requested:false,confirmed:false,code:'cancelled'};
  if (core.usageUrl(tab?.url)) {
    return waitForTabRead(tab.id,generation,()=>navigate({frameId:0,tabId:tab.id,url:tab.url}));
  }
  const tabs=await queryGeminiTabs();
  if (generation!==revision) return {requested:false,confirmed:false,code:'cancelled'};
  const targetUrl = usageTargetUrl(tab?.url,tabs,stored?.lastKnownUsageUrl);
  const targetPid = extractProfileIdFromUrl(targetUrl);
  const usageTab=tabs.find(t=>t?.id && core.usageUrl(t.url) && (!targetPid || extractProfileIdFromUrl(t.url)===targetPid || (!seenProfile1 && lastProfileId===null && extractProfileIdFromUrl(t.url)!==null)));
  if (usageTab) {
    if (typeof chrome.tabs.reload!=='function') return {requested:false,confirmed:false,code:'execution_failed'};
    return waitForTabRead(usageTab.id,generation,async()=>{
      await chrome.tabs.reload(usageTab.id);
      void delay(POLL_INTERVAL_MS).then(()=>{if(pendingReads.has(usageTab.id))void pollUsageTab(usageTab.id,generation,null);});
      return true;
    });
  }
  if (typeof chrome.tabs.create!=='function') return {requested:false,confirmed:false,code:'blocked_route'};
  try {
    const created=await chrome.tabs.create({url:targetUrl,active:false});
    if (generation!==revision || !created?.id) return {requested:false,confirmed:false,code:'execution_failed'};
    try {
      return await waitForTabRead(created.id,generation,()=>pollUsageTab(created.id,generation,null));
    } finally {
      try { await chrome.tabs.remove?.(created.id); } catch {}
    }
  } catch {
    return {requested:false,confirmed:false,code:'execution_failed'};
  }
}
async function enabled() {
  if (!await chrome.permissions.contains(core.permission)) return false;
  return (await chrome.storage.local.get('autoEnabled')).autoEnabled === true;
}
async function stopAll() {
  revision++;
  cancelReads();
  navigations.clear();
  const ids = new Set(activeTabs);
  // Recover recipients after a service-worker suspension; metadata only, no DOM.
  if (await chrome.permissions.contains({origins:core.permission.origins})) {
    for (const tab of await chrome.tabs.query({url:core.permission.origins})) ids.add(tab.id);
  }
  for (const id of ids) { try { await chrome.tabs.sendMessage(id, {type:'AUTO_STOP'}); } catch {} }
  activeTabs.clear();
}
async function disable(remove = false, erase = false) {
  await stopAll();
  clearAlarm();
  if (erase) {
    updateBadge(null);
    lastBgRefreshTriggerAt = 0;
    lastProfileId = null;
    lastKnownUsageUrl = null;
    lastAccountTier = null;
    seenProfile1 = false;
  }
  if (await chrome.permissions.contains({permissions:['storage']})) {
    if (erase) await chrome.storage.local.clear();
    else await chrome.storage.local.set({autoEnabled:false});
  }
  if (remove) await chrome.permissions.remove(erase ? core.permission : {permissions:['webNavigation'],origins:core.permission.origins});
}
function navigate(details) {
  if (details.frameId !== 0) return;
  extractProfileId(details.url);
  const generation = revision;
  const ticket = {};
  navigations.set(details.tabId,ticket);
  // STOP and injection must finish in order; a ticket alone cannot undo a late STOP.
  const prior=navigationQueues.get(details.tabId)||Promise.resolve();
  const task=prior.catch(()=>{}).then(()=>performNavigation(details,generation,ticket));
  navigationQueues.set(details.tabId,task);
  return task.finally(()=>{if(navigationQueues.get(details.tabId)===task)navigationQueues.delete(details.tabId);});
}
async function triggerBackgroundRefresh(sourceUrl, excludeTabId, generation, immediate = false) {
  const tabs = await queryGeminiTabs();
  const stored = await chrome.storage.local.get(['lastSnapshot','lastKnownUsageUrl','lastAccountTier']);
  if (stored?.lastAccountTier && !lastAccountTier) lastAccountTier = stored.lastAccountTier;
  if (stored?.lastKnownUsageUrl && !lastKnownUsageUrl) lastKnownUsageUrl = stored.lastKnownUsageUrl;
  const targetUrl = usageTargetUrl(sourceUrl, tabs, stored?.lastKnownUsageUrl);
  const targetPid = extractProfileIdFromUrl(targetUrl);
  const usageTab = tabs.find(t => t?.id && t.id !== excludeTabId && core.usageUrl(t.url) && (!targetPid || extractProfileIdFromUrl(t.url) === targetPid));
  if (usageTab && typeof chrome.tabs.reload === 'function') {
    await chrome.tabs.reload(usageTab.id);
    void delay(POLL_INTERVAL_MS).then(() => pollUsageTab(usageTab.id, generation, null));
  } else if (!usageTab && typeof chrome.tabs.create === 'function') {
    const created = await chrome.tabs.create({ url: targetUrl, active: false });
    if (created?.id) {
      const p = waitForTabRead(created.id, generation, async () => {
        if (immediate) return await pollUsageTab(created.id, generation, null);
        void delay(POLL_INTERVAL_MS).then(() => { if (pendingReads.has(created.id)) void pollUsageTab(created.id, generation, null); });
        return true;
      }).finally(async () => {
        try { await chrome.tabs.remove?.(created.id); } catch {}
      });
      if (immediate) return await p;
      void p;
    }
  }
}
async function performNavigation(details,generation,ticket) {
  try {
    if (generation!==revision || navigations.get(details.tabId)!==ticket) return false;
    extractProfileId(details.url);
    // Also stop an old content context when worker memory has been discarded.
    await chrome.tabs.sendMessage(details.tabId, {type:'AUTO_STOP'}).catch(() => {});
    activeTabs.delete(details.tabId);
    if (!await enabled()) return false;
    ensureAlarm();
    if (!core.usageUrl(details.url)) {
      if (core.chatUrl(details.url) && Date.now() - lastBgRefreshTriggerAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) {
        const last = (await chrome.storage.local.get('lastSnapshot')).lastSnapshot;
        const now = Date.now();
        const observedAt = last?.observed_at_ms;
        if (generation === revision && (!Number.isFinite(observedAt) || now - observedAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) && now - lastBgRefreshTriggerAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) {
          lastBgRefreshTriggerAt = now;
          await triggerBackgroundRefresh(details.url, details.tabId, generation, false);
        }
      }
      return false;
    }
    const tab = await chrome.tabs.get(details.tabId);
    if (generation !== revision || navigations.get(details.tabId) !== ticket || tab.url !== details.url || !core.usageUrl(tab.url)) return false;
    return await pollUsageTab(details.tabId, generation, ticket);
  } catch { /* no URLs, browser errors or personal content in logs */ }
  finally { if (navigations.get(details.tabId) === ticket) navigations.delete(details.tabId); }
}
function listen() {
  if (!chrome.webNavigation) return;
  try {
    for (const event of [chrome.webNavigation.onCompleted,chrome.webNavigation.onHistoryStateUpdated]) {
      if (!event.hasListener(navigate)) event.addListener(navigate,{url:[{schemes:['https'],hostEquals:'gemini.google.com'}]});
    }
  } catch { /* optional API not yet granted; onAdded retries registration */ }
}
listen();
chrome.runtime?.onInstalled?.addListener(() => ensureAlarm());
chrome.runtime?.onStartup?.addListener(() => ensureAlarm());
chrome.alarms?.onAlarm?.addListener(async alarm => {
  if (alarm?.name !== AUTO_REFRESH_ALARM) return;
  try {
    if (!await enabled()) return;
    const stored = await chrome.storage.local.get(['lastSnapshot','lastKnownUsageUrl','lastAccountTier']);
    if (stored?.lastAccountTier && !lastAccountTier) lastAccountTier = stored.lastAccountTier;
    if (stored?.lastKnownUsageUrl && !lastKnownUsageUrl) lastKnownUsageUrl = stored.lastKnownUsageUrl;
    const observedAt = stored?.lastSnapshot?.observed_at_ms;
    if (Number.isFinite(observedAt) && Date.now() - observedAt <= ALARM_STALE_THRESHOLD_MS) return;
    const tabs = await queryGeminiTabs();
    const activeUsage = tabs.find(t => t?.id && core.usageUrl(t.url));
    if (activeUsage) {
      void navigate({ frameId: 0, tabId: activeUsage.id, url: activeUsage.url });
      return;
    }
    lastBgRefreshTriggerAt = Date.now();
    await triggerBackgroundRefresh(tabs[0]?.url || null, null, revision, true);
  } catch {}
});
chrome.permissions.onAdded.addListener(() => { listen(); ensureAlarm(); });
chrome.permissions.onRemoved.addListener(() => { void disable().catch(() => {}); });
chrome.tabs.onRemoved.addListener(id => {activeTabs.delete(id);navigations.delete(id);});
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  const candidateUrl = changeInfo?.url || tab?.url;
  if (!candidateUrl) return;
  extractProfileId(candidateUrl);
  if (changeInfo?.status === 'loading' && core.usageUrl(candidateUrl)) {
    void injectVisibilityShim(tabId);
  }
  if (core.usageUrl(candidateUrl) || (changeInfo?.url && core.chatUrl(changeInfo.url))) {
    void navigate({ frameId: 0, tabId, url: candidateUrl });
  }
});
chrome.tabs.onActivated.addListener(async details => {
  try { const tab=await chrome.tabs.get(details.tabId); extractProfileId(tab?.url); if (core.usageUrl(tab.url) || core.chatUrl(tab.url)) await navigate({frameId:0,tabId:tab.id,url:tab.url}); } catch {}
});
chrome.windows?.onFocusChanged.addListener(async windowId => {
  if (windowId < 0) return;
  try { const [tab]=await chrome.tabs.query({active:true,windowId}); extractProfileId(tab?.url); if (core.usageUrl(tab?.url) || core.chatUrl(tab?.url)) await navigate({frameId:0,tabId:tab.id,url:tab.url}); } catch {}
});
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (!popup && !sender.tab) return false;
  const type = message?.type;
  const arrivedAtRevision = revision;
  if (popup && ['AUTO_DISABLE','AUTO_ERASE'].includes(type)) {revision++;cancelReads();} // invalidate pending captures immediately
  // Do not hold the storage queue while waiting for AUTO_CHECK/AUTO_SNAPSHOT.
  if (popup && type==='AUTO_RECHECK') {
    void recheck().then(reply,()=>reply({requested:false,confirmed:false,code:'execution_failed'}));
    return true;
  }
  if (popup && type==='AUTO_DIAGNOSTICS') {
    void (async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if (!await enabled() || !core.usageUrl(tab?.url)) return {worker:{...diagnostic},content:{last_code:'blocked_route'}};
      let content={last_code:'listener_absent'};
      try {content=await chrome.tabs.sendMessage(tab.id,{type:'AUTO_DIAGNOSTICS'})||content;} catch {}
      return {worker:{...diagnostic},content};
    })().then(reply,()=>reply({worker:{last_code:'diagnostic_unavailable'}}));
    return true;
  }
  void locked(async () => {
    if (popup) {
      if (type === 'AUTO_ENABLE') {
        if (!await chrome.permissions.contains(core.permission)) return {enabled:false};
        await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
        await chrome.storage.local.set({autoEnabled:true}); revision++; listen(); ensureAlarm();
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (tab?.url) void navigate({frameId:0,tabId:tab.id,url:tab.url});
        return {enabled:true};
      }
      if (type === 'AUTO_DISABLE' || type === 'AUTO_ERASE') { await disable(true,type==='AUTO_ERASE'); return {enabled:false}; }
      if (type === 'AUTO_STATE') {
        if (!await chrome.permissions.contains({permissions:['storage']})) {
          const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
          return {enabled:false,snapshot:null,freshness:'unavailable',lastKnownUsageUrl:usageTargetUrl(tab?.url,[])};
        }
        const data = await chrome.storage.local.get(['autoEnabled','lastSnapshot','lastKnownUsageUrl','lastAccountTier']);
        if (data.lastAccountTier && !lastAccountTier) lastAccountTier = data.lastAccountTier;
        if (data.lastKnownUsageUrl && !lastKnownUsageUrl) lastKnownUsageUrl = data.lastKnownUsageUrl;
        const cachedTime=data.lastSnapshot?.observed_at_ms;
        const snapshot = Number.isFinite(cachedTime)?core.minimal(data.lastSnapshot,cachedTime):null;
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        extractProfileId(tab?.url);
        const auto = await enabled();
        const freshness = core.freshness(snapshot,Date.now(),auto && core.usageUrl(tab?.url));
        if (freshness === 'unavailable') { await chrome.storage.local.remove('lastSnapshot'); updateBadge(null); }
        else if (snapshot) { notifyNativeHost(snapshot); }
        return {enabled:auto,snapshot:freshness==='unavailable'?null:snapshot,freshness,lastKnownUsageUrl:usageTargetUrl(tab?.url,[],data.lastKnownUsageUrl)};
      }
      return {};
    }
    if (!['AUTO_CHECK','AUTO_SNAPSHOT'].includes(type) || !core.usageUrl(sender.url) || (sender.frameId!==undefined && sender.frameId!==0)) {diagnostic.last_code='blocked_route';return {enabled:false,accepted:false,code:'blocked_route'};}
    extractProfileId(sender.url);
    const generation = arrivedAtRevision;
    if (generation !== revision) return {enabled:false,accepted:false};
    if (!await enabled()) return {enabled:false,accepted:false};
    const tab = await chrome.tabs.get(sender.tab.id);
    if (generation !== revision || tab.url !== sender.url || !core.usageUrl(tab.url)) return {enabled:false,accepted:false};
    if (sender.documentId) {
      const frame = await chrome.webNavigation.getFrame({tabId:sender.tab.id,frameId:0});
      if (frame?.documentId !== sender.documentId || generation !== revision) return {enabled:false,accepted:false};
    }
    if (type === 'AUTO_CHECK') {diagnostic.checks++;diagnostic.last_code='authorized';return {enabled:true};}
    return await ingestSnapshot(sender.tab.id, sender.url, message.snapshot, generation);
  }).then(reply,()=>reply({enabled:false,accepted:false}));
  return true;
});
