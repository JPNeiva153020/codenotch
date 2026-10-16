'use strict';
const output = document.getElementById('result');
const status = document.getElementById('status');
const button = document.getElementById('read');
function allowedUrl(raw) {
  try {
    const url = new URL(raw);
    return url.origin === 'https://gemini.google.com' && !url.username && !url.password && /^\/u\/\d+\/usage\/?$/u.test(url.pathname);
  } catch { return false; }
}
function usageTargetUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://gemini.google.com' || url.username || url.password) return 'https://gemini.google.com/usage';
    const match = /^\/u\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return match ? `https://gemini.google.com/u/${match[1]}/usage` : 'https://gemini.google.com/usage';
  } catch { return 'https://gemini.google.com/usage'; }
}
document.getElementById('clear').addEventListener('click', () => { output.textContent = ''; status.textContent = 'Leitura limpa.'; });
document.getElementById('open-usage')?.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({ url: usageTargetUrl(tab?.url) });
  } catch {
    status.textContent = 'Não foi possível abrir a página de limites.';
  }
});
async function historicalOnly() {
  status.textContent='Abra Limites de uso para consultar os indicadores';
  try {
    const data=await chrome.runtime.sendMessage({type:'AUTO_STATE'});
    const core=globalThis.GeminiAutoCore;
    if (!Number.isFinite(data?.snapshot?.observed_at_ms) || data.snapshot.origin!=='visible_ui' || data.snapshot.collection!=='dom_on_authorized_usage') return;
    const saved=core?.minimal(data?.snapshot,data?.snapshot?.observed_at_ms);
    if (!saved || core.freshness(saved,Date.now(),false)==='unavailable') return;
    const time=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(saved.observed_at_ms));
    output.textContent=JSON.stringify({...saved,status:'historical'},null,2);
    status.textContent='Dados atuais indisponíveis nesta página; última observação em '+time+' [histórica]. Conta não identificada.';
  } catch { /* No history is safer than claiming a fresh reading. */ }
}
button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = '';
  status.textContent = 'Lendo…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !allowedUrl(tab.url)) {
      await historicalOnly();
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', files: ['extractor.js'] });
    const [reading] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', args: [tab.url], func: expectedUrl => {
      // Pin the complete URL, including same-origin navigation to a conversation.
      if (location.origin !== 'https://gemini.google.com' || location.href !== expectedUrl) return null;
      const result = globalThis.CodenotchGeminiQuotaPrototype.extract();
      if (location.origin !== 'https://gemini.google.com' || location.href !== expectedUrl) return null;
      return result;
    } });
    const currentTab = await chrome.tabs.get(tab.id);
    if (!reading?.result || currentTab.url !== tab.url || !allowedUrl(currentTab.url)) {
      status.textContent = 'Página mudou; leitura cancelada.'; return;
    }
    output.textContent = JSON.stringify(reading.result, null, 2);
    status.textContent = 'Observação pontual da interface; não é uma API oficial nem dado continuamente atualizado.';
  } catch {
    status.textContent = 'Não foi possível ler. Confira a tela de limites e tente novamente por comando explícito.';
  } finally { button.disabled = false; }
});
