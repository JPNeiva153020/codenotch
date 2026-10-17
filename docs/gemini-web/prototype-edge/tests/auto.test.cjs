'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function policy() {const ctx=vm.createContext({URL,Date});vm.runInContext(code('auto-core.js'),ctx);vm.runInContext(code('auto-controller.js'),ctx);return ctx;}
function sample(){return {provider:'gemini_web',status:'observed',issues:[],observed_at_ms:Date.now(),windows:['current','weekly'].map((id,i)=>({id,status:'observed',issues:[],used_percent:i?6:16,reset:{day:i?20:null,month:i?10:null,year:null,timezone:null,epoch_ms:null,hour:i?9:22,minute:11}}))};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function controller(options={}) {
  const ctx=policy(), queue=new Map(), stableRoot={}; let seq=0, mutated, reads=0, publications=0, disconnected=0, allowed=true, authorization=true, raw=sample();
  const api=ctx.GeminiAutoController.create({allowed:()=>allowed,authorized:async()=>authorization,read:()=>{reads++;return raw;},validate:ctx.GeminiAutoCore.minimal,key:ctx.GeminiAutoCore.fingerprint,publish:async()=>{publications++;return true;},root:()=>stableRoot,observe:(_,changed)=>{mutated=changed;return {disconnect(){disconnected++;}};},later:(fn,delay)=>{const id=++seq;queue.set(id,{fn,delay});return id;},clear:id=>queue.delete(id),...options});
  return {api,queue,get reads(){return reads;},get publications(){return publications;},get disconnected(){return disconnected;},async tick(){const next=queue.entries().next().value;if(next){queue.delete(next[0]);next[1].fn();await flush();}},mutate(){mutated?.();},route(value){allowed=value;},consent(value){authorization=value;},data(value){raw=value;}};
}
test('política aceita somente HTTPS e rota ancorada de limites',()=>{
  const c=policy().GeminiAutoCore;
  assert.equal(c.usageUrl('https://gemini.google.com/u/0/usage'),true);
  for(const url of ['https://gemini.google.com/app','https://gemini.google.com/u/0/usage/chat','https://gemini.google.com/u/abc/usage','http://gemini.google.com/u/0/usage','https://gemini.google.com.evil.invalid/u/0/usage','https://user:pass@gemini.google.com/u/0/usage'])assert.equal(c.usageUrl(url),false);
});
test('snapshot mínimo exclui conta, perfil, URL, notas e dados arbitrários',()=>{
  const c=policy().GeminiAutoCore,r=c.minimal({...sample(),email:'NAO_EXPORTAR',url:'NAO_EXPORTAR',plan:'NAO_EXPORTAR'},1000);
  assert.equal(JSON.stringify(r).includes('NAO_EXPORTAR'),false);assert.equal(r.model,null);assert.equal(r.observed_at_ms,1000);
});
test('snapshot parcial ou percentuais inválidos são rejeitados',()=>{
  const c=policy().GeminiAutoCore;assert.equal(c.minimal({...sample(),status:'partial'}),null);
  const x=sample();x.windows[0].used_percent=101;assert.equal(c.minimal(x),null);
});
test('atualidade é conservadora e retenção expira em 24 horas',()=>{
  const c=policy().GeminiAutoCore,s=c.minimal(sample(),1000);
  assert.equal(c.freshness(s,2000,true),'recent');assert.equal(c.freshness(s,2000,false),'historical');assert.equal(c.freshness(s,400000,true),'historical');assert.equal(c.freshness(s,86402000,true),'unavailable');
});
test('consentimento negado: nenhuma leitura ou observer',async()=>{
  const c=controller();c.consent(false);c.api.start();await c.tick();assert.equal(c.reads,0);assert.equal(c.api.stats.observers,0);
});
test('rota de conversa: nenhuma captura mesmo com consentimento',async()=>{
  const c=controller();c.route(false);c.api.start();await c.tick();assert.equal(c.reads,0);
});
test('navegação direta autorizada captura uma vez e mantém um observer restrito',async()=>{
  const c=controller();c.api.start();await c.tick();assert.equal(c.reads,1);assert.equal(c.publications,1);assert.equal(c.api.stats.observers,1);
});
test('conteúdo ausente: quatro tentativas finitas e encerramento',async()=>{
  const c=controller();c.data(null);c.api.start();for(let i=0;i<6;i++)await c.tick();assert.equal(c.reads,4);assert.equal(c.queue.size,0);assert.equal(c.api.stats.stopped,true);
});
test('debounce agrega centenas de mutações e evita publicação duplicada',async()=>{
  const c=controller();c.api.start();await c.tick();for(let i=0;i<500;i++)c.mutate();assert.equal(c.queue.size,1);assert.equal([...c.queue.values()][0].delay,350);await c.tick();assert.equal(c.reads,2);assert.equal(c.publications,1);
});
test('atualização dos valores produz novo snapshot',async()=>{
  const c=controller();c.api.start();await c.tick();const data=sample();data.windows[0].used_percent=17;c.data(data);c.mutate();await c.tick();assert.equal(c.publications,2);
});
test('saída SPA cancela debounce e desconecta sem ler conversa',async()=>{
  const c=controller();c.api.start();await c.tick();c.mutate();c.route(false);c.mutate();await c.tick();assert.equal(c.reads,1);assert.equal(c.disconnected,1);assert.equal(c.queue.size,0);
});
test('desativação durante consentimento pendente não lê DOM',async()=>{
  let resolve;const c=controller({authorized:()=>new Promise(r=>{resolve=r;})});c.api.start();await c.tick();c.api.stop();resolve(true);await flush();assert.equal(c.reads,0);
});
test('limite de 20 publicações por visita encerra observação',async()=>{
  const c=controller();c.api.start();await c.tick();for(let i=1;i<=21;i++){const data=sample();data.windows[0].used_percent=16+i;c.data(data);c.mutate();await c.tick();}assert.equal(c.publications,20);assert.equal(c.api.stats.stopped,true);assert.equal(c.disconnected,1);
});
test('exceção inesperada encerra controlador sem loop ou log',async()=>{
  const c=controller({read(){throw new Error('erro fictício');}});c.api.start();await c.tick();assert.equal(c.api.stats.stopped,true);assert.equal(c.queue.size,0);
});
function event(){const list=[];return {addListener(fn,filter){list.push({fn,filter});},removeListener(fn){const i=list.findIndex(x=>x.fn===fn);if(i>=0)list.splice(i,1);},hasListener:fn=>list.some(x=>x.fn===fn),list};}
function worker(data={}) {
  let granted=false,storageGranted=false;const injections=[],sent=[],reloaded=[],created=[],otherTabs=[];const badge={text:null,color:null};const events={added:event(),removed:event(),complete:event(),spa:event(),messages:event()};
  const tab={id:1,url:'https://gemini.google.com/u/0/usage'};
  const chrome={action:{setBadgeText:async({text})=>{badge.text=text;},setBadgeBackgroundColor:async({color})=>{badge.color=color;}},permissions:{contains:async p=>(!p.permissions?.includes('storage')||storageGranted)&&(!p.permissions?.includes('webNavigation')&&!p.origins?.length||granted),remove:async p=>{granted=false;if(p.permissions?.includes('storage'))storageGranted=false;return true;},onAdded:events.added,onRemoved:events.removed},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async x=>Object.assign(data,x),remove:async k=>{delete data[k];},clear:async()=>{for(const k of Object.keys(data))delete data[k];},setAccessLevel:async()=>{}}},tabs:{get:async id=>{const found=[tab,...otherTabs].find(t=>t.id===id);return {...(found||tab)};},query:async q=>q?.active?[{...tab}]:[{...tab},...otherTabs],reload:async id=>{reloaded.push(id);},create:async opts=>{const t={id:99,...opts};created.push(t);otherTabs.push(t);return t;},sendMessage:async(id,m)=>sent.push(m),onRemoved:event(),onActivated:event()},scripting:{executeScript:async x=>injections.push(x)},webNavigation:{onCompleted:events.complete,onHistoryStateUpdated:events.spa},runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:events.messages}};
  const ctx=vm.createContext({URL,Date,chrome,Set,Promise,setTimeout:fn=>setTimeout(fn,20),clearTimeout});ctx.importScripts=filename=>vm.runInContext(code(filename),ctx);vm.runInContext(code('auto-worker.js'),ctx);
  const popup={id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')};
  const message=(m,sender=popup)=>new Promise(resolve=>{const accepted=events.messages.list[0].fn(m,sender,resolve);if(!accepted)resolve(null);});
  return {data,tab,otherTabs,reloaded,created,badge,events,chrome,injections,sent,message,grant(){granted=true;storageGranted=true;},get granted(){return granted;}};
}
test('worker desativado por padrão não injeta nem persiste',async()=>{
  const w=worker();await w.events.complete.list[0].fn({frameId:0,tabId:1,url:w.tab.url});assert.equal(w.injections.length,0);assert.equal(Object.keys(w.data).length,0);
});
test('worker habilita só após concessão e registra preferência mínima',async()=>{
  const w=worker();assert.equal((await w.message({type:'AUTO_ENABLE'})).enabled,false);w.grant();assert.equal((await w.message({type:'AUTO_ENABLE'})).enabled,true);await flush();assert.equal(w.injections.length,1);assert.equal(w.data.autoEnabled,true);
});
test('evento SPA lê somente rota autorizada; saída envia STOP sem nova injeção',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});await flush();w.tab.url='https://gemini.google.com/app';await w.events.spa.list[0].fn({frameId:0,tabId:1,url:w.tab.url});assert.equal(w.injections.length,1);assert.equal(w.sent[0].type,'AUTO_STOP');w.tab.url='https://gemini.google.com/u/0/usage';await w.events.spa.list[0].fn({frameId:0,tabId:1,url:w.tab.url});assert.equal(w.injections.length,2);
});
test('saída de rota envia cancelamento mesmo sem memória de sessão no worker',async()=>{
  const w=worker();w.grant();w.data.autoEnabled=true;w.tab.url='https://gemini.google.com/app';await w.events.spa.list[0].fn({frameId:0,tabId:1,url:w.tab.url});assert.equal(w.sent[0].type,'AUTO_STOP');assert.equal(w.injections.length,0);
});
test('mensagem de conversa e remetente externo não gravam snapshot',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});const m={type:'AUTO_SNAPSHOT',snapshot:sample()};await w.message(m,{id:'external',url:w.tab.url,tab:{id:1}});await w.message(m,{id:'test-extension',url:'https://gemini.google.com/app',tab:{id:1}});assert.equal(w.data.lastSnapshot,undefined);
});
test('snapshot validado é armazenado sem URL/perfil; apagar remove tudo e revoga',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});await w.message({type:'AUTO_SNAPSHOT',snapshot:{...sample(),url:'NAO_EXPORTAR'}},{id:'test-extension',url:w.tab.url,tab:{id:1}});assert.equal(JSON.stringify(w.data).includes('NAO_EXPORTAR'),false);assert.equal(w.data.lastSnapshot.windows.length,2);await w.message({type:'AUTO_ERASE'});assert.equal(Object.keys(w.data).length,0);assert.equal(w.granted,false);
});
test('desativação impede mensagens seguintes e revoga permissões',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});await w.message({type:'AUTO_DISABLE'});const r=await w.message({type:'AUTO_SNAPSHOT',snapshot:sample()},{id:'test-extension',url:w.tab.url,tab:{id:1}});assert.equal(r.accepted,false);assert.equal(w.data.autoEnabled,false);assert.equal(w.granted,false);
});
test('desativação invalida snapshot já enfileirado antes de gravar',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});const pending=w.message({type:'AUTO_SNAPSHOT',snapshot:sample()},{id:'test-extension',url:w.tab.url,tab:{id:1}});const off=w.message({type:'AUTO_DISABLE'});assert.equal((await pending).accepted,false);await off;assert.equal(w.data.lastSnapshot,undefined);
});
test('desativado conserva acesso apenas ao último histórico até apagar',async()=>{
  const w=worker();w.grant();await w.message({type:'AUTO_ENABLE'});await w.message({type:'AUTO_SNAPSHOT',snapshot:sample()},{id:'test-extension',url:w.tab.url,tab:{id:1}});await w.message({type:'AUTO_DISABLE'});w.tab.url='https://gemini.google.com/app';const r=await w.message({type:'AUTO_STATE'});assert.equal(r.enabled,false);assert.equal(r.freshness,'historical');assert.equal(r.snapshot.windows[0].used_percent,16);
});
test('configuração mínima: opcionais sem content scripts permanentes',()=>{
  const m=JSON.parse(code('manifest.json'));assert.deepEqual(m.permissions,['activeTab','scripting']);assert.deepEqual(m.optional_permissions,['storage','webNavigation']);assert.equal(m.host_permissions,undefined);assert.equal(m.content_scripts,undefined);
});
test('novos scripts sem rede, cookies, tokens, código remoto ou logs',()=>{
  for(const file of ['auto-core.js','auto-controller.js','auto-content.js','auto-worker.js','auto-popup.js']){
    const text=code(file);new vm.Script(text);assert.doesNotMatch(text,/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|eval)\s*\(|document\.cookie|localStorage|sessionStorage|console\.|new\s+Function\b/);
  }
});
function autoPopup(granted) {
  const elements=Object.fromEntries(['auto-result','auto-status','auto-enable','auto-disable','auto-erase','auto-state','auto-recheck'].map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));
  const ctx=policy();let requests=0;const messages=[];
  ctx.document={getElementById:id=>elements[id]};ctx.chrome={permissions:{request:async()=>{requests++;return granted;},remove:async()=>true},runtime:{sendMessage:async m=>{messages.push(m.type);return {enabled:false,freshness:'unavailable',snapshot:null};}}};
  vm.runInContext(code('auto-popup.js'),ctx);return {elements,messages,get requests(){return requests;}};
}
test('popup abrir não pede permissões; consentimento negado não habilita',async()=>{
  const p=autoPopup(false);await flush();assert.equal(p.requests,0);await p.elements['auto-enable'].click();assert.equal(p.requests,1);assert.equal(p.messages.includes('AUTO_ENABLE'),false);
});
test('popup habilita só por clique, oferece apagar e desativar',async()=>{
  const p=autoPopup(true);await flush();await p.elements['auto-enable'].click();assert.equal(p.messages.includes('AUTO_ENABLE'),true);await p.elements['auto-disable'].click();await p.elements['auto-erase'].click();assert.equal(p.messages.includes('AUTO_DISABLE'),true);assert.equal(p.messages.includes('AUTO_ERASE'),true);
});

test('worker novo retoma pela preferência persistida sem AUTO_ENABLE',async()=>{
  const first=worker();first.grant();await first.message({type:'AUTO_ENABLE'});await flush();
  const next=worker(first.data);next.grant();
  await next.events.spa.list[0].fn({frameId:0,tabId:1,url:next.tab.url});
  assert.equal(next.injections.length,1);assert.equal(next.data.autoEnabled,true);
});

test('retorno de aba ativa reinjeta usando consentimento já existente',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  await w.chrome.tabs.onActivated.list[0].fn({tabId:1});
  assert.equal(w.injections.length,1);
});

test('navegações concorrentes descartam tentativa anterior da mesma aba',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  await Promise.all([w.events.complete.list[0].fn({frameId:0,tabId:1,url:w.tab.url}),w.events.spa.list[0].fn({frameId:0,tabId:1,url:w.tab.url})]);
  assert.equal(w.injections.length,1);
});

test('reverificar por gesto não pede nem muda permissões e fora de /usage usa aba em 2º plano sem injetar no chat',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  assert.equal((await w.message({type:'AUTO_RECHECK'})).requested,true);
  assert.equal(w.injections.length,1);assert.equal(w.granted,true);
  w.tab.url='https://gemini.google.com/u/2/app';
  const r=await w.message({type:'AUTO_RECHECK'});
  assert.equal(r.requested,true);
  assert.equal(w.injections.length,1);
  assert.equal(w.created.length,1);
  assert.equal(w.created[0].url,'https://gemini.google.com/u/2/usage');
  assert.equal(w.created[0].active,false);
});

test('reverificar sem consentimento não injeta nem cria preferência',async()=>{
  const w=worker();assert.equal((await w.message({type:'AUTO_RECHECK'})).requested,false);
  assert.equal(w.injections.length,0);assert.equal(Object.keys(w.data).length,0);
});

test('reverificação enfileirada com desativação não permite nova captura autorizada',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  const read=w.message({type:'AUTO_RECHECK'}),off=w.message({type:'AUTO_DISABLE'});
  await read;await off;
  const check=await w.message({type:'AUTO_CHECK'},{id:'test-extension',url:w.tab.url,tab:{id:1}});
  assert.equal(check.enabled,false);assert.equal(w.data.autoEnabled,false);
});

test('popup reverificar só envia pedido por clique sem solicitar consentimento',async()=>{
  const p=autoPopup(false);await flush();
  assert.equal(p.messages.includes('AUTO_RECHECK'),false);
  await p.elements['auto-recheck'].click();
  assert.equal(p.requests,0);assert.equal(p.messages.includes('AUTO_RECHECK'),true);
});

test('contêiner ausente mesmo com snapshot válido tem tentativas limitadas',async()=>{
  const c=controller({root:()=>null});c.api.start();for(let i=0;i<6;i++)await c.tick();
  assert.equal(c.reads,4);assert.equal(c.publications,0);assert.equal(c.queue.size,0);
});

test('worker preserva instante da captura em vez de substituir pelo recebimento',async()=>{
  const w=worker({autoEnabled:true});w.grant();const snapshot=sample();snapshot.observed_at_ms=Date.now()-5000;
  const sender={id:'test-extension',url:w.tab.url,tab:{id:1}};
  assert.equal((await w.message({type:'AUTO_SNAPSHOT',snapshot},sender)).accepted,true);
  assert.equal(w.data.lastSnapshot.observed_at_ms,snapshot.observed_at_ms);
  const invalid={...snapshot,observed_at_ms:Date.now()+120000};
  assert.equal((await w.message({type:'AUTO_SNAPSHOT',snapshot:invalid},sender)).accepted,false);
});

test('diagnóstico do controlador distingue leitura de rejeição pelo worker',async()=>{
  const c=controller({publish:async()=>({accepted:false,code:'worker_rejected'})});c.api.start();await c.tick();assert.equal(c.reads,1);assert.equal(c.api.stats.last_code,'worker_rejected');assert.equal(c.api.stats.publications,0);
});

test('badge atualiza texto e cor por faixa (<50 verde, 50..79 âmbar, >=80 vermelho) e limpa ao expirar ou apagar',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  const sender={id:'test-extension',url:w.tab.url,tab:{id:1}};
  let t=Date.now()-10000;
  for(const [pct,expectedColor] of [[24,'#16a34a'],[50,'#d97706'],[79,'#d97706'],[80,'#dc2626']]){
    const snap=sample();snap.observed_at_ms=(t+=1000);snap.windows[0].used_percent=pct;
    assert.equal((await w.message({type:'AUTO_SNAPSHOT',snapshot:snap},sender)).accepted,true);
    assert.equal(w.badge.text,`${pct}%`);assert.equal(w.badge.color,expectedColor);
  }
  w.data.lastSnapshot.observed_at_ms=Date.now()-86400001;
  const state=await w.message({type:'AUTO_STATE'});
  assert.equal(state.freshness,'unavailable');assert.equal(w.badge.text,'');
  const fresh=sample();fresh.observed_at_ms=Date.now();fresh.windows[0].used_percent=48;
  await w.message({type:'AUTO_SNAPSHOT',snapshot:fresh},sender);
  assert.equal(w.badge.text,'48%');assert.equal(w.badge.color,'#16a34a');
  await w.message({type:'AUTO_ERASE'});
  assert.equal(w.badge.text,'');
});

test('AUTO_RECHECK em conversa localiza e recarrega aba /usage existente em 2º plano e confirma publicação',async()=>{
  const w=worker({autoEnabled:true});w.grant();
  w.tab.url='https://gemini.google.com/u/0/app';
  const bgTab={id:42,url:'https://gemini.google.com/u/0/usage'};
  w.otherTabs.push(bgTab);
  const pending=w.message({type:'AUTO_RECHECK'});
  await flush();
  assert.deepEqual(w.reloaded,[42]);assert.equal(w.created.length,0);assert.equal(w.injections.length,0);
  const snap=sample();snap.observed_at_ms=Date.now();snap.windows[0].used_percent=62;
  await w.message({type:'AUTO_SNAPSHOT',snapshot:snap},{id:'test-extension',url:bgTab.url,tab:{id:42}});
  const result=await pending;
  assert.equal(result.confirmed,true);assert.equal(result.code,'updated');assert.equal(w.badge.text,'62%');assert.equal(w.badge.color,'#d97706');
});

