(() => {
  'use strict';
  const result=document.getElementById('auto-result'), label=document.getElementById('auto-status');
  const topSubtitle=document.getElementById('top-subtitle'), topStatus=document.getElementById('status');
  let action = 0;
  function syncTopBanner(data) {
    if (topSubtitle) {
      topSubtitle.textContent = data?.enabled
        ? (data?.snapshot ? 'Leitura manual e modo automático ativos (sincronizado ao Codenotch).' : 'Leitura manual disponível. Modo automático ativo.')
        : 'Leitura manual disponível. Modo automático desativado até seu consentimento.';
    }
    if (topStatus && data?.enabled && data?.snapshot) {
      const cur = data.snapshot.windows?.find(w => w && w.id === 'current')?.used_percent;
      const wk = data.snapshot.windows?.find(w => w && w.id === 'weekly')?.used_percent;
      if (topStatus.textContent === 'Sem leitura. Protótipo sem conexão ao Codenotch.' || topStatus.textContent.startsWith('Sincronizado com o Codenotch')) {
        topStatus.textContent = Number.isFinite(cur)
          ? `Sincronizado com o Codenotch (Uso atual: ${cur}% | Semanal: ${Number.isFinite(wk) ? wk + '%' : '--'}).`
          : 'Sincronizado com o Codenotch.';
      }
    }
  }
  async function runRecheck(current) {
    try {
      label.textContent='Atualizando em 2º plano...';
      const data=await chrome.runtime.sendMessage({type:'AUTO_RECHECK'});
      if (current !== action) return;
      if(data?.confirmed){
        await state(false);if(current!==action)return;
        label.textContent=data.code==='unchanged'?'Nova leitura persistida; valores iguais à última observação. Isso não comprova atualização do Google.':'Nova leitura confirmada e persistida. Observação pontual; pode ter mudado.';
      }else label.textContent=data?.requested?'Pedido recebido, mas nenhuma nova leitura foi confirmada ('+(data.code||'no_observation')+').':'Abra a tela de limites e confira se o automático está ativado.';
    } catch { if (current === action) label.textContent='Não foi possível reverificar. Leitura manual preservada.'; }
  }
  async function state(allowAutoRefresh = false) {
    const current=action;
    try {
      const data=await chrome.runtime.sendMessage({type:'AUTO_STATE'});
      if (current!==action) return;
      const text={recent:'Observação recente; pode ter mudado.',historical:'Observação histórica.',unavailable:'Dados indisponíveis.'};
      const errSuffix=data?.lastRefreshError?.code?` (Última falha bg: ${data.lastRefreshError.code})`:'';
      label.textContent=(data?.enabled?'Automático ativado. ':'Automático desativado. ')+(text[data?.freshness]||text.unavailable)+errSuffix;
      result.textContent=data?.snapshot?JSON.stringify({...data.snapshot,status:data.freshness==='historical'?'historical':data.snapshot.status},null,2):'';
      syncTopBanner(data);
      const outsideUsage = data?.freshness === 'historical' || data?.freshness === 'unavailable';
      const observedAt = data?.snapshot?.observed_at_ms;
      const stale = !data?.snapshot || !Number.isFinite(observedAt) || Date.now() - observedAt > 60000;
      if (allowAutoRefresh === true && data?.enabled === true && outsideUsage && stale) {
        void runRecheck(current);
      }
    } catch { if(current===action){label.textContent='Automático indisponível; modo manual preservado.'; result.textContent='';} }
  }
  document.getElementById('auto-enable').addEventListener('click',async () => {
    const current = ++action;
    try {
      // Call directly inside the user gesture; never request on startup.
      let granted = true;
      if (typeof chrome.permissions?.request === 'function') {
        granted = await chrome.permissions.request(GeminiAutoCore.permission);
      }
      if (current !== action) { if (granted) try { await chrome.permissions.remove(GeminiAutoCore.permission); } catch {} return; }
      if (!granted) { label.textContent='Consentimento negado. Automático desativado.'; return; }
      await chrome.runtime.sendMessage({type:'AUTO_ENABLE'});
      if (current !== action) { await chrome.runtime.sendMessage({type:'AUTO_DISABLE'}); return; }
      await state(false);
    } catch { label.textContent='Não foi possível ativar; confira as permissões. Nenhum dado foi enviado.'; }
  });
  document.getElementById('auto-disable').addEventListener('click',async () => {
    action++;
    result.textContent=''; label.textContent='Desativando automático…';
    try { await chrome.runtime.sendMessage({type:'AUTO_DISABLE'}); await state(false); } catch { label.textContent='Falha ao desativar. Desligue a extensão em edge://extensions.'; }
  });
  document.getElementById('auto-erase').addEventListener('click',async () => {
    action++;
    result.textContent='';
    const manual=document.getElementById('result'); if (manual) manual.textContent='';
    syncTopBanner({enabled:false,snapshot:null});
    if (topStatus) topStatus.textContent='Sem leitura. Protótipo sem conexão ao Codenotch.';
    try { await chrome.runtime.sendMessage({type:'AUTO_ERASE'}); label.textContent='Dados apagados; automático desativado e acesso revogado.'; } catch { label.textContent='Falha ao apagar. Desligue/remova a extensão em edge://extensions.'; }
  });
  document.getElementById('auto-state').addEventListener('click',() => state(false));
  document.getElementById('auto-recheck')?.addEventListener('click',() => runRecheck(++action));
  document.getElementById('auto-diagnostics')?.addEventListener('click',async()=>{
    const diagnostic=document.getElementById('auto-diagnostic-result');
    try {diagnostic.textContent=JSON.stringify(await chrome.runtime.sendMessage({type:'AUTO_DIAGNOSTICS'}),null,2);}
    catch {diagnostic.textContent='diagnostic_unavailable';}
  });
  void state(true); // Only extension preference/snapshot; triggers background recheck if stale.
})();
