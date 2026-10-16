'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require(process.env.GEMINI_TEST_PLAYWRIGHT||'playwright');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/limits-fragmented-pt.html'),'utf8').replace('16%','24%').replace('<strong>6</strong>','<strong>10</strong>');
const event=()=>{const listeners=[];return {listeners,addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},hasListener:fn=>listeners.includes(fn)};};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.GEMINI_TEST_BROWSER,headless:true,chromiumSandbox:true});});
after(async()=>{await browser?.close();});
async function pipeline(run,{start=true}={}) {
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({status:200,contentType:'text/html',body:fixture}):route.abort());
  try {
    const page=await context.newPage();await page.goto('https://gemini.google.com/u/0/usage');
    await page.evaluate(()=>{
      window.fixtureReads=0;window.fixtureVisibleState='visible';
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixtureVisibleState});
      const listeners=[];
      window.chrome={runtime:{sendMessage:msg=>window.fixtureRuntime(msg),onMessage:{addListener:fn=>listeners.push(fn),removeListener:fn=>{const at=listeners.indexOf(fn);if(at>=0)listeners.splice(at,1);}}}};
      window.fixtureReceive=msg=>{let response;for(const fn of listeners.slice())fn(msg,null,value=>{response=value;});return response;};
      window.fixtureVisibility=value=>{fixtureVisibleState=value?'visible':'hidden';document.dispatchEvent(new Event('visibilitychange'));};
    });
    const data={autoEnabled:true};let failStorage=false,held=null,holdNext=false,currentWorker,injections=0,skipInjection=false;
    function worker() {
      const messages=event(),complete=event(),spa=event();
      const chrome={runtime:{id:'fixture-extension',getURL:p=>'chrome-extension://fixture-extension/'+p,onMessage:messages},
        permissions:{contains:async()=>data.autoEnabled===true,remove:async()=>true,onAdded:event(),onRemoved:event()},
        storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async value=>{if(failStorage&&value.lastSnapshot)throw new Error('PRIVATE_EXCEPTION');Object.assign(data,structuredClone(value));},setAccessLevel:async()=>{},remove:async k=>{delete data[k];},clear:async()=>{for(const k of Object.keys(data))delete data[k];}}},
        tabs:{get:async()=>({id:1,url:page.url()}),query:async()=>[{id:1,url:page.url()}],onRemoved:event(),onActivated:event(),sendMessage:async(_,msg)=>{if(holdNext&&msg.type==='AUTO_STOP'){holdNext=false;await new Promise(resolve=>{held=resolve;});}return page.evaluate(msg=>fixtureReceive(msg),msg);}},
        webNavigation:{onCompleted:complete,onHistoryStateUpdated:spa,getFrame:async()=>({documentId:'fixture-document'})},
        scripting:{executeScript:async options=>{injections++;if(skipInjection)return;for(const file of options.files){await page.addScriptTag({content:source(file)});if(file==='extractor.js')await page.evaluate(()=>{const old=CodenotchGeminiQuotaPrototype;window.CodenotchGeminiQuotaPrototype={...old,extract(){fixtureReads++;return old.extract();}};});}}}};
      const ctx=vm.createContext({URL,Date,chrome,Set,Map,Promise,setTimeout,clearTimeout});ctx.importScripts=file=>vm.runInContext(source(file),ctx);vm.runInContext(source('auto-worker.js'),ctx);
      const send=(msg,popup=false)=>new Promise(resolve=>{const sender=popup?{id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')}:{id:chrome.runtime.id,url:page.url(),frameId:0,documentId:'fixture-document',tab:{id:1}};if(!messages.listeners[0](msg,sender,resolve))resolve(null);});
      return {send,navigate:()=>complete.listeners[0]({frameId:0,tabId:1,url:page.url()})};
    }
    currentWorker=worker();await page.exposeFunction('fixtureRuntime',msg=>currentWorker.send(msg));
    const api={page,data,get worker(){return currentWorker;},get injections(){return injections;},hold(){holdNext=true;},get held(){return held;},release(){held?.();held=null;},fail(value){failStorage=value;},skip(value){skipInjection=value;},restart(){currentWorker=worker();},async values(current,weekly){await page.evaluate(([c,w])=>{document.querySelector('.current strong').textContent='Quantidade usada: '+c+'%';document.querySelector('.percent strong').textContent=String(w);},[current,weekly]);},async wait(current,weekly){const until=Date.now()+2500;while(Date.now()<until){if(data.lastSnapshot?.windows[0].used_percent===current&&data.lastSnapshot?.windows[1].used_percent===weekly)return;await delay(25);}assert.fail('snapshot mínimo não persistiu os valores esperados');}};
    if(start){await currentWorker.navigate();await api.wait(24,10);}
    await run(api);
  } finally {await context.close();}
}

test('pipeline completo: DOM 24/10 muda para 48/12 sem URL, reload ou clique',async()=>{
  await pipeline(async p=>{const stamp=p.data.lastSnapshot.observed_at_ms;await p.values(48,12);await p.wait(48,12);assert.ok(p.data.lastSnapshot.observed_at_ms>stamp);});
});

test('STOP atrasado de navegação antiga não mata a sessão mais nova',async()=>{
  await pipeline(async p=>{
    p.hold();const old=p.worker.navigate();while(!p.held)await delay(5);
    const newer=p.worker.navigate();await Promise.race([newer,delay(500)]);p.release();await Promise.all([old,newer]);
    await delay(100);await p.values(48,12);await p.wait(48,12);
  });
});

test('publicação antiga atrasada não sobrescreve snapshot mais novo',async()=>{
  await pipeline(async p=>{
    const newer=structuredClone(p.data.lastSnapshot);newer.observed_at_ms=Date.now();newer.windows[0].used_percent=48;newer.windows[0].remaining_percent=52;
    assert.equal((await p.worker.send({type:'AUTO_SNAPSHOT',snapshot:newer})).accepted,true);
    const older=structuredClone(newer);older.observed_at_ms-=1000;older.windows[0].used_percent=24;older.windows[0].remaining_percent=76;
    assert.equal((await p.worker.send({type:'AUTO_SNAPSHOT',snapshot:older})).accepted,false);
    assert.equal(p.data.lastSnapshot.windows[0].used_percent,48);
  });
});

test('DOM atualizado antes de reinjetar é persistido e Reverificar confirma commit',async()=>{
  await pipeline(async p=>{await p.values(48,12);const r=await p.worker.send({type:'AUTO_RECHECK'},true);assert.equal(r.confirmed,true);await p.wait(48,12);});
});

test('Reverificar sem mudança confirma leitura, preserva números e declara unchanged',async()=>{
  await pipeline(async p=>{const old=p.data.lastSnapshot.observed_at_ms;await delay(10);const r=await p.worker.send({type:'AUTO_RECHECK'},true);assert.equal(r.confirmed,true);assert.equal(r.code,'unchanged');assert.ok(p.data.lastSnapshot.observed_at_ms>old);await p.wait(24,10);});
});

test('ACK de execução sem publicação nunca é confirmação de nova leitura',async()=>{
  await pipeline(async p=>{const old=structuredClone(p.data.lastSnapshot);p.skip(true);const r=await p.worker.send({type:'AUTO_RECHECK'},true);assert.equal(r.requested,true);assert.equal(r.confirmed,false);assert.equal(r.code,'no_observation');assert.deepEqual(p.data.lastSnapshot,old);});
});

test('falha de storage mantém snapshot anterior e aparece no diagnóstico e Reverificar',async()=>{
  await pipeline(async p=>{const old=structuredClone(p.data.lastSnapshot);p.fail(true);await p.values(48,12);const r=await p.worker.send({type:'AUTO_RECHECK'},true);assert.equal(r.confirmed,false);assert.equal(r.code,'storage_failed');assert.deepEqual(p.data.lastSnapshot,old);const d=await p.worker.send({type:'AUTO_DIAGNOSTICS'},true);assert.equal(d.worker.last_code,'storage_failed');assert.equal(JSON.stringify(d).includes('PRIVATE_EXCEPTION'),false);});
});

test('worker recriado acorda por leitura e preserva atualização visível',async()=>{
  await pipeline(async p=>{p.restart();await p.values(48,12);await p.wait(48,12);});
});

test('ciclo SPA conversa-usage-conversa-usage não lê em conversa',async()=>{
  await pipeline(async p=>{
    for(const value of [35,48]){
      await p.page.evaluate(()=>history.pushState({},'', '/app'));await p.worker.navigate();
      const reads=await p.page.evaluate(()=>fixtureReads);await p.values(value,12);await delay(400);assert.equal(await p.page.evaluate(()=>fixtureReads),reads);
      await p.page.evaluate(()=>history.pushState({},'', '/u/0/usage'));await p.worker.navigate();await p.wait(value,12);
    }
  });
});

test('revogação durante Reverificar cancela espera sem snapshot novo',async()=>{
  await pipeline(async p=>{p.skip(true);const old=structuredClone(p.data.lastSnapshot);const pending=p.worker.send({type:'AUTO_RECHECK'},true);await delay(30);await p.worker.send({type:'AUTO_DISABLE'},true);const r=await pending;assert.equal(r.confirmed,false);assert.deepEqual(p.data.lastSnapshot,old);});
});

test('diagnóstico distingue ausência de evento, leitura inválida e listener ausente',async()=>{
  await pipeline(async p=>{
    const first=await p.worker.send({type:'AUTO_DIAGNOSTICS'},true);assert.equal(first.content.listener_active,true);assert.equal(first.content.events,0);
    await p.page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: inválido';});await delay(500);
    const invalid=await p.worker.send({type:'AUTO_DIAGNOSTICS'},true);assert.ok(invalid.content.invalid_readings>0);assert.equal(invalid.content.last_code,'invalid_reading');
    await p.page.evaluate(()=>fixtureReceive({type:'AUTO_STOP'}));const missing=await p.worker.send({type:'AUTO_DIAGNOSTICS'},true);assert.equal(missing.content.last_code,'listener_absent');
  });
});

test('cache sem timestamp não é rejuvenescido por consulta AUTO_STATE',async()=>{
  await pipeline(async p=>{delete p.data.lastSnapshot.observed_at_ms;const r=await p.worker.send({type:'AUTO_STATE'},true);assert.equal(r.snapshot,null);assert.equal(r.freshness,'unavailable');});
});

test('dois pedidos de Reverificar não deixam tentativa obsoleta cancelar a nova',async()=>{
  await pipeline(async p=>{await p.values(48,12);const first=p.worker.send({type:'AUTO_RECHECK'},true),next=p.worker.send({type:'AUTO_RECHECK'},true);const results=await Promise.all([first,next]);assert.equal(results[0].confirmed,false);assert.equal(results[1].confirmed,true);await p.wait(48,12);});
});
