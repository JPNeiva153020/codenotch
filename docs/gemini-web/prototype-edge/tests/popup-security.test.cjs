'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
async function click({ url = 'https://gemini.google.com/u/0/usage', beforeUrl = url, afterExtractionUrl = url, tabAfterUrl = url, throws = false } = {}) {
  const elements = Object.fromEntries(['result','status','read','clear'].map(id => [id, { textContent: '', disabled: false, addEventListener(_, listener) { this.listener = listener; } }]));
  let calls = 0, extracted = 0;
  const pageLocation = { origin: new URL(beforeUrl).origin, href: beforeUrl };
  const sandbox = { URL, document: { getElementById: id => elements[id] }, location: pageLocation,
    CodenotchGeminiQuotaPrototype: { extract() { extracted++; pageLocation.href = afterExtractionUrl; pageLocation.origin = new URL(afterExtractionUrl).origin; return { provider: 'gemini_web', status: 'unavailable', windows: [] }; } },
    chrome: { tabs: { async query() { return [{ id: 1, url }]; }, async get() { return { id: 1, url: tabAfterUrl }; } }, scripting: { async executeScript(options) {
      calls++; if (throws) throw new Error('SEGREDO_NAO_EXIBIR');
      if (options.files) return [];
      const fn = vm.runInContext('(' + options.func.toString() + ')', context);
      return [{ result: fn(...options.args) }];
    } } }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  assert.equal(calls, 0, 'abrir popup não lê automaticamente');
  await elements.read.listener();
  return { elements, calls, extracted };
}
test('URL válida: uma extração por clique, não há rede/persistência', async () => {
  const r = await click(); assert.equal(r.extracted, 1); assert.equal(r.calls, 2);
  assert.equal(JSON.parse(r.elements.result.textContent).provider, 'gemini_web');
});
for (const url of ['http://gemini.google.com/test', 'https://gemini.google.com.evil.invalid/test', 'https://user:password@gemini.google.com/test', 'https://gemini.google.com:444/test']) test('bloqueia URL '+url, async () => {
  const r = await click({ url }); assert.equal(r.calls, 0); assert.equal(r.elements.result.textContent, '');
});
test('navegação no mesmo domínio antes da extração cancela sem ler', async () => {
  const r = await click({ beforeUrl: 'https://gemini.google.com/conversation' });
  assert.equal(r.extracted, 0); assert.equal(r.elements.result.textContent, '');
});
test('URL muda durante extração: descarta resultado', async () => {
  const r = await click({ afterExtractionUrl: 'https://other.invalid/' });
  assert.equal(r.extracted, 1); assert.equal(r.elements.result.textContent, '');
});
test('aba muda depois da extração: descarta resultado', async () => {
  const r = await click({ tabAfterUrl: 'https://gemini.google.com/conversation' });
  assert.equal(r.elements.result.textContent, '');
});
test('erro sanitizado não mostra detalhes pessoais e libera botão', async () => {
  const r = await click({ throws: true });
  assert.equal(r.elements.status.textContent.includes('SEGREDO'), false); assert.equal(r.elements.read.disabled, false);
});
test('arquivos de produção sem APIs de credenciais/rede/logs/eval', () => {
  for (const name of ['extractor.js','popup.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.doesNotMatch(text, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|eval)\s*\(|document\.cookie|chrome\.(cookies|storage)|console\.|new\s+Function\b/);
  }
});
