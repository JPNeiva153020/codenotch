'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Test tooling only. No production dependency, downloads or browser account/profile.
const { chromium } = require(process.env.GEMINI_TEST_PLAYWRIGHT || 'playwright');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/limits-pt.html'), 'utf8');
const script = fs.readFileSync(process.env.GEMINI_TEST_EXTRACTOR || path.join(__dirname, '../extractor.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.GEMINI_TEST_BROWSER, headless: true, chromiumSandbox: true, timeout: 20000 }); });
after(async () => { await browser?.close(); });
async function read(html, mutate) {
  const context = await browser.newContext({ timezoneId: 'America/Fortaleza', locale: 'pt-BR' });
  await context.route('**/*', route => route.abort());
  try {
    const page = await context.newPage();
    await page.setContent(html);
    if (mutate) await page.evaluate(mutate);
    await page.addScriptTag({ content: script });
    return await page.evaluate(() => CodenotchGeminiQuotaPrototype.extract(document, 1792008000000));
  } finally { await context.close(); }
}
test('captura fictícia: percentuais, plano e componentes de reset; nenhum conteúdo lateral', async () => {
  const r = await read(fixture);
  assert.equal(r.status, 'observed'); assert.equal(r.plan, 'PRO'); assert.equal(r.model, null);
  assert.deepEqual(r.windows.map(w => [w.used_percent, w.remaining_percent]), [[34,66],[5,95]]);
  assert.equal(r.windows[0].reset.hour, 17); assert.equal(r.windows[1].reset.month, 10);
  assert.equal(r.windows[1].reset.day, 20); assert.equal(r.windows[1].reset.epoch_ms, null);
  assert.equal(r.browser_timezone, 'America/Fortaleza');
  assert.equal(JSON.stringify(r).includes('CONVERSA_PRIVADA'), false);
});
test('reset histórico: zero real é distinto de campo ausente', async () => {
  const r = await read(fixture.replace('34%', '0%').replace('17:11:', '22:11:'));
  assert.equal(r.windows[0].used_percent, 0); assert.equal(r.windows[0].remaining_percent, 100);
  assert.equal(r.windows[0].reset.hour, 22); assert.equal(r.windows[1].used_percent, 5);
});
test('vírgula decimal e limites zero/cem', async () => {
  const r = await read(fixture.replace('34%', '34,5%').replace('Quantidade usada: 5%', 'Quantidade usada: 100%'));
  assert.equal(r.windows[0].remaining_percent, 65.5); assert.equal(r.windows[1].remaining_percent, 0);
});
for (const invalid of ['101%', '-1%', 'NaN%', 'Infinity%', '34% extra']) test('rejeita percentual '+invalid, async () => {
  const r = await read(fixture.replace('34%', invalid));
  assert.equal(r.windows[0].used_percent, null); assert.ok(r.windows[0].issues.includes('invalid_percentage'));
});
test('percentual ausente não é emprestado da janela semanal', async () => {
  const r = await read(fixture.replace('<strong>Quantidade usada: 34%</strong>', ''));
  assert.equal(r.windows[0].used_percent, null); assert.equal(r.windows[1].used_percent, 5);
});
test('reset ausente preserva percentual parcial', async () => {
  const r = await read(fixture.replace('<p>17:11: o limite de uso é redefinido</p>', ''));
  assert.equal(r.windows[0].used_percent, 34); assert.equal(r.windows[0].reset, null); assert.equal(r.status, 'partial');
});
for (const stamp of ['25:11', '17:70']) test('rejeita hora '+stamp, async () => {
  const r = await read(fixture.replace('17:11', stamp)); assert.equal(r.windows[0].reset, null);
});
test('rejeita dia impossível sem inventar ano ou fuso', async () => {
  const r = await read(fixture.replace('20 de out.', '31 de abr.')); assert.equal(r.windows[1].reset, null);
});
test('rótulo alterado produz ausência segura', async () => {
  const r = await read(fixture.replace('Uso atual', 'Utilização recente'));
  assert.equal(r.windows[0].used_percent, null); assert.equal(r.windows[1].used_percent, 5);
});
test('mudança de classes e wrappers mantém reconhecimento por rótulo', async () => {
  const r = await read(fixture.replaceAll('section', 'div').replaceAll('strong', 'span').replace('class="current"', 'class="novo-layout"'));
  assert.equal(r.status, 'observed');
});
test('indicador duplicado falha com ambiguidade', async () => {
  const r = await read(fixture.replace('<strong>Quantidade usada: 34%</strong>', '<strong>Quantidade usada: 34%</strong><span>Quantidade usada: 77%</span>'));
  assert.equal(r.windows[0].used_percent, null); assert.ok(r.windows[0].issues.includes('duplicate_percentage'));
});
test('janela duplicada não escolhe silenciosamente', async () => {
  const r = await read(fixture.replace('<h2>Uso atual</h2>', '<h2>Uso atual</h2><h3>Uso atual</h3>'));
  assert.equal(r.windows[0].used_percent, null);
});
test('exclui texto oculto e scripts', async () => {
  const r = await read(fixture.replace('<h2>Uso atual</h2>', '<h2>Uso atual</h2><span hidden>Quantidade usada: 90%</span><span style="display:none">Quantidade usada: 88%</span><script type="text/plain">Quantidade usada: 100%</script>'));
  assert.equal(r.windows[0].used_percent, 34);
});
test('layout sem main é desconhecido, não escaneia body como fallback', async () => {
  const r = await read(fixture.replaceAll('main', 'article')); assert.equal(r.status, 'unavailable'); assert.deepEqual(r.windows, []);
});
test('página errada não produz dados', async () => {
  const r = await read('<main><h1>Nova conversa</h1><p>Quantidade usada: 34%</p></main>'); assert.equal(r.status, 'unavailable');
});
test('campos protegidos não são consultados', async () => {
  const r = await read(fixture, () => {
    for (const key of ['cookie']) Object.defineProperty(document, key, { get() { throw new Error('acesso proibido'); } });
    for (const key of ['localStorage','sessionStorage','fetch','XMLHttpRequest','WebSocket']) Object.defineProperty(window, key, { get() { throw new Error('acesso proibido'); } });
    Object.defineProperty(navigator, 'sendBeacon', { get() { throw new Error('acesso proibido'); } });
  }); assert.equal(r.status, 'observed');
});
test('manifesto mínimo e sintaxe do popup', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab','scripting','nativeMessaging','alarms']); assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_permissions,['storage','webNavigation']);
  assert.deepEqual(manifest.optional_host_permissions,['https://gemini.google.com/*']);
  assert.equal(manifest.background.service_worker,'auto-worker.js');
  new (require('node:vm').Script)(fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8'));
});
test('conversa na superfície principal cancela leitura', async () => {
  const r = await read(fixture.replace('</main>', '<div role="log">CONVERSA_PRIVADA</div></main>'));
  assert.equal(r.status, 'unavailable'); assert.deepEqual(r.windows, []);
});
test('título duplicado é ambíguo', async () => {
  const r = await read(fixture.replace('<h1>Limites de uso</h1>', '<h1>Limites de uso</h1><h2>Limites de uso</h2>'));
  assert.ok(r.issues.includes('duplicate_title'));
});
test('marcação dividida em nós desconhecidos falha sem estimar', async () => {
  const r = await read(fixture.replace('Quantidade usada: 34%', 'Quantidade usada: <b>34%</b>'));
  assert.equal(r.windows[0].used_percent, null);
});
test('elementos de mensagens desconhecidos pelo layout de limites bloqueiam a leitura', async () => {
  const r = await read(fixture.replace('</main>', '<user-query>CONVERSA_PRIVADA</user-query></main>'));
  assert.deepEqual(r.windows, []); assert.ok(r.issues.includes('conversation_surface_detected'));
});
const fragmented = fs.readFileSync(path.join(__dirname, 'fixtures/limits-fragmented-pt.html'), 'utf8');
test('regressão observada: reset atual e percentual semanal em linhas separadas', async () => {
  const r = await read(fragmented);
  assert.equal(r.status, 'observed');
  assert.deepEqual(r.windows.map(w => w.used_percent), [16,6]);
  assert.deepEqual(r.windows.map(w => w.remaining_percent), [84,94]);
  assert.deepEqual(r.windows[0].reset, { day:null,month:null,year:null,hour:22,minute:11,timezone:null,epoch_ms:null,needs_confirmation:true });
  assert.equal(r.windows[1].reset.day, 20); assert.equal(r.windows[1].reset.month, 10);
  assert.equal(r.windows[1].reset.hour, 9); assert.equal(r.windows[1].reset.minute, 11);
});
test('regressão de associação: ambos os campos fora do header sem fragmentação', async () => {
  const html = fragmented.replace('<span>22:11:</span><span>o limite de uso é redefinido</span>', '22:11: o limite de uso é redefinido').replace('<span>Quantidade usada:</span><strong>6</strong><span>%</span>', 'Quantidade usada: 6%');
  const r = await read(html); assert.equal(r.windows[0].reset.hour,22); assert.equal(r.windows[1].used_percent,6);
});
test('regressão de fragmentação: cada campo em descendentes dentro do cartão', async () => {
  const html = fixture.replace('Quantidade usada: 34%', '<span>Quantidade</span><span>usada:</span><strong>16</strong><span>%</span>').replace('17:11: o limite de uso é redefinido', '<span>22</span><span>:</span><span>11</span><span>:</span><span>o limite de uso é redefinido</span>');
  const r = await read(html); assert.equal(r.windows[0].used_percent,16); assert.equal(r.windows[0].reset.hour,22);
});
test('pontuação e espaços entre nós mantêm hora e data sem inferência', async () => {
  const html = fragmented.replace('20 de out., 09:11: o limite de uso é redefinido', '20 de out. , 09 : 11 : o limite de uso é redefinido.');
  const r = await read(html); assert.equal(r.windows[1].reset.month,10); assert.equal(r.windows[1].reset.epoch_ms,null);
});
test('cartões invertidos preservam identidade das janelas', async () => {
  const html = fragmented.replace(/(<section class="current">[\s\S]*?<\/section>)\s*(<section class="weekly">[\s\S]*?<\/section>)/, '$2$1');
  const r = await read(html); assert.deepEqual(r.windows.map(w=>w.used_percent),[16,6]);
});
test('linha semanal sem número não usa percentual da janela atual', async () => {
  const r = await read(fragmented.replace('<strong>6</strong>', ''));
  assert.equal(r.windows[1].used_percent,null); assert.equal(r.windows[0].used_percent,16);
});
test('duplicata fora do header é detectada sem escolher valor mais próximo', async () => {
  const r = await read(fragmented.replace('</section>', '<p>Quantidade usada: 77%</p></section>'));
  assert.equal(r.windows[0].used_percent,null); assert.ok(r.windows[0].issues.includes('duplicate_percentage'));
});
test('reset duplicado entre wrappers permanece ambíguo', async () => {
  const r = await read(fragmented.replace('</section>', '<p>23:00: o limite de uso é redefinido</p></section>'));
  assert.equal(r.windows[0].reset,null); assert.ok(r.windows[0].issues.includes('duplicate_reset'));
});
test('número oculto não completa um percentual dividido', async () => {
  const r = await read(fragmented.replace('<strong>6</strong>', '<strong hidden>6</strong>'));
  assert.equal(r.windows[1].used_percent,null);
});
test('wrappers internos novos não duplicam uma linha única', async () => {
  const r = await read(fragmented.replace('<strong>6</strong>', '<span><strong>6</strong></span>'));
  assert.equal(r.windows[1].used_percent,6); assert.equal(r.status,'observed');
});
test('profundidade excessiva falha sem ampliar busca', async () => {
  const r = await read(fragmented.replace('<strong>6</strong>', '<span>'.repeat(8)+'6'+'</span>'.repeat(8)));
  assert.equal(r.windows[1].used_percent,null);
});
test('cartão excessivamente grande é recusado', async () => {
  const r = await read(fragmented.replace('<strong>6</strong>', '<span></span>'.repeat(130)+'<strong>6</strong>'));
  assert.equal(r.windows[1].used_percent,null); assert.ok(r.windows[1].issues.includes('card_too_large'));
});
test('idioma não reconhecido é indisponível', async () => {
  const r = await read(fragmented.replace('Limites de uso','Usage limits')); assert.deepEqual(r.windows,[]);
});
