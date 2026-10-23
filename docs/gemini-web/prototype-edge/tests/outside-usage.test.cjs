'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function snapshot(){return {schema_version:1,provider:'gemini_web',origin:'visible_ui',collection:'dom_on_authorized_usage',status:'observed',observed_at_ms:Date.now()-500242,issues:[],windows:['current','weekly'].map((id,i)=>({id,status:'observed',used_percent:i?10:24,remaining_percent:i?90:76,reset:{day:i?20:null,month:i?10:null,year:null,hour:i?9:13,minute:11,timezone:null,epoch_ms:null,needs_confirmation:true},issues:[]}))};}
async function manual(saved,url='https://gemini.google.com/app'){
  let injected=0,requests=0;const els=Object.fromEntries(['read','clear','result','status'].map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));
  const ctx=vm.createContext({URL,Date,Intl,document:{getElementById:id=>els[id]},chrome:{tabs:{query:async()=>[{id:1,url}]},runtime:{sendMessage:async msg=>{requests++;assert.equal(msg.type,'AUTO_STATE');return {snapshot:saved,freshness:saved?'historical':'unavailable'};}},scripting:{executeScript:async()=>{injected++;throw new Error('leitura fora da rota');}}}});
  vm.runInContext(source('auto-core.js'),ctx);vm.runInContext(source('popup.js'),ctx);assert.equal(requests,0);await els.read.click();return {els,injected,requests};
}
test('manual em conversa exibe somente histórico com timestamp original, preserva reset parcial e não injeta',async()=>{
  const saved=snapshot(),before=JSON.stringify(saved);const r=await manual(saved);assert.equal(r.injected,0);const output=JSON.parse(r.els.result.textContent);assert.equal(output.status,'historical');assert.equal(output.observed_at_ms,saved.observed_at_ms);assert.deepEqual(output.windows.map(w=>w.used_percent),[24,10]);assert.equal(output.windows[0].reset.epoch_ms,null);assert.equal(output.windows[1].reset.epoch_ms,null);assert.equal(JSON.stringify(saved),before);assert.match(r.els.status.textContent,/Dados atuais indisponíveis.*histórica/u);
});
test('manual em outra aba consulta histórico sem enumerar ou acessar outras abas',async()=>{
  const r=await manual(snapshot(),'https://example.invalid/');assert.equal(r.injected,0);assert.equal(r.requests,1);assert.equal(JSON.parse(r.els.result.textContent).status,'historical');
});
test('manual sem cache não inventa valores e orienta abrir limites',async()=>{
  const r=await manual(null);assert.equal(r.injected,0);assert.equal(r.els.result.textContent,'');assert.match(r.els.status.textContent,/Abra Limites de uso/u);
});
test('cache expirado ou sem horário não vira leitura atual',async()=>{
  for(const kind of ['expired','missing']){const saved=snapshot();if(kind==='expired')saved.observed_at_ms=Date.now()-86400001;else delete saved.observed_at_ms;const r=await manual(saved);assert.equal(r.injected,0);assert.equal(r.els.result.textContent,'');}
});
test('não aceita quota de outro provedor ou origem API como Gemini Web visível',async()=>{
  for(const kind of ['provider','origin']){const saved=snapshot();saved[kind]=kind==='provider'?'gemini_api':'documented_api';const r=await manual(saved);assert.equal(r.injected,0);assert.equal(r.els.result.textContent,'');}
});

async function recheckPopup(response){
  const ids=['auto-result','auto-status','auto-enable','auto-disable','auto-erase','auto-state','auto-recheck'];
  const els=Object.fromEntries(ids.map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));let grants=0;
  const ctx=vm.createContext({document:{getElementById:id=>els[id]},chrome:{permissions:{request:async()=>{grants++;return false;}},runtime:{sendMessage:async msg=>msg.type==='AUTO_RECHECK'?response:{enabled:true,freshness:'historical',snapshot:snapshot()}}}});
  vm.runInContext(source('auto-popup.js'),ctx);await new Promise(r=>setImmediate(r));await els['auto-recheck'].click();return {els,grants};
}
test('popup não anuncia sucesso para ACK sem snapshot confirmado',async()=>{
  const p=await recheckPopup({requested:true,confirmed:false,code:'no_observation'});assert.match(p.els['auto-status'].textContent,/nenhuma nova leitura foi confirmada/u);assert.equal(p.grants,0);
});
test('popup distingue leitura persistida sem mudança de atualização de valores',async()=>{
  const p=await recheckPopup({requested:true,confirmed:true,code:'unchanged'});assert.match(p.els['auto-status'].textContent,/valores iguais.*não comprova/u);assert.equal(JSON.parse(p.els['auto-result'].textContent).status,'historical');assert.equal(p.grants,0);
});
test('popup anuncia nova leitura somente após confirmação de persistência',async()=>{
  const p=await recheckPopup({requested:true,confirmed:true,code:'updated'});assert.match(p.els['auto-status'].textContent,/confirmada e persistida/u);assert.equal(p.grants,0);
});

test('resposta histórica atrasada não restaura resultado depois de apagar',async()=>{
  const ids=['auto-result','auto-status','auto-enable','auto-disable','auto-erase','auto-state','auto-recheck'];const els=Object.fromEntries(ids.map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));let resolveState;
  const ctx=vm.createContext({document:{getElementById:id=>els[id]},chrome:{runtime:{sendMessage:async msg=>msg.type==='AUTO_STATE'?new Promise(resolve=>{resolveState=resolve;}):{} }}});
  vm.runInContext(source('auto-popup.js'),ctx);await els['auto-erase'].click();resolveState({enabled:true,freshness:'historical',snapshot:snapshot()});await new Promise(r=>setImmediate(r));assert.equal(els['auto-result'].textContent,'');assert.match(els['auto-status'].textContent,/Dados apagados/u);
});

async function openUsageClick(url, rememberedUrl=null){
  let injected=0;const created=[];
  const els=Object.fromEntries(['read','clear','open-usage','result','status'].map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));
  const ctx=vm.createContext({URL,Date,Intl,document:{getElementById:id=>els[id]},chrome:{tabs:{query:async()=>url===undefined?[]:[{id:1,url}],create:async opts=>{created.push(opts.url);}},runtime:{sendMessage:async msg=>msg?.type==='AUTO_STATE'?{lastKnownUsageUrl:rememberedUrl}:{}},scripting:{executeScript:async()=>{injected++;}}}});
  vm.runInContext(source('popup.js'),ctx);await els['open-usage'].click();return {created,injected};
}
test('atalho #open-usage em conversa /u/2/app abre https://gemini.google.com/u/2/usage?pageId=none sem injeção',async()=>{
  const r=await openUsageClick('https://gemini.google.com/u/2/app');
  assert.deepEqual(r.created,['https://gemini.google.com/u/2/usage?pageId=none']);assert.equal(r.injected,0);
});
test('atalho #open-usage fora de /u/<digitos>/, em /u/0/ ou em URL inválida prioriza /u/1/usage?pageId=none sem open redirect',async()=>{
  for(const url of ['https://gemini.google.com/app','https://gemini.google.com/u/0/app','https://gemini.google.com/u/abc/app','https://user:pass@gemini.google.com/u/2/app','https://gemini.google.com.evil.invalid/u/2/app','http://gemini.google.com/u/2/app','javascript:alert(1)',undefined]){
    const r=await openUsageClick(url);
    assert.deepEqual(r.created,['https://gemini.google.com/u/1/usage?pageId=none']);assert.equal(r.injected,0);
  }
});
test('popup.html inclui atalho #open-usage, botão #auto-recheck em 2º plano e mantém #auto-diagnostics hidden por padrão',()=>{
  const html=source('popup.html');
  assert.match(html,/<button id="open-usage" type="button">Abrir Limites de uso \(\/usage\)<\/button>/u);
  assert.match(html,/<button id="auto-recheck">Atualizar em 2º plano \(Reverificar\)<\/button>/u);
  assert.match(html,/<button id="auto-diagnostics"\s+hidden>Diagnóstico local \(experimental\)<\/button>/u);
});

