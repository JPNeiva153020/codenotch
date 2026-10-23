'use strict';
const invoke = window.__TAURI__.core.invoke;
let busy = false;
let ready = false;
const percent = value => Number.isFinite(value) && value >= 0 && value <= 1
  ? new Intl.NumberFormat('pt-BR', {maximumFractionDigits:2}).format(100 * value) + '%'
  : 'Indisponível';
async function refresh() {
  if (busy) return;
  try {
    const state = await invoke('lab_status');
    const snapshot = state.snapshot;
    document.getElementById('status').textContent =
      (state.automatic ? 'Automático ativado. ' : 'Automático desativado. ') +
      (snapshot.status === 'ok' ? 'Observação recente; pode ter mudado.' :
       snapshot.status === 'stale' ? 'Observação histórica.' : 'Observação indisponível.');
    for (const id of ['current','weekly']) {
      const entry = snapshot.windows?.find(w => w.id === id);
      document.getElementById(id+'-used').textContent = percent(entry?.used);
      document.getElementById(id+'-remaining').textContent = Number.isFinite(entry?.used)
        && entry.used >= 0 && entry.used <= 1 ? percent(1-entry.used) : 'Indisponível';
      document.getElementById(id+'-reset').textContent = entry?.reset_detail || 'Renovação indisponível';
    }
    document.getElementById('result').textContent = JSON.stringify(snapshot, null, 2);
    if (!ready) { await invoke('lab_ready'); ready = true; }
  } catch { document.getElementById('status').textContent = 'Estado indisponível.'; }
}
for (const [id, command, parameters] of [
  ['open','lab_open_usage',{}],['read','lab_read',{}],
  ['enable','lab_automatic',{enabled:true}],['disable','lab_automatic',{enabled:false}],
  ['clear','lab_clear',{}],['exit','lab_exit',{}]]) {
  document.getElementById(id).addEventListener('click', async () => {
    if (busy) return; busy = true;
    try { await invoke(command,parameters); }
    catch { document.getElementById('status').textContent='Ação indisponível.'; }
    finally { busy=false; await refresh(); }
  });
}
refresh();
// Only local status refresh; this timer never starts a quota collection.
setInterval(refresh,2000);
