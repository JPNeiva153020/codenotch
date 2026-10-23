const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'codenotch/ui/experimental/gemini-web-lab.js'),'utf8');
async function panel(snapshot,read=async()=>{}) {
  const elements=Object.fromEntries(['open','read','enable','disable','clear','exit','status','result',
    'current-used','current-remaining','current-reset','weekly-used','weekly-remaining','weekly-reset']
    .map(id=>[id,{textContent:'',addEventListener(_,fn){this.click=fn;}}]));
  const calls=[];let timer;
  vm.runInNewContext(source,{window:{__TAURI__:{core:{invoke:async(command,args)=>{
    calls.push({command,args});if(command==='lab_status')return {automatic:false,snapshot};if(command==='lab_read')return read();
  }}}},document:{getElementById:id=>elements[id]},setInterval(fn){timer=fn;}});
  await new Promise(setImmediate);
  return {elements,calls,refresh:()=>timer()};
}
test('laboratório abre desativado e consulta somente estado local',async()=>{
  const p=await panel({status:'absent',windows:[]});assert.deepEqual(p.calls.map(c=>c.command),['lab_status','lab_ready']);
  assert.match(p.elements.status.textContent,/desativado/);assert.equal(p.elements['current-used'].textContent,'Indisponível');
  await p.refresh();assert.equal(p.calls.some(c=>c.command==='lab_read'||c.command==='lab_automatic'),false);
});
test('painel mostra percentuais, restante e reset parcial observados',async()=>{
  const p=await panel({status:'ok',windows:[{id:'current',used:.37,reset_detail:'Renovação: 22:11'},{id:'weekly',used:.09,reset_detail:'Renovação: 20/10 às 09:11'}]});
  assert.equal(p.elements['current-used'].textContent,'37%');assert.equal(p.elements['current-remaining'].textContent,'63%');
  assert.equal(p.elements['weekly-used'].textContent,'9%');assert.equal(p.elements['weekly-remaining'].textContent,'91%');
  assert.match(p.elements['current-reset'].textContent,/22:11/);assert.match(p.elements['weekly-reset'].textContent,/20\/10/);
});
test('zero observado é preservado e histórico permanece identificado',async()=>{
  const p=await panel({status:'stale',windows:[{id:'current',used:0}]});
  assert.equal(p.elements['current-used'].textContent,'0%');assert.equal(p.elements['current-remaining'].textContent,'100%');
  assert.match(p.elements.status.textContent,/histórica/);
});
test('percentuais inválidos não viram valores padrão',async()=>{
  const p=await panel({status:'absent',windows:[{id:'current',used:1.5},{id:'weekly',used:null}]});
  for(const id of ['current','weekly']){assert.equal(p.elements[id+'-used'].textContent,'Indisponível');assert.equal(p.elements[id+'-remaining'].textContent,'Indisponível');}
});
test('cliques duplicados não iniciam leituras concorrentes',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const p=await panel({status:'absent',windows:[]},()=>pending);
  const first=p.elements.read.click();await p.elements.read.click();
  assert.equal(p.calls.filter(c=>c.command==='lab_read').length,1);release();await first;
});
