// Run with node --test test-gemini-probe.cjs from windows/.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const geminiWebRs = readFileSync(join(__dirname, 'codenotch/src/gemini_web.rs'), 'utf8');
const mainRs = readFileSync(join(__dirname, 'codenotch/src/main.rs'), 'utf8');
const notchMenuRs = readFileSync(join(__dirname, 'codenotch/src/notchmenu.rs'), 'utf8');

test('gemini_web.rs defines PROBE_INIT_SCRIPT with visibility shim, rAF fallback and title protocol', () => {
  assert.ok(geminiWebRs.includes('pub const PROBE_INIT_SCRIPT: &str ='));
  assert.ok(geminiWebRs.includes('__CODENOTCH_GW_OK__:'));
  assert.ok(geminiWebRs.includes('__CODENOTCH_GW_AUTH__'));
  assert.ok(geminiWebRs.includes('visibilitychange'));
  assert.ok(geminiWebRs.includes('requestAnimationFrame'));
  assert.ok(geminiWebRs.includes('o limite de uso é redefinido'));
  assert.ok(geminiWebRs.includes('usage limit resets'));
});

test('gemini_web.rs implements probe_in_background, open_usage_window, force_manual_probe and config persistence', () => {
  assert.ok(geminiWebRs.includes('pub fn probe_in_background(app: &AppHandle)'));
  assert.ok(geminiWebRs.includes('pub fn open_usage_window(app: &AppHandle)'));
  assert.ok(geminiWebRs.includes('pub fn force_manual_probe(app: &AppHandle)'));
  assert.ok(geminiWebRs.includes('pub fn is_gemini_desktop_running() -> bool'));
  assert.ok(geminiWebRs.includes('gemini-web-config.json'));
  assert.ok(geminiWebRs.includes('https://gemini.google.com/u/1/usage?pageId=none'));
});

test('notchmenu.rs routes open:gemini_web to gemini_web::open_usage_window(app)', () => {
  assert.ok(notchMenuRs.includes('provider == "gemini_web"'));
  assert.ok(notchMenuRs.includes('crate::gemini_web::open_usage_window(app);'));
});

test('main.rs triggers force_manual_probe on refresh_provider("gemini_web")', () => {
  assert.ok(mainRs.includes('"gemini_web" => {'));
  assert.ok(mainRs.includes('gemini_web::force_manual_probe(app);'));
});

test('PROBE_INIT_SCRIPT evaluates cleanly without syntax errors', () => {
  const match = geminiWebRs.match(/pub const PROBE_INIT_SCRIPT: &str =\s*r#"(.*?)"#;/s);
  assert.ok(match, 'PROBE_INIT_SCRIPT string found');
  const scriptContent = match[1];

  let titleSet = null;
  const mockDocument = {
    title: '',
    querySelectorAll: () => [],
    dispatchEvent: () => {}
  };
  const mockWindow = {
    location: {
      hostname: 'gemini.google.com',
      pathname: '/u/1/usage'
    },
    document: mockDocument,
    dispatchEvent: () => {},
    setTimeout: (cb) => { cb(); return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    Event: function(type) { this.type = type; },
    Date: Date,
    Number: Number,
    String: String,
    Math: Math,
    setTimeout: mockWindow.setTimeout,
    clearTimeout: mockWindow.clearTimeout,
    setInterval: mockWindow.setInterval,
    clearInterval: mockWindow.clearInterval,
    Object: Object
  };

  assert.doesNotThrow(() => {
    vm.runInNewContext(scriptContent, sandbox);
  });
});
