const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'codenotch');
const html=fs.readFileSync(path.join(root,'ui/settings.html'),'utf8');
function updatePanel(state){
  let click; const calls=[];
  const btn={addEventListener(_,fn){click=fn;}}, status={};
  const start=html.indexOf("const updBtn =");
  const end=html.indexOf('let updateListener;',start);
  const combined={document:{getElementById:id=>id==='btn-update'?btn:status},ui:(_,fallback)=>fallback,
    invoke:async command=>calls.push(command),strip(){},errText:String};
  vm.createContext(combined);vm.runInContext(html.slice(start,end),combined);combined.renderUpdate(state);
  return {btn,status,calls,click:()=>click()};
}
test('manual distribution disables both installation and download offers',()=>{
  const p=updatePanel({disabled:true,message:'Manual updates only for this experimental distribution',available:'999.0.0',can_install:true});
  assert.equal(p.btn.disabled,true);assert.match(p.status.textContent,/Manual updates/);
  p.click();assert.deepEqual(p.calls,[]);
});
test('regular distribution still renders and invokes a signed offer',()=>{
  const p=updatePanel({available:'1.24.0',can_install:true});
  assert.equal(p.btn.disabled,false);p.click();assert.deepEqual(p.calls,['install_update']);
});
test('Cargo, lockfile and Tauri describe the same prerelease distribution',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'tauri.conf.json'),'utf8'));
  const cargo=fs.readFileSync(path.join(root,'Cargo.toml'),'utf8');
  const lock=fs.readFileSync(path.join(__dirname,'Cargo.lock'),'utf8');
  assert.equal(config.version,cargo.match(/^version = "([^"]+)"/m)[1]);
  assert.equal(config.version,lock.match(/name = "codenotch"\r?\nversion = "([^"]+)"/)[1]);
  assert.notEqual(config.identifier,'com.immidi.codenotch');
  assert.match(cargo,/default\s*=\s*\["gemini-web-distribution"\]/);
  assert.equal(config.mainBinaryName,'codenotch-gemini-web');
  const policy=fs.readFileSync(path.join(root,'src/distribution.rs'),'utf8');
  assert.equal(config.productName,policy.match(/PRODUCT_NAME: &str = "([^"]+)"/)[1]);
  assert.deepEqual(config.plugins.updater.endpoints,[]);
  const cap=JSON.parse(fs.readFileSync(path.join(root,'capabilities/default.json'),'utf8'));
  assert.ok(!cap.permissions.includes('updater:default'));
  assert.equal(config.bundle.windows.nsis.installMode,'currentUser');
});

test('usage login window opens only after its explicit settings click',()=>{
  let click;const calls=[];
  const start=html.indexOf("document.getElementById('btn-gemini-usage').addEventListener");
  const end=html.indexOf("document.getElementById('btn-data').addEventListener",start);
  vm.runInNewContext(html.slice(start,end),{
    document:{getElementById:id=>{assert.equal(id,'btn-gemini-usage');return {addEventListener:(_,fn)=>click=fn};}},
    invoke:command=>{calls.push(command);return Promise.resolve();},strip(){},ui:(_,fallback)=>fallback
  });
  assert.deepEqual(calls,[]);click();assert.deepEqual(calls,['open_gemini_usage']);
});
test('manual channel caption survives a language rerender and shows the real version',()=>{
  const elements={'about-version':{},'update-caption':{}};
  const ctx={distributionInfo:{version:'1.23.0-gemini.1',channel:'experimental-manual'},
    document:{getElementById:id=>elements[id]},ui:(_,fallback)=>fallback};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function renderDistribution(){'),html.indexOf("invoke('get_distribution_info').then")),ctx);
  ctx.renderDistribution();assert.equal(elements['about-version'].textContent,'1.23.0-gemini.1');
  assert.match(elements['update-caption'].textContent,/Manual updates only/);
  ctx.ui=()=> 'Atualizações manuais';ctx.renderDistribution();
  assert.equal(elements['update-caption'].textContent,'Atualizações manuais');
});

async function automaticPanel(failSave=false){
  let click,actual=false;const calls=[];
  const button={classList:{toggle(){}},setAttribute(){},addEventListener(_,fn){click=fn;}};
  const ctx={document:{getElementById:id=>{assert.equal(id,'sw-gemini-auto');return button;}},
    call:async(command)=>{calls.push(command);return actual;},
    invoke:async(command,args)=>{calls.push({command,args});if(failSave)throw Error('fixture-save-failure');actual=args.on;},
    strip(){},errText:String,toast(){}};
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function remote('),html.indexOf('const HOOKS_UNAVAILABLE')),ctx);
  vm.runInContext(html.slice(html.indexOf('const geminiAuto ='),html.indexOf('const foldFullScreen ='))+';globalThis.state=geminiAuto;',ctx);
  await ctx.state.refresh();return {ctx,button,calls,click:()=>click()};
}
test('automatic reading starts off and only an explicit click requests consent',async()=>{
  const p=await automaticPanel();assert.equal(p.ctx.state.value,false);
  assert.deepEqual(p.calls,['get_gemini_auto']);p.click();await new Promise(setImmediate);
  assert.equal(p.ctx.state.value,true);assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1])),{command:'set_gemini_auto',args:{on:true}});
});
test('a failed preference save cannot leave the automatic switch falsely enabled',async()=>{
  const p=await automaticPanel(true);p.click();await new Promise(setImmediate);
  assert.equal(p.ctx.state.value,false);assert.equal(p.button.disabled,false);
  assert.equal(p.calls.at(-1),'get_gemini_auto');
});
