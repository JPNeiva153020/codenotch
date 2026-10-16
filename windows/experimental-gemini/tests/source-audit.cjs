'use strict';
// Static source/configuration checks; these are NOT execution of Rust tests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const config=JSON.parse(read('tauri.conf.json'));
test('opt-in package independent of official workspace and binary gated',()=>{
  const cargo=read('Cargo.toml');assert.match(cargo,/\[workspace\]/);assert.match(cargo,/default = \[\]/);assert.match(cargo,/required-features = \["experimental-ui"\]/);assert.match(cargo,/publish = false/);assert.match(cargo,/name = "codenotch-gemini-experimental"/);
});
test('own application identity, no automatic windows or bundle',()=>{
  assert.equal(config.identifier,'com.codenotch.gemini.experimental');assert.equal(config.productName,'Codenotch Gemini Experimental');assert.deepEqual(config.app.windows,[]);assert.equal(config.bundle.active,false);
});
test('no plugins, IPC capabilities, global API or frontend scripts',()=>{
  assert.deepEqual(config.plugins,{});assert.deepEqual(config.app.security.capabilities,[]);assert.equal(config.app.withGlobalTauri,false);assert.match(config.app.security.csp,/script-src 'none'/);assert.match(config.app.security.csp,/connect-src 'none'/);assert.doesNotMatch(read('ui/index.html'),/<script\b|https?:\/\//);
});
test('experimental startup cannot import official account providers',()=>{
  const main=read('src/main.rs');assert.doesNotMatch(main,/\bmod\s+(config|codex|antigravity|opencode|usage|server|watcher|updater|hooks_install|autostart)\b/);assert.doesNotMatch(main,/\.plugin\(|invoke_handler|Command::new|TcpListener|TcpStream|sendNativeMessage/);
});
test('WebView2 and process temporary roots assigned before UI',()=>{
  const main=read('src/main.rs');assert.match(main,/\.data_directory\(paths.webview2\(\)\)/);for(const key of ['TEMP','TMP','WEBVIEW2_USER_DATA_FOLDER'])assert.match(main,new RegExp('set_var\\("'+key+'"'));assert.ok(main.indexOf('WEBVIEW2_USER_DATA_FOLDER')<main.indexOf('tauri::Builder'));
});
test('directory resolution fails closed without official fallback',()=>{
  const text=read('src/isolation.rs');assert.match(text,/base\.ok_or\(Error::Directory\)/);assert.match(text,/codenotch-gemini-experimental/);assert.doesNotMatch(text,/join\("codenotch"\)|unwrap_or_else|PathBuf::from\("\."\)/);assert.match(text,/symlink_metadata/);assert.match(text,/file_attributes\(\) & 0x400/);
});
test('own file lock and no provider/TCP policy',()=>{
  const text=read('src/isolation.rs');assert.match(text,/experimental-instance.lock/);assert.match(text,/create_new\(true\)/);assert.match(text,/START_REAL_PROVIDERS: bool = false/);assert.match(text,/LISTEN_TCP: bool = false/);assert.match(text,/authorize_mutation[^\n]*Err\(Error::Status\)/);
});
test('cache file path fixed, bounded and checkpoint persisted together',()=>{
  const text=read('src/ingress.rs');assert.match(read('src/isolation.rs'),/gemini-state.json/);assert.doesNotMatch(text,/pub\s+path:|pub\s+filename:|from\(message\./);assert.match(text,/store.commit\(&next\)\?/);assert.match(text,/self.state=next/);assert.match(text,/MAX_CACHE_BYTES\+1/);assert.match(text,/fs::rename\(&tmp,&dest\)/);
});
test('typed schemas deny unexpected and duplicate struct fields',()=>{
  for(const file of ['src/contract.rs','src/ingress.rs'])assert.match(read(file),/deny_unknown_fields/);assert.match(read('src/lib.rs'),/depth > 8/);assert.match(read('src/lib.rs'),/serde_json::from_slice\(bytes\)/);assert.doesNotMatch(read('src/contract.rs'),/serde_json::Value/);
});
test('diagnostics are codes, not payloads or filesystem errors',()=>{
  assert.match(read('src/main.rs'),/eprintln!\("gemini_experimental_start_failed"\)/);assert.doesNotMatch(read('src/main.rs'),/eprintln!\("\{error\}"\)/);assert.match(read('src/lib.rs'),/gemini_experimental_\{self:\?\}/);
});
test('fixture has no identity, URL, credentials or full epoch',()=>{
  const fixture=JSON.parse(read('tests/fixtures/snapshot.json'));assert.equal(fixture.account_scope,'unknown');assert.equal(fixture.model,null);assert.deepEqual(fixture.windows.map(w=>w.id),['current','weekly']);for(const w of fixture.windows){assert.equal(w.reset.epoch_ms,null);assert.equal(w.reset.year,null);assert.equal(w.reset.timezone,null);}for(const key of ['email','token','password','profile','url','account_id'])assert.equal(Object.hasOwn(fixture,key),false);
});
test('runtime keeps unknown-account observations historical and no countdown',()=>{
  const text=read('src/contract.rs');assert.match(text,/Status::Historical/);assert.match(text,/confirmed_countdown_ms[^\n]*None/);assert.match(text,/now < self.received_at_ms/);assert.match(text,/now-self.snapshot.observed_at_ms > TTL_MS/);
});
test('no production network, host, registry or account access',()=>{
  for(const file of ['src/main.rs','src/lib.rs','src/contract.rs','src/ingress.rs','src/isolation.rs'])assert.doesNotMatch(read(file),/TcpListener::|TcpStream::|ureq::|reqwest::|RegSet|reg\.exe|auth\.json|\.credentials\.json|opencode\.db|CredRead/);
});
test('Rust tests authored for contract, persistence and isolation (not run by Node)',()=>{
  for(const file of ['tests/contract.rs','tests/ingress.rs','tests/isolation.rs'])assert.match(read(file),/#\[test\]/);assert.match(read('tests/ingress.rs'),/replay_is_rejected_after_restart/);assert.match(read('tests/isolation.rs'),/unavailable_root_does_not_fallback/);assert.match(read('tests/contract.rs'),/duplicate_struct_fields_rejected/);
});
