'use strict';
importScripts('auto-core.js');
const core = GeminiAutoCore;
const activeTabs = new Set(); // transient ids only; never serialized
const navigations = new Map();
const navigationQueues = new Map();
const pendingReads = new Map();
const diagnostic = {last_code:'idle',checks:0,publications:0,rejections:0};
const CHAT_AUTO_REFRESH_COOLDOWN_MS = 180000;
let lastBgRefreshTriggerAt = 0;
let revision = 0;
let serial = Promise.resolve();
const locked = task => { const next = serial.then(task, task); serial = next.catch(() => {}); return next; };
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
function usageTargetUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.origin !== 'https://gemini.google.com' || u.username || u.password) return 'https://gemini.google.com/usage';
    const m = /^\/u\/(\d+)(?:\/|$)/u.exec(u.pathname);
    return m ? `https://gemini.google.com/u/${m[1]}/usage` : 'https://gemini.google.com/usage';
  } catch { return 'https://gemini.google.com/usage'; }
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
    pending.timer=setTimeout(()=>finishRead(tabId,{confirmed:false,code:'no_observation'},pending),7000);
    pendingReads.set(tabId,pending);
  });
  try {
    if (!await trigger()) finishRead(tabId,{confirmed:false,code:'execution_failed'},pendingRequest);
  } catch {
    finishRead(tabId,{confirmed:false,code:'execution_failed'},pendingRequest);
  }
  return completion;
}
async function recheck() {
  const generation=revision;
  if (!await enabled()) return {requested:false,confirmed:false,code:'not_authorized'};
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if (generation!==revision) return {requested:false,confirmed:false,code:'cancelled'};
  if (core.usageUrl(tab?.url)) {
    return waitForTabRead(tab.id,generation,()=>navigate({frameId:0,tabId:tab.id,url:tab.url}));
  }
  const tabs=(await chrome.tabs.query({url:'https://gemini.google.com/*'}))||[];
  if (generation!==revision) return {requested:false,confirmed:false,code:'cancelled'};
  const usageTab=tabs.find(t=>t?.id && core.usageUrl(t.url));
  if (usageTab) {
    if (typeof chrome.tabs.reload!=='function') return {requested:false,confirmed:false,code:'execution_failed'};
    return waitForTabRead(usageTab.id,generation,async()=>{await chrome.tabs.reload(usageTab.id);return true;});
  }
  if (typeof chrome.tabs.create!=='function') return {requested:false,confirmed:false,code:'blocked_route'};
  try {
    const created=await chrome.tabs.create({url:usageTargetUrl(tab?.url),active:false});
    if (generation!==revision || !created?.id) return {requested:false,confirmed:false,code:'execution_failed'};
    return waitForTabRead(created.id,generation,async()=>true);
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
  if (erase) { updateBadge(null); lastBgRefreshTriggerAt = 0; }
  if (await chrome.permissions.contains({permissions:['storage']})) {
    if (erase) await chrome.storage.local.clear();
    else await chrome.storage.local.set({autoEnabled:false});
  }
  if (remove) await chrome.permissions.remove(erase ? core.permission : {permissions:['webNavigation'],origins:core.permission.origins});
}
function navigate(details) {
  if (details.frameId !== 0) return;
  const generation = revision;
  const ticket = {};
  navigations.set(details.tabId,ticket);
  // STOP and injection must finish in order; a ticket alone cannot undo a late STOP.
  const prior=navigationQueues.get(details.tabId)||Promise.resolve();
  const task=prior.catch(()=>{}).then(()=>performNavigation(details,generation,ticket));
  navigationQueues.set(details.tabId,task);
  return task.finally(()=>{if(navigationQueues.get(details.tabId)===task)navigationQueues.delete(details.tabId);});
}
async function performNavigation(details,generation,ticket) {
  try {
    if (generation!==revision || navigations.get(details.tabId)!==ticket) return false;
    // Also stop an old content context when worker memory has been discarded.
    await chrome.tabs.sendMessage(details.tabId, {type:'AUTO_STOP'}).catch(() => {});
    activeTabs.delete(details.tabId);
    if (!await enabled()) return false;
    if (!core.usageUrl(details.url)) {
      if (core.chatUrl(details.url) && Date.now() - lastBgRefreshTriggerAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) {
        const tabs = (await chrome.tabs.query({url:'https://gemini.google.com/*'})) || [];
        const usageTab = tabs.find(t => t?.id && t.id !== details.tabId && core.usageUrl(t.url));
        if (usageTab && typeof chrome.tabs.reload === 'function') {
          const last = (await chrome.storage.local.get('lastSnapshot')).lastSnapshot;
          const now = Date.now();
          const observedAt = last?.observed_at_ms;
          if (generation === revision && (!Number.isFinite(observedAt) || now - observedAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) && now - lastBgRefreshTriggerAt >= CHAT_AUTO_REFRESH_COOLDOWN_MS) {
            lastBgRefreshTriggerAt = now;
            await chrome.tabs.reload(usageTab.id);
          }
        }
      }
      return false;
    }
    const tab = await chrome.tabs.get(details.tabId);
    if (generation !== revision || navigations.get(details.tabId) !== ticket || tab.url !== details.url || !core.usageUrl(tab.url)) return false;
    activeTabs.add(details.tabId);
    await chrome.scripting.executeScript({target:{tabId:details.tabId,frameIds:[0]},world:'ISOLATED',files:['auto-core.js','extractor.js','auto-controller.js','auto-content.js']});
    return generation === revision && navigations.get(details.tabId) === ticket;
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
chrome.permissions.onAdded.addListener(() => listen());
chrome.permissions.onRemoved.addListener(() => { void disable().catch(() => {}); });
chrome.tabs.onRemoved.addListener(id => {activeTabs.delete(id);navigations.delete(id);});
chrome.tabs.onActivated.addListener(async details => {
  try { const tab=await chrome.tabs.get(details.tabId); if (core.usageUrl(tab.url)) await navigate({frameId:0,tabId:tab.id,url:tab.url}); } catch {}
});
chrome.windows?.onFocusChanged.addListener(async windowId => {
  if (windowId < 0) return;
  try { const [tab]=await chrome.tabs.query({active:true,windowId}); if (core.usageUrl(tab?.url)) await navigate({frameId:0,tabId:tab.id,url:tab.url}); } catch {}
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
        await chrome.storage.local.set({autoEnabled:true}); revision++; listen();
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (tab?.url) void navigate({frameId:0,tabId:tab.id,url:tab.url});
        return {enabled:true};
      }
      if (type === 'AUTO_DISABLE' || type === 'AUTO_ERASE') { await disable(true,type==='AUTO_ERASE'); return {enabled:false}; }
      if (type === 'AUTO_STATE') {
        if (!await chrome.permissions.contains({permissions:['storage']})) return {enabled:false,snapshot:null,freshness:'unavailable'};
        const data = await chrome.storage.local.get(['autoEnabled','lastSnapshot']);
        const cachedTime=data.lastSnapshot?.observed_at_ms;
        const snapshot = Number.isFinite(cachedTime)?core.minimal(data.lastSnapshot,cachedTime):null;
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        const auto = await enabled();
        const freshness = core.freshness(snapshot,Date.now(),auto && core.usageUrl(tab?.url));
        if (freshness === 'unavailable') { await chrome.storage.local.remove('lastSnapshot'); updateBadge(null); }
        else if (snapshot) { notifyNativeHost(snapshot); }
        return {enabled:auto,snapshot:freshness==='unavailable'?null:snapshot,freshness};
      }
      return {};
    }
    if (!['AUTO_CHECK','AUTO_SNAPSHOT'].includes(type) || !core.usageUrl(sender.url) || (sender.frameId!==undefined && sender.frameId!==0)) {diagnostic.last_code='blocked_route';return {enabled:false,accepted:false,code:'blocked_route'};}
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
    const observed = message.snapshot?.observed_at_ms;
    if (!Number.isFinite(observed) || observed < 0 || observed > Date.now()+1000 || Date.now()-observed > 86400000) {diagnostic.last_code='invalid_timestamp';return {accepted:false,code:'invalid_timestamp'};}
    const snapshot = core.minimal(message.snapshot,observed);
    if (!snapshot) {diagnostic.last_code='invalid_snapshot';return {accepted:false,code:'invalid_snapshot'};}
    if (generation !== revision) return {accepted:false};
    const previous = (await chrome.storage.local.get('lastSnapshot')).lastSnapshot;
    if (generation !== revision) return {accepted:false};
    if (previous && observed<previous.observed_at_ms) {
      diagnostic.last_code='stale_observation';diagnostic.rejections++;
      return {accepted:false,code:'stale_observation'};
    }
    const unchanged=previous && core.fingerprint(previous)===core.fingerprint(snapshot);
    if (previous && observed===previous.observed_at_ms) {
      reportRead(sender.tab.id,observed,{confirmed:false,code:'duplicate'});
      return {accepted:unchanged,code:'duplicate'};
    }
    try {await chrome.storage.local.set({lastSnapshot:snapshot});}
    catch {
      diagnostic.last_code='storage_failed';diagnostic.rejections++;
      reportRead(sender.tab.id,observed,{confirmed:false,code:'storage_failed'});
      return {accepted:false,code:'storage_failed'};
    }
    updateBadge(snapshot);
    notifyNativeHost(snapshot);
    diagnostic.last_code='persisted';diagnostic.publications++;
    reportRead(sender.tab.id,observed,{confirmed:true,code:unchanged?'unchanged':'updated'});
    return {accepted:true,code:'persisted'};
  }).then(reply,()=>reply({enabled:false,accepted:false}));
  return true;
});
