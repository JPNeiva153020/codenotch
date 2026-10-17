'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.GEMINI_TEST_PLAYWRIGHT||'playwright');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/limits-fragmented-pt.html'),'utf8');
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.GEMINI_TEST_BROWSER,headless:true,chromiumSandbox:true});});
after(async()=>{await browser?.close();});
async function withPage(run,{url='https://gemini.google.com/u/0/usage',consent=true}={}) {
  const context=await browser.newContext({timezoneId:'America/Fortaleza'});
  await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({status:200,contentType:'text/html',body:fixture}):route.abort());
  try {
    const page=await context.newPage();await page.goto(url);
    for(const name of ['auto-core.js','extractor.js','auto-controller.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..',name),'utf8')});
    await page.evaluate(consent=>{
      window.fixtureState={enabled:consent,reads:0,published:0,messages:[]};
      window.fixtureVisibility='visible';
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixtureVisibility});
      window.fixtureVisible=value=>{fixtureVisibility=value?'visible':'hidden';document.dispatchEvent(new Event('visibilitychange'));};
      const listeners=[];
      window.chrome={runtime:{async sendMessage(message){if(message.type==='AUTO_CHECK')return {enabled:fixtureState.enabled};if(message.type==='AUTO_SNAPSHOT'){fixtureState.published++;fixtureState.snapshot=message.snapshot;return {accepted:fixtureState.enabled};}},onMessage:{addListener(fn){listeners.push(fn);},removeListener(fn){const at=listeners.indexOf(fn);if(at>=0)listeners.splice(at,1);}}}};
      window.fixtureStop=()=>listeners.slice().forEach(fn=>fn({type:'AUTO_STOP'}));
      const original=CodenotchGeminiQuotaPrototype;
      window.CodenotchGeminiQuotaPrototype={...original,extract(){fixtureState.reads++;return original.extract();}};
    },consent);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../auto-content.js'),'utf8')});
    await run(page,context);
  } finally {await context.close();}
}
test('DOM real de fixture: automático direto, atualização e ausência de leitura na sidebar',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    const before=await page.evaluate(()=>fixtureState.reads);
    await page.evaluate(()=>{document.querySelector('aside p').textContent='Texto lateral sintético alterado';});
    await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>fixtureState.reads),before);
    await page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: 17%';});
    await page.waitForFunction(()=>fixtureState.published===2);assert.equal(await page.evaluate(()=>fixtureState.snapshot.windows[0].used_percent),17);
  });
});
test('DOM fixture com conversa na URL nunca chama extrator',async()=>{
  await withPage(async page=>{await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>fixtureState.reads),0);},{url:'https://gemini.google.com/app'});
});
test('DOM fixture: consentimento negado não examina indicadores',async()=>{
  await withPage(async page=>{await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>fixtureState.reads),0);},{consent:false});
});
test('DOM fixture: saída SPA e desativação cancelam observer e debounce',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: 18%';history.pushState({},'', '/app');fixtureState.enabled=false;fixtureStop();});
    await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>fixtureState.reads),1);
  });
});
test('custo em fixture: 500 mutações, nenhuma leitura adicional em idle e heap isolado',async()=>{
  await withPage(async(page,context)=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Runtime.getHeapUsage');
    const timing=await page.evaluate(()=>{
      const start=performance.now();for(let i=0;i<100;i++)CodenotchGeminiQuotaPrototype.getContainer();const recognitionMs=performance.now()-start;
      const element=document.querySelector('.current strong');const burst=performance.now();for(let i=0;i<500;i++)element.textContent='Quantidade usada: 16%';return {recognitionMs,mutationMs:performance.now()-burst};
    });
    await page.waitForTimeout(550);const count=await page.evaluate(()=>({reads:fixtureState.reads,published:fixtureState.published}));
    await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>fixtureState.reads),count.reads);assert.equal(count.reads,2);assert.equal(count.published,1);
    await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');
    const metrics={fixtureOnly:true,...timing,recognitionCalls:100,mutations:500,...count,retainedHeapDeltaBytes:after.usedSize-before.usedSize,idleAdditionalReads:0};
    if(process.env.GEMINI_AUTO_METRICS)fs.writeFileSync(process.env.GEMINI_AUTO_METRICS,JSON.stringify(metrics,null,2));
  });
});

test('aba /usage em segundo plano captura mutação e retorno visible reavalia sem novo consentimento',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(()=>{fixtureVisible(false);document.querySelector('.current strong').textContent='Quantidade usada: 27%';});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===27,{},{timeout:2000});
    assert.equal(await page.evaluate(()=>fixtureState.published),2);
    await page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: 28%';fixtureVisible(true);});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===28,{},{timeout:2000});
    assert.equal(await page.evaluate(()=>fixtureState.published),3);
  });
});

test('pagehide/pageshow restaura sessão sem depender de onCompleted',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));document.querySelector('.current strong').textContent='Quantidade usada: 28%';window.dispatchEvent(new Event('pageshow'));});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===28,{},{timeout:2000});
  });
});

test('troca completa do contêiner reconhecido reconecta observer delimitado',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(()=>{const old=document.querySelector('.limits-panel'),next=old.cloneNode(true);next.querySelector('.current strong').textContent='Quantidade usada: 29%';old.replaceWith(next);});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===29,{},{timeout:2000});
    await page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: 30%';});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===30,{},{timeout:2000});
    await page.evaluate(()=>{document.querySelector('aside p').textContent='Outro texto lateral fictício';});
    const reads=await page.evaluate(()=>fixtureState.reads);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>fixtureState.reads),reads);
  });
});

test('substituir somente cartão mantém extração correta',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(()=>{const old=document.querySelector('.current'),next=old.cloneNode(true);next.querySelector('strong').textContent='Quantidade usada: 31%';old.replaceWith(next);});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===31);
  });
});

test('retorno com consentimento revogado ou rota de conversa nunca lê',async()=>{
  for(const mode of ['revoked','chat'])await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    await page.evaluate(mode=>{fixtureVisible(false);if(mode==='revoked')fixtureState.enabled=false;else history.pushState({},'', '/app');fixtureVisible(true);window.dispatchEvent(new Event('pageshow'));},mode);
    await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>fixtureState.reads),1);
  });
});

test('reverificação explícita reabre orçamento finito sem alterar consentimento',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    for(let i=1;i<=20;i++){
      await page.evaluate(i=>{document.querySelector('.current strong').textContent='Quantidade usada: '+(32+i)+'%';},i);
      await page.waitForTimeout(380);
    }
    assert.equal(await page.evaluate(()=>fixtureState.published),20);
    await page.evaluate(()=>{document.querySelector('.current strong').textContent='Quantidade usada: 65%';CodenotchGeminiAutoSession.recheck();});
    await page.waitForFunction(()=>fixtureState.snapshot.windows[0].used_percent===65,{},{timeout:2000});
    assert.equal(await page.evaluate(()=>fixtureState.enabled),true);
  });
});

test('retomada sem alteração é nova observação, sem inventar valores Google',async()=>{
  await withPage(async page=>{
    await page.waitForFunction(()=>fixtureState.published===1);
    const stamp=await page.evaluate(()=>fixtureState.snapshot.observed_at_ms);
    await page.evaluate(()=>{fixtureVisible(false);fixtureVisible(true);});
    await page.waitForFunction(()=>fixtureState.published===2,{},{timeout:2000});
    assert.equal(await page.evaluate(()=>fixtureState.snapshot.windows[0].used_percent),16);
    assert.ok(await page.evaluate(()=>fixtureState.snapshot.observed_at_ms)>stamp);
  });
});
