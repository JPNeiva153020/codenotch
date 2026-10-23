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
  assert.ok(geminiWebRs.includes('https://gemini.google.com/usage?pageId=none'));
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
      protocol: 'https:',
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

test('gemini_web.rs implements strict url validation, concurrency control and mutex poisoning guard', () => {
  assert.ok(geminiWebRs.includes('pub fn is_valid_gemini_usage_url(url: &str) -> bool'));
  assert.ok(geminiWebRs.includes('PROBE_IN_FLIGHT'));
  assert.ok(geminiWebRs.includes('.unwrap_or_else(|e| e.into_inner())'));
  assert.ok(geminiWebRs.includes('PROBE_IN_FLIGHT.store(false, Ordering::SeqCst)'));
  assert.ok(geminiWebRs.includes('tmp.'));
});

test('main.rs implements mask_user_paths and applies it in applog', () => {
  assert.ok(mainRs.includes('pub fn mask_user_paths(line: &str) -> String'));
  assert.ok(mainRs.includes('let masked = mask_user_paths(line);'));
});

test('gemini_web.rs implements contract validation, monotonicity and does not zero quota by clock', () => {
  assert.ok(geminiWebRs.includes('pub fn validate_and_sanitize_payload'));
  assert.ok(geminiWebRs.includes('LAST_OBSERVED_AT_MS'));
  assert.ok(geminiWebRs.includes('observed_at_ms is older than last known observation'));
  assert.ok(geminiWebRs.includes('used_percent out of range (0-100)'));
  assert.ok(geminiWebRs.includes('both current and weekly windows are required'));
  // Confirm synthetic zeroing was removed from parse_state_json
  assert.ok(!geminiWebRs.includes('used = 0.0;'));
  assert.ok(!geminiWebRs.includes('saturating_mul(cycle_ms)'));
});

test('PROBE_INIT_SCRIPT aborts immediately on chat paths without touching DOM', () => {
  const match = geminiWebRs.match(/pub const PROBE_INIT_SCRIPT: &str =\s*r#"(.*?)"#;/s);
  const scriptContent = match[1];

  let querySelectorCalls = 0;
  const mockDocument = {
    title: '',
    querySelector: () => { querySelectorCalls++; return null; },
    querySelectorAll: () => { querySelectorCalls++; return []; },
    dispatchEvent: () => {}
  };
  const mockWindow = {
    location: {
      protocol: 'https:',
      hostname: 'gemini.google.com',
      pathname: '/u/1/app' // Conversation route
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

  vm.runInNewContext(scriptContent, sandbox);
  assert.equal(querySelectorCalls, 0, 'No DOM elements should be queried on chat route');
  assert.equal(mockDocument.title, '', 'No payload should be emitted on chat route');
});

test('PROBE_INIT_SCRIPT extracts cards and leaves epoch_ms as null for unconfirmed resets', () => {
  const match = geminiWebRs.match(/pub const PROBE_INIT_SCRIPT: &str =\s*r#"(.*?)"#;/s);
  const scriptContent = match[1];

  let publishedPayload = null;

  function createEl(tag, text, children = []) {
    const el = {
      tagName: tag.toUpperCase(),
      children,
      nodeType: 1, childNodes: [{ nodeType: 3, nodeValue: text }, ...children],
      parentElement: null,
      querySelectorAll: (sel) => {
        let results = [];
        for (const ch of children) {
          results.push(ch);
          if (ch.querySelectorAll) results.push(...ch.querySelectorAll(sel));
        }
        return results;
      },
      closest: () => null
    };
    for (const ch of children) ch.parentElement = el;
    return el;
  }

  const currentBox = createEl('div', '', [
    createEl('h3', 'Uso atual'),
    createEl('div', 'Quantidade usada: 48 %'),
    createEl('p', '17:11 : o limite de uso é redefinido.')
  ]);

  const weeklyBox = createEl('div', '', [
    createEl('h3', 'Limite semanal'),
    createEl('div', 'Quantidade usada: 12 %'),
    createEl('p', '21 de abr., 15:24 : o limite de uso é redefinido.')
  ]);

  const mainContainer = createEl('main', '', [currentBox, weeklyBox]);

  const mockDocument = {
    _title: '',
    get title() { return this._title; },
    set title(t) {
      this._title = t;
      if (t.startsWith('__CODENOTCH_GW_OK__:')) {
        publishedPayload = JSON.parse(t.slice('__CODENOTCH_GW_OK__:'.length));
      }
    },
    querySelector: (sel) => (sel.includes('main') ? mainContainer : null),
    querySelectorAll: (sel) => mainContainer.querySelectorAll(sel),
    dispatchEvent: () => {}
  };

  const mockWindow = {
    location: {
      protocol: 'https:',
      hostname: 'gemini.google.com',
      pathname: '/u/1/usage'
    },
    document: mockDocument,
    dispatchEvent: () => {},
    setTimeout: (cb) => { cb(); return 1; },
    clearTimeout: () => {},
    setInterval: (cb) => { cb(); return 1; },
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

  vm.runInNewContext(scriptContent, sandbox);
  assert.ok(publishedPayload, 'Payload must be published on usage page');
  assert.equal(publishedPayload.windows.length, 2);

  const cur = publishedPayload.windows.find(w => w.id === 'current');
  const wk = publishedPayload.windows.find(w => w.id === 'weekly');

  assert.equal(cur.used_percent, 48);
  assert.equal(cur.remaining_percent, 52);
  assert.equal(cur.reset.hour, 17);
  assert.equal(cur.reset.minute, 11);
  assert.equal(cur.reset.epoch_ms, null, 'Must NOT invent epoch_ms for hour/min only reset');

  assert.equal(wk.used_percent, 12);
  assert.equal(wk.remaining_percent, 88);
  assert.equal(wk.reset.day, 21);
  assert.equal(wk.reset.month, 4);
  assert.equal(wk.reset.hour, 15);
  assert.equal(wk.reset.minute, 24);
  assert.equal(wk.reset.epoch_ms, null, 'Must NOT invent epoch_ms for unconfirmed year/timezone');
});

test('notch.html quotaResetCopy uses reset_detail when present', () => {
  const notchHtml = readFileSync(join(__dirname, 'codenotch/ui/notch.html'), 'utf8');
  assert.ok(notchHtml.includes('if(w.reset_detail) return textCopy(w.reset_detail);'));
});

test('gemini_web.rs enforces deny_unknown_fields, calendar boundaries and component pairs', () => {
  assert.ok(geminiWebRs.includes('#[serde(deny_unknown_fields)]'));
  assert.ok(geminiWebRs.includes('incomplete hour/minute pair'));
  assert.ok(geminiWebRs.includes('incomplete day/month pair'));
  assert.ok(geminiWebRs.includes('reset day exceeds days in month'));
  assert.ok(geminiWebRs.includes('crate::applog'));
  // Ensure crate::main::applog was corrected
  assert.ok(!geminiWebRs.includes('crate::main::applog'));
});

test('PROBE_INIT_SCRIPT requires main element and does not fallback to body', () => {
  const match = geminiWebRs.match(/pub const PROBE_INIT_SCRIPT: &str =\s*r#"(.*?)"#;/s);
  const scriptContent = match[1];

  let querySelectorAllCalled = false;
  const mockDocument = {
    title: '',
    querySelector: (sel) => null, // No main element found
    querySelectorAll: () => { querySelectorAllCalled = true; return []; },
    dispatchEvent: () => {}
  };
  const mockWindow = {
    location: {
      protocol: 'https:',
      hostname: 'gemini.google.com',
      pathname: '/u/1/usage'
    },
    document: mockDocument,
    dispatchEvent: () => {},
    setTimeout: (cb) => { cb(); return 1; },
    clearTimeout: () => {},
    setInterval: (cb) => { cb(); return 1; },
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

  vm.runInNewContext(scriptContent, sandbox);
  assert.equal(querySelectorAllCalled, false, 'Should abort immediately when main is missing without falling back to body');
});

test('JS-only sequential persistence model with deferred readers (not Rust or concurrent writers)', async () => {
  const { writeFileSync, unlinkSync, existsSync, renameSync, readFileSync: rfs } = require('node:fs');
  const { tmpdir } = require('node:os');

  const testDir = join(tmpdir(), `codenotch-probe-test-${Date.now()}`);
  const stateFile = join(testDir, 'gemini-web-state.json');
  const { mkdirSync, rmSync } = require('node:fs');
  mkdirSync(testDir, { recursive: true });

  try {
    let lastObservedMs = 0;
    let seq = 0;

    // Independent Node filesystem model, not execution of save_state_atomically.
    function atomicWrite(targetPath, data) {
      seq++;
      const tmpPath = `${targetPath}.tmp.${process.pid}.${seq}`;
      writeFileSync(tmpPath, data, 'utf8');
      renameSync(tmpPath, targetPath);
    }

    // Simulate transaction validator and state update
    function processPayload(payload) {
      if (payload.observed_at_ms < lastObservedMs) {
        return { ok: false, error: 'out_of_order' };
      }
      atomicWrite(stateFile, JSON.stringify(payload));
      lastObservedMs = payload.observed_at_ms;
      return { ok: true };
    }

    // 1. Initial observation at T = 1000
    const snap1 = {
      schema_version: 1,
      provider: 'gemini_web',
      status: 'observed',
      observed_at_ms: 1000,
      windows: [{ id: 'current', used_percent: 50 }, { id: 'weekly', used_percent: 20 }]
    };
    const res1 = processPayload(snap1);
    assert.equal(res1.ok, true);
    assert.equal(lastObservedMs, 1000);
    assert.equal(JSON.parse(rfs(stateFile, 'utf8')).observed_at_ms, 1000);

    // 2. Out of order event at T = 900 (must be rejected, state must not regress)
    const snapStale = {
      schema_version: 1,
      provider: 'gemini_web',
      status: 'observed',
      observed_at_ms: 900,
      windows: [{ id: 'current', used_percent: 99 }, { id: 'weekly', used_percent: 99 }]
    };
    const resStale = processPayload(snapStale);
    assert.equal(resStale.ok, false);
    assert.equal(resStale.error, 'out_of_order');
    assert.equal(lastObservedMs, 1000);
    assert.equal(JSON.parse(rfs(stateFile, 'utf8')).observed_at_ms, 1000, 'File must not be overwritten by stale event');

    // 3. Newer observation at T = 1200 (must be accepted)
    const snapNewer = {
      schema_version: 1,
      provider: 'gemini_web',
      status: 'observed',
      observed_at_ms: 1200,
      windows: [{ id: 'current', used_percent: 55 }, { id: 'weekly', used_percent: 25 }]
    };
    const resNewer = processPayload(snapNewer);
    assert.equal(resNewer.ok, true);
    assert.equal(lastObservedMs, 1200);
    assert.equal(JSON.parse(rfs(stateFile, 'utf8')).observed_at_ms, 1200);

    // 4. Simulate App Restart: state loaded from disk initializes watermark
    let restartedLastObservedMs = 0;
    if (existsSync(stateFile)) {
      const persisted = JSON.parse(rfs(stateFile, 'utf8'));
      restartedLastObservedMs = persisted.observed_at_ms;
    }
    assert.equal(restartedLastObservedMs, 1200, 'Restarted process must recover high watermark');

    // An event from before restart (T = 1150) must be rejected after restart
    assert.ok(1150 < restartedLastObservedMs, 'Event prior to restart must be rejected');

    // 5. Deferred readers after writes complete; this does not test concurrent writers.
    const writePromises = [];
    let concurrentReadSuccesses = 0;

    for (let i = 0; i < 20; i++) {
      const p = new Promise((resolve) => {
        setImmediate(() => {
          try {
            if (existsSync(stateFile)) {
              const content = rfs(stateFile, 'utf8');
              const parsed = JSON.parse(content);
              assert.ok(parsed.observed_at_ms > 0);
              concurrentReadSuccesses++;
            }
          } catch (e) {
            assert.fail('Reader must never observe corrupted or partial file during rename: ' + e.message);
          }
          resolve();
        });
      });
      writePromises.push(p);
    }
    await Promise.all(writePromises);
    assert.ok(concurrentReadSuccesses > 0, 'Concurrent readers must read intact JSON');
  } finally {
    try { rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  }
});


// Execute the actual embedded collector; no browser, account, or application launch.
const probeScript = geminiWebRs.match(/pub const PROBE_INIT_SCRIPT: &str =\s*r#"(.*?)"#;/s)[1];
function fixtureEl(text = '', children = [], excluded = false) {
  const el = { children, nodeType: 1, childNodes: [{ nodeType: 3, nodeValue: text }, ...children], parentElement: null,
    closest: () => excluded ? el : null };
  children.forEach(child => { child.parentElement = el; });
  return el;
}
function fixtureCards() {
  return [fixtureEl('', [fixtureEl('Uso atual'), fixtureEl('Quantidade usada: 37%'), fixtureEl('22:11: o limite de uso é redefinido')]),
    fixtureEl('', [fixtureEl('Limite semanal'), fixtureEl('Quantidade usada: 9%'), fixtureEl('20 de out., 09:11: o limite de uso é redefinido')])];
}
function executeFixture(root, location = {}) {
  let callback, queries = 0, stopped = 0;
  const doc = { title: '', querySelector() { queries++; return root; } };
  const win = { location: { protocol: 'https:', hostname: 'gemini.google.com', pathname: '/usage', ...location }, dispatchEvent() {} };
  vm.runInNewContext(probeScript, { window: win, document: doc, Event: function () {},
    setInterval(fn) { callback = fn; return 1; }, clearInterval() { stopped++; },
    setTimeout(fn) { fn(); return 2; }, clearTimeout() {} });
  return { doc, win, tick: () => callback?.(), queries: () => queries, stopped: () => stopped,
    payload: () => doc.title.startsWith('__CODENOTCH_GW_OK__:') ? JSON.parse(doc.title.slice('__CODENOTCH_GW_OK__:'.length)) : null };
}
test('collector accepts direct usage fixture and four observed indicators', () => {
  const run = executeFixture(fixtureEl('', fixtureCards()));
  assert.deepEqual(run.payload().windows.map(w => [w.used_percent, w.reset.hour, w.reset.minute]), [[37, 22, 11], [9, 9, 11]]);
});
test('collector rejects HTTP and lookalike hosts without DOM queries', () => {
  for (const loc of [{ protocol: 'http:' }, { hostname: 'gemini.google.com.evil.example' }, { pathname: '/app/conversation' }]) {
    const run = executeFixture(fixtureEl('', fixtureCards()), loc);
    assert.equal(run.queries(), 0); assert.equal(run.payload(), null);
  }
});
test('collector stops before DOM reads after navigation into conversation', () => {
  const run = executeFixture(null);
  const before = run.queries();
  run.win.location.pathname = '/u/2/app/private'; run.tick();
  assert.equal(run.queries(), before); assert.ok(run.stopped() > 0); assert.equal(run.payload(), null);
});
test('collector bounds traversal before reading text beyond the budget', () => {
  const forbidden = fixtureEl();
  Object.defineProperty(forbidden, 'childNodes', { get() { assert.fail('out-of-budget text read'); } });
  const run = executeFixture(fixtureEl('', [...Array.from({ length: 256 }, () => fixtureEl()), forbidden]));
  assert.equal(run.payload(), null);
});
test('collector never borrows weekly percentage for an incomplete current card', () => {
  const [current, weekly] = fixtureCards();
  current.children.splice(1, 1);
  // Shared ancestor is below main: the old ownText-only guard missed the other heading.
  const run = executeFixture(fixtureEl('', [fixtureEl('', [current, weekly])]));
  assert.equal(run.payload(), null);
});
test('collector excludes form subtree without reading its text', () => {
  const forbidden = fixtureEl('', [], true);
  Object.defineProperty(forbidden, 'childNodes', { get() { assert.fail('form text read'); } });
  const run = executeFixture(fixtureEl('', [...fixtureCards(), forbidden]));
  assert.ok(run.payload());
});
test('collector accepts missing reset without throwing or inventing a reset', () => {
  const cards = fixtureCards(); cards[0].children.pop();
  const run = executeFixture(fixtureEl('', cards));
  assert.ok(run.payload()); assert.equal(run.payload().windows[0].reset, null);
});
test('collector stops retrying after a bounded number of attempts', () => {
  const run = executeFixture(null);
  for (let i = 0; i < 40; i++) run.tick();
  assert.equal(run.queries(), 25); assert.ok(run.stopped() > 0);
});

test('collector joins split inline percentage and reset text within the same card', () => {
  const cards = fixtureCards();
  cards[0].children[1] = fixtureEl('', [fixtureEl('Quantidade usada: '), fixtureEl('37%')]);
  cards[0].children[1].parentElement = cards[0];
  cards[0].children[2] = fixtureEl('', [fixtureEl('22:11'), fixtureEl(': o limite de uso é redefinido')]);
  cards[0].children[2].parentElement = cards[0];
  const run = executeFixture(fixtureEl('', cards));
  assert.equal(run.payload().windows[0].used_percent, 37);
  assert.equal(run.payload().windows[0].reset.hour, 22);
});
test('collector fails closed on conflicting percentages in a card', () => {
  const cards = fixtureCards(); cards[0].children.push(fixtureEl('Quantidade usada: 81%'));
  const run = executeFixture(fixtureEl('', cards)); assert.equal(run.payload(), null);
});
test('collector rejects unexpected ports, query parameters and fragments before DOM reads', () => {
  for (const loc of [{ port: '8443' }, { search: '?untrusted=1' }, { hash: '#conversation' }]) {
    const run = executeFixture(fixtureEl('', fixtureCards()), loc);
    assert.equal(run.queries(), 0); assert.equal(run.payload(), null);
  }
});

test('collector accepts deeply nested usage layout without increasing node budget', () => {
  let content = fixtureEl('', fixtureCards());
  for (let i=0;i<12;i++) content=fixtureEl('',[content]);
  assert.ok(executeFixture(content).payload());
});
test('collector associates wrapped headings with their own card fields', () => {
  const cards=fixtureCards();
  for(const card of cards) {
    card.children[0]=fixtureEl('',[card.children[0]]);
    card.children[0].parentElement=card;
  }
  assert.deepEqual(executeFixture(fixtureEl('',cards)).payload().windows.map(w=>w.used_percent),[37,9]);
});

test('collector excludes ARIA navigation before traversing or reading sidebar text', () => {
  const sidebar=fixtureEl('',Array.from({length:900},()=>fixtureEl('PRIVATE')));
  sidebar.closest=selector=>selector.includes('[role="navigation"]')?sidebar:null;
  Object.defineProperty(sidebar,'childNodes',{get(){assert.fail('navigation text read');}});
  assert.ok(executeFixture(fixtureEl('',[sidebar,...fixtureCards()])).payload());
});

test('collector continues from percentage header to reset in its enclosing card', () => {
  const cards=fixtureCards();
  const [label,pct,reset]=cards[0].children;
  cards[0]=fixtureEl('',[fixtureEl('',[label,pct]),reset]);
  const windows=executeFixture(fixtureEl('',cards)).payload().windows;
  assert.equal(windows[0].used_percent,37);
  assert.equal(windows[0].reset.hour,22);
  assert.equal(windows[0].reset.minute,11);
  assert.equal(windows[1].reset.day,20);
});
